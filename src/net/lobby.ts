import { aiRidersFor } from '../session.ts';
import type { Msg, NetSetup, PlayerInfo, RosterEntry } from './protocol.ts';
import { Room } from './room.ts';

// The multiplayer lobby: who's in the room, what game the host has set up, and the handshake that
// starts everyone together (the host waits until every player has loaded the venue, then says go).

export const MAX_RIDERS = 8;
/** If someone never finishes loading, start without waiting any longer. */
const READY_TIMEOUT = 20000;

/** Names end up in the HUD and results tables: plain text, short. */
function cleanName(name: unknown) {
  return String(name).replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Rider';
}

export const DEFAULT_SETUP: NetSetup = { mode: 'race', venue: 'nationals', laps: 3, ai: 3, difficulty: 'medium', duration: 180 };

export class Lobby {
  room: Room | null = null;
  players: PlayerInfo[] = [];
  setup: NetSetup = { ...DEFAULT_SETUP };
  hostId = '';
  /** A game is running (the host's lobby shows it; late joiners wait for the next). */
  inGame = false;
  private ready = new Set<string>();
  private readyTimer = 0;

  /** The lobby changed: players, setup, connection. */
  onChange?: () => void;
  onStart?: (setup: NetSetup, roster: RosterEntry[]) => void;
  onGo?: () => void;
  onSnap?: (id: string, s: number[]) => void;
  /** A rider simulated elsewhere finished, at `time` on their race clock. */
  onFinish?: (id: string, time: number) => void;
  onTag?: (it: string, times: Record<string, number>) => void;
  /** The host ended the game: back to the lobby. */
  onEnd?: () => void;
  /** A player left mid-game. */
  onLeft?: (id: string) => void;
  /** The room closed under us. */
  onClosed?: (reason: string) => void;

  get isHost() {
    return this.room?.isHost ?? false;
  }

  get selfId() {
    return this.room?.selfId ?? '';
  }

  get code() {
    return this.room?.code ?? '';
  }

  async host(me: PlayerInfo) {
    const room = await Room.host();
    this.attach(room);
    this.hostId = room.selfId;
    this.players = [{ ...me, id: room.selfId, name: cleanName(me.name) }];
    room.onLeave = (id) => {
      this.players = this.players.filter((p) => p.id !== id);
      this.ready.delete(id);
      room.broadcast({ t: 'bye', id });
      this.onLeft?.(id);
      this.broadcastLobby();
      this.checkReady();
    };
    this.onChange?.();
  }

  async join(code: string, me: PlayerInfo) {
    const room = await Room.join(code);
    this.attach(room);
    room.send({ t: 'hello', info: { ...me, id: room.selfId } });
    this.onChange?.();
  }

  private attach(room: Room) {
    this.room = room;
    this.inGame = false;
    room.onMessage = (msg, from) => this.handle(msg, from);
    room.onClosed = (reason) => {
      this.reset();
      this.onClosed?.(reason);
    };
  }

  private handle(msg: Msg, from: string) {
    switch (msg.t) {
      case 'hello': {
        if (!this.isHost) return;
        const info = { ...msg.info, id: from, name: cleanName(msg.info.name) };
        const i = this.players.findIndex((p) => p.id === from);
        if (i >= 0) this.players[i] = info;
        else if (this.players.length < MAX_RIDERS) this.players.push(info);
        else return this.room!.kick(from);
        this.broadcastLobby();
        return;
      }
      case 'lobby':
        this.hostId = msg.host;
        this.players = msg.players;
        this.setup = msg.setup;
        this.inGame = msg.inGame;
        this.onChange?.();
        return;
      case 'start':
        this.inGame = true;
        this.setup = msg.setup;
        this.onStart?.(msg.setup, msg.roster);
        return;
      case 'ready':
        if (this.isHost) {
          this.ready.add(from);
          this.checkReady();
        }
        return;
      case 'go':
        this.onGo?.();
        return;
      case 'snap':
        this.onSnap?.(msg.id, msg.s);
        return;
      case 'finish':
        this.onFinish?.(msg.id, msg.time);
        return;
      case 'tag':
        this.onTag?.(msg.it, msg.times);
        return;
      case 'end':
        this.inGame = false;
        this.onEnd?.();
        return;
      case 'bye':
        this.players = this.players.filter((p) => p.id !== msg.id);
        this.onLeft?.(msg.id);
        this.onChange?.();
        return;
    }
  }

  private broadcastLobby() {
    this.room?.broadcast({ t: 'lobby', host: this.hostId, players: this.players, setup: this.setup, inGame: this.inGame });
    this.onChange?.();
  }

  /** Your name, bike or colour changed. */
  updateMe(me: Omit<PlayerInfo, 'id'>) {
    if (!this.room) return;
    if (this.isHost) {
      const i = this.players.findIndex((p) => p.id === this.selfId);
      if (i >= 0) this.players[i] = { ...me, id: this.selfId, name: cleanName(me.name) };
      this.broadcastLobby();
    } else {
      this.room.send({ t: 'hello', info: { ...me, id: this.selfId } });
    }
  }

  /** Host: change the game. */
  configure(patch: Partial<NetSetup>) {
    if (!this.isHost) return;
    Object.assign(this.setup, patch);
    this.broadcastLobby();
  }

  /** Host: everyone to the start. AI riders fill a race grid; tag and free ride are players only. */
  start() {
    if (!this.isHost) return;
    const roster: RosterEntry[] = this.players.map((p, slot) => ({
      id: `${p.id}:0`, owner: p.id, name: p.name, colour: p.colour, bike: p.bike, slot, ai: false,
    }));
    if (this.setup.mode === 'race' || this.setup.mode === 'baja') {
      const room = Math.min(this.setup.ai, MAX_RIDERS - roster.length);
      const bike = this.players[0].bike;
      aiRidersFor(this.players.map((p) => p.colour), room).forEach((r, n) => {
        roster.push({ id: `${this.selfId}:ai${n}`, owner: this.selfId, name: r.name, colour: r.colour, bike, slot: roster.length, ai: true });
      });
    }
    this.inGame = true;
    this.ready.clear();
    this.room!.broadcast({ t: 'start', setup: this.setup, roster });
    this.onStart?.(this.setup, roster);
    clearTimeout(this.readyTimer);
    this.readyTimer = window.setTimeout(() => this.go(), READY_TIMEOUT);
  }

  /** This machine has loaded the venue and is on the line. */
  markReady() {
    if (!this.room) return;
    if (this.isHost) {
      this.ready.add(this.selfId);
      this.checkReady();
    } else {
      this.room.send({ t: 'ready', id: this.selfId });
    }
  }

  private checkReady() {
    if (!this.isHost || !this.inGame || this.readyTimer === 0) return;
    if (this.players.every((p) => this.ready.has(p.id))) this.go();
  }

  private go() {
    if (this.readyTimer === 0) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = 0;
    this.room?.broadcast({ t: 'go' });
    this.onGo?.();
  }

  sendSnaps(snaps: { id: string; s: number[] }[]) {
    for (const { id, s } of snaps) this.room?.send({ t: 'snap', id, s });
  }

  /** One of our riders finished: everyone else takes our word for it. */
  sendFinish(id: string, time: number) {
    this.room?.send({ t: 'finish', id, time });
  }

  /** Host: who's it now, and everyone's time. */
  sendTag(it: string, times: Record<string, number>) {
    if (this.isHost) this.room?.broadcast({ t: 'tag', it, times });
  }

  /** Host: game over, everyone back to the lobby. */
  end() {
    if (!this.isHost) return;
    this.inGame = false;
    this.room?.broadcast({ t: 'end' });
    this.broadcastLobby();
    this.onEnd?.();
  }

  leave() {
    this.room?.leave();
    this.reset();
  }

  private reset() {
    clearTimeout(this.readyTimer);
    this.readyTimer = 0;
    this.room = null;
    this.players = [];
    this.setup = { ...DEFAULT_SETUP };
    this.inGame = false;
    this.ready.clear();
  }
}
