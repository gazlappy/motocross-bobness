import Peer, { type DataConnection } from 'peerjs';
import type { Msg } from './protocol.ts';

// A multiplayer room over WebRTC (PeerJS). The host's peer id is a short room code; players join
// by typing it. The public PeerJS broker only introduces the peers: game traffic then goes
// directly between browsers. Star layout: clients connect to the host, which relays.

const PREFIX = 'mxbob-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const TIMEOUT = 12000;

function randomCode() {
  return Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

export class Room {
  readonly isHost: boolean;
  readonly code: string;
  private peer: Peer;
  /** Host: every client. Client: just the host. */
  private conns = new Map<string, DataConnection>();
  private closed = false;
  onMessage?: (msg: Msg, from: string) => void;
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
  /** The room is gone (host left, network lost). */
  onClosed?: (reason: string) => void;

  private constructor(peer: Peer, code: string, isHost: boolean) {
    this.peer = peer;
    this.code = code;
    this.isHost = isHost;
    peer.on('disconnected', () => {
      // Lost the broker: existing connections keep working, but try to get back for new joiners.
      if (!this.closed && !peer.destroyed) peer.reconnect();
    });
  }

  get selfId() {
    return this.peer.id;
  }

  get peerIds() {
    return [...this.conns.keys()];
  }

  /** Open a room with a fresh code. */
  static async host(): Promise<Room> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomCode();
      try {
        const peer = await open(PREFIX + code);
        const room = new Room(peer, code, true);
        peer.on('connection', (c) => room.adopt(c));
        return room;
      } catch (e) {
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('Could not get a room code. Try again.');
  }

  /** Join a room by its code. */
  static async join(code: string): Promise<Room> {
    code = code.trim().toUpperCase();
    const peer = await open();
    const room = new Room(peer, code, false);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No answer from room ${code}.`)), TIMEOUT);
      peer.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error((e as { type?: string }).type === 'peer-unavailable' ? `There's no room ${code}.` : String(e.message ?? e)));
      });
      const c = peer.connect(PREFIX + code, { reliable: true });
      c.on('open', () => {
        clearTimeout(timer);
        room.adopt(c);
        resolve();
      });
    }).catch((e) => {
      peer.destroy();
      throw e;
    });
    return room;
  }

  private adopt(c: DataConnection) {
    const id = c.peer;
    const ready = () => {
      this.conns.set(id, c);
      this.onJoin?.(id);
    };
    if (c.open) ready();
    else c.on('open', ready);
    c.on('data', (data) => {
      const msg = data as Msg;
      // The host passes riders' snapshots and finishes on to everyone else.
      if (this.isHost && (msg.t === 'snap' || msg.t === 'finish')) this.broadcast(msg, id);
      this.onMessage?.(msg, id);
    });
    c.on('close', () => {
      this.conns.delete(id);
      if (this.isHost) this.onLeave?.(id);
      else this.shut('The host left the game.');
    });
    c.on('error', () => c.close());
  }

  /** Client: to the host. Host: to every client. */
  send(msg: Msg) {
    if (this.isHost) this.broadcast(msg);
    else for (const c of this.conns.values()) c.send(msg);
  }

  /** Host: to every client except `except`. */
  broadcast(msg: Msg, except?: string) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  /** Host: to one client. */
  sendTo(id: string, msg: Msg) {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  /** Host: drop a client. */
  kick(id: string) {
    this.conns.get(id)?.close();
  }

  private shut(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClosed?.(reason);
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.conns.values()) c.close();
    this.peer.destroy();
  }
}

/** A peer registered with the broker (under `id`, or a random one). */
function open(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new Error('Could not reach the matchmaking server.'));
    }, TIMEOUT);
    const onError = (e: Error) => {
      clearTimeout(timer);
      peer.destroy();
      reject(e);
    };
    peer.on('open', () => {
      clearTimeout(timer);
      peer.off('error', onError);
      resolve(peer);
    });
    peer.on('error', onError);
  });
}
