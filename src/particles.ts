import * as THREE from 'three';
import { type Heightmap, sampleHeight } from './heightmap.ts';

// Dirt in the air: soft dust clouds trailing the rear wheels, and roost (clods flung back by a
// driving, spinning tyre) that arc under gravity and stop when they hit the ground. Landings throw
// up a burst of both. Two pools of points shared by every bike, so it's two draw calls in total.

/** What the ground throws up at a venue. */
export interface DirtLook {
  dust: number;
  clod: number;
  /** Multipliers on how much of each. */
  dustAmount: number;
  clodAmount: number;
}

export const DEFAULT_DIRT: DirtLook = { dust: 0x9c7c5a, clod: 0x4e3826, dustAmount: 1, clodAmount: 1 };

/** A bike as far as dirt is concerned: physics bikes and network riders both fit. */
export interface DirtSource {
  body: { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number }; linvel(): { x: number; y: number; z: number } };
  wheels: readonly { attach: THREE.Vector3; rayLength: number; grounded?: boolean; slip?: number }[];
  speed: number;
  throttle: number;
  /** Locked and sliding: a skid throws up much more dust. */
  rearLocked?: boolean;
}

const WHEEL_RADIUS = 0.34;
const DUST_MAX = 900;
const CLOD_MAX = 1400;

class Pool {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly shade: Float32Array;
  private ageAttr: THREE.BufferAttribute;
  private posAttr: THREE.BufferAttribute;
  private next = 0;
  readonly max: number;

  constructor(max: number, material: THREE.ShaderMaterial) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1); // age / life: 1 = dead
    this.life = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.shade = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ageAttr = new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAge', this.ageAttr);
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aShade', new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, shade: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.shade[i] = shade;
  }

  flush() {
    this.posAttr.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
    const g = this.points.geometry;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aShade') as THREE.BufferAttribute).needsUpdate = true;
  }
}

const vertex = /* glsl */ `
attribute float aAge;
attribute float aSize;
attribute float aShade;
uniform float uScale;
uniform float uGrow;
uniform float uMaxPx;
varying float vAge;
varying float vShade;
varying float vNear;
#include <fog_pars_vertex>
void main() {
  vAge = aAge;
  vShade = aShade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Dust right at the camera fades out instead of filling the screen (and the GPU) with layers.
  vNear = smoothstep(1.5, 6.0, -mvPosition.z);
  float size = aSize * (1.0 + uGrow * aAge);
  gl_PointSize = aAge >= 1.0 ? 0.0 : min(uMaxPx, size * uScale / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const dustFragment = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
varying float vAge;
varying float vShade;
varying float vNear;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float fade = (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.0, 0.08, vAge);
  gl_FragColor = vec4(uColour * vShade, uOpacity * fade * (1.0 - r) * vNear);
  #include <fog_fragment>
}`;

const clodFragment = /* glsl */ `
uniform vec3 uColour;
varying float vAge;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // A rough lump rather than a perfect disc, lit from above.
  float a = atan(c.y, c.x);
  float edge = 0.86 + 0.08 * sin(a * 5.0 + vShade * 23.0) + 0.06 * sin(a * 2.0 - vShade * 11.0);
  if (dot(c, c) > edge * edge) discard;
  gl_FragColor = vec4(uColour * vShade * (1.15 - 0.45 * c.y), 1.0);
  #include <fog_fragment>
}`;

function material(fragment: string, opts: { transparent: boolean; grow: number; maxPx: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uColour: { value: new THREE.Color() }, uOpacity: { value: 0.42 }, uScale: { value: 400 }, uGrow: { value: opts.grow }, uMaxPx: { value: opts.maxPx } },
    ]),
    transparent: opts.transparent,
    depthWrite: !opts.transparent,
    fog: true,
  });
}

interface BikeState {
  airTime: number;
  wasGrounded: boolean;
  dust: number;
  clods: number;
}

const _q = new THREE.Quaternion();
const _contact = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();

export class DirtParticles {
  readonly group = new THREE.Group();
  private dust: Pool;
  private clods: Pool;
  private dustMat: THREE.ShaderMaterial;
  private clodMat: THREE.ShaderMaterial;
  private hm: Heightmap | null = null;
  private look: DirtLook = DEFAULT_DIRT;
  private state = new WeakMap<object, BikeState>();
  private seed = 1;

  constructor() {
    this.dustMat = material(dustFragment, { transparent: true, grow: 3.2, maxPx: 360 });
    this.clodMat = material(clodFragment, { transparent: false, grow: 0, maxPx: 22 });
    this.dust = new Pool(DUST_MAX, this.dustMat);
    this.clods = new Pool(CLOD_MAX, this.clodMat);
    this.dust.points.renderOrder = 5;
    this.group.add(this.clods.points, this.dust.points);
  }

  private rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A new venue: its ground (for clods to land on) and its colours. Clears what's in the air. */
  setVenue(hm: Heightmap, look: DirtLook = DEFAULT_DIRT) {
    this.hm = hm;
    this.look = look;
    (this.dustMat.uniforms.uColour.value as THREE.Color).set(look.dust);
    (this.clodMat.uniforms.uColour.value as THREE.Color).set(look.clod);
    this.dust.age.fill(1);
    this.clods.age.fill(1);
  }

  /** Point sizes are in world metres: scale them for the camera and screen. */
  setView(camera: THREE.PerspectiveCamera, heightPx: number) {
    const scale = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.dustMat.uniforms.uScale.value = scale;
    this.clodMat.uniforms.uScale.value = scale;
  }

  /** Per rendered frame: throw up dirt from each bike, then move everything in the air. */
  update(dt: number, bikes: DirtSource[]) {
    if (dt <= 0) return;
    for (const b of bikes) this.emit(b, dt);
    this.step(dt);
  }

  private emit(b: DirtSource, dt: number) {
    let s = this.state.get(b);
    if (!s) this.state.set(b, (s = { airTime: 0, wasGrounded: true, dust: 0, clods: 0 }));
    const t = b.body.translation(), r = b.body.rotation(), v = b.body.linvel();
    _q.set(r.x, r.y, r.z, r.w);
    const rear = b.wheels[1];
    _contact.set(rear.attach.x, rear.attach.y - rear.rayLength - WHEEL_RADIUS * 0.1, rear.attach.z).applyQuaternion(_q).add(t as THREE.Vector3Like);
    // Network riders don't say whether a wheel is down: judge it from the ground under them.
    const groundY = this.hm ? sampleHeight(this.hm, _contact.x, _contact.z) : _contact.y;
    const grounded = rear.grounded ?? _contact.y - groundY < 0.25;
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _side.set(1, 0, 0).applyQuaternion(_q);
    const speed = Math.abs(b.speed);
    const look = this.look;

    if (grounded) {
      // Landing: a burst that grows with the drop.
      if (!s.wasGrounded && s.airTime > 0.25) {
        const hit = Math.min(1, Math.abs(v.y) / 9 + s.airTime / 2);
        this.burst(_contact.x, groundY, _contact.z, v, hit);
      }
      s.airTime = 0;
      // Dust trail: more the faster you go, and a thick cloud from a locked, sliding rear.
      s.dust += dt * Math.max(0, speed - 2) * (b.rearLocked ? 7 : 2.4) * look.dustAmount;
      if (b.rearLocked && speed > 3) s.clods += dt * speed * 1.5 * look.clodAmount;
      while (s.dust >= 1) {
        s.dust -= 1;
        this.dust.spawn(
          _contact.x + (this.rand() - 0.5) * 0.5, groundY + 0.15, _contact.z + (this.rand() - 0.5) * 0.5,
          v.x * 0.15 + (this.rand() - 0.5) * 1.2, 0.4 + this.rand() * 0.8, v.z * 0.15 + (this.rand() - 0.5) * 1.2,
          1.4 + this.rand() * 1.4, 0.5 + this.rand() * 0.5, 0.85 + this.rand() * 0.3,
        );
      }
      // Roost: a driving tyre, and especially a spinning one, flings clods back and up.
      const slip = rear.slip ?? Math.min(1, b.throttle * 0.6);
      const drive = Math.max(0, b.throttle - 0.3) * (slip * 70 + Math.min(speed, 20) * 1.8);
      s.clods += dt * drive * look.clodAmount;
      while (s.clods >= 1) {
        s.clods -= 1;
        const kick = 3 + slip * 6 + this.rand() * 3;
        const lift = 2 + this.rand() * 4 * (0.5 + slip);
        const sideways = (this.rand() - 0.5) * 2.4;
        this.clods.spawn(
          _contact.x - _fwd.x * 0.3, groundY + 0.05, _contact.z - _fwd.z * 0.3,
          v.x * 0.6 - _fwd.x * kick + _side.x * sideways, lift, v.z * 0.6 - _fwd.z * kick + _side.z * sideways,
          1.2 + this.rand() * 0.6, 0.035 + this.rand() * 0.045, 0.8 + this.rand() * 0.5,
        );
        // A puff of dust with the roost.
        if (this.rand() < 0.25 * look.dustAmount) {
          this.dust.spawn(
            _contact.x, groundY + 0.2, _contact.z, -_fwd.x * kick * 0.3, 0.8, -_fwd.z * kick * 0.3,
            1.0 + this.rand(), 0.4 + this.rand() * 0.4, 0.9 + this.rand() * 0.2,
          );
        }
      }
    } else {
      s.airTime += dt;
    }
    s.wasGrounded = grounded;
  }

  private burst(x: number, y: number, z: number, v: { x: number; y: number; z: number }, strength: number) {
    const dustCount = Math.round(6 + 16 * strength * this.look.dustAmount);
    for (let i = 0; i < dustCount; i++) {
      const a = this.rand() * Math.PI * 2, out = 1 + this.rand() * 3 * strength;
      this.dust.spawn(x, y + 0.2, z, v.x * 0.2 + Math.cos(a) * out, 0.5 + this.rand() * 1.5, v.z * 0.2 + Math.sin(a) * out,
        1.6 + this.rand() * 1.4, 0.7 + this.rand() * 0.7, 0.85 + this.rand() * 0.3);
    }
    const clodCount = Math.round(8 * strength * this.look.clodAmount);
    for (let i = 0; i < clodCount; i++) {
      const a = this.rand() * Math.PI * 2, out = 1.5 + this.rand() * 3;
      this.clods.spawn(x, y + 0.05, z, v.x * 0.3 + Math.cos(a) * out, 2 + this.rand() * 3 * strength, v.z * 0.3 + Math.sin(a) * out,
        1.0 + this.rand() * 0.5, 0.035 + this.rand() * 0.045, 0.8 + this.rand() * 0.5);
    }
  }

  private step(dt: number) {
    // Dust drifts, slows and rises a little; clods fly under gravity and stop on the ground.
    const d = this.dust, c = this.clods;
    const dustDrag = Math.exp(-dt * 2.2);
    for (let i = 0; i < d.max; i++) {
      if (d.age[i] >= 1) continue;
      d.age[i] = Math.min(1, d.age[i] + dt / d.life[i]);
      const j = i * 3;
      d.vel[j] *= dustDrag;
      d.vel[j + 1] = d.vel[j + 1] * dustDrag + 0.15 * dt;
      d.vel[j + 2] *= dustDrag;
      d.pos[j] += d.vel[j] * dt;
      d.pos[j + 1] += d.vel[j + 1] * dt;
      d.pos[j + 2] += d.vel[j + 2] * dt;
    }
    for (let i = 0; i < c.max; i++) {
      if (c.age[i] >= 1) continue;
      c.age[i] = Math.min(1, c.age[i] + dt / c.life[i]);
      const j = i * 3;
      c.vel[j + 1] -= 9.81 * dt;
      c.pos[j] += c.vel[j] * dt;
      c.pos[j + 1] += c.vel[j + 1] * dt;
      c.pos[j + 2] += c.vel[j + 2] * dt;
      if (this.hm && c.vel[j + 1] < 0 && c.pos[j + 1] < sampleHeight(this.hm, c.pos[j], c.pos[j + 2])) c.age[i] = 1;
    }
    d.flush();
    c.flush();
  }

  clear() {
    this.dust.age.fill(1);
    this.clods.age.fill(1);
    this.dust.flush();
    this.clods.flush();
  }
}
