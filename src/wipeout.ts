import * as THREE from "three";
import { JOINT as J, JOINT_COUNT, type Skier } from "./skier";
import { makePole, makeSki, SKI_TAIL } from "./equipment";
import type { Terrain } from "./terrain";
import type { Particles } from "./particles";

const G = 9.81;
const ITERATIONS = 8;
/** Kilograms and collision radii (m, before the rider's scale) per joint. */
const MASS = [14, 16, 5, 5, 5, 2, 2, 1, 1, 8, 8, 5, 5, 3, 3];
const RADIUS = [0.12, 0.12, 0.12, 0.08, 0.08, 0.06, 0.06, 0.05, 0.05, 0.09, 0.09, 0.07, 0.07, 0.08, 0.08];
/** How much of the run each joint keeps when the skis bite: the feet stop, the rest is thrown over them. */
const CARRY = [0.9, 1, 1, 1, 1, 1, 1, 1, 1, 0.85, 0.85, 0.65, 0.65, 0.4, 0.4];
/** The rider lies still this long before getting back up, and never takes longer than the cap. */
const SETTLE_TIME = 0.7;
const MAX_TIME = 6.5;

interface Stick { a: number; b: number; len: number; min: boolean }

/** Verlet points held together by sticks, sliding and bouncing on the snow. */
class Verlet {
  readonly p: THREE.Vector3[] = [];
  readonly prev: THREE.Vector3[] = [];
  readonly w: number[] = [];
  readonly r: number[] = [];
  /** Per point, this step: how far the snow pushed it out, along which normal, and how hard it hit (m/s). */
  readonly push: number[] = [];
  readonly n: THREE.Vector3[] = [];
  readonly hit: number[] = [];
  readonly slide: number[] = [];
  readonly sticks: Stick[] = [];
  private v = new THREE.Vector3();
  private t = new THREE.Vector3();

  /** `mu` is Coulomb friction, `plough` the snow's drag on anything dug in, `bounce` the restitution. */
  constructor(private terrain: Terrain, private mu: number, private plough: number, private bounce: number) {}

  add(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, mass: number, radius: number) {
    this.p.push(pos.clone());
    this.prev.push(pos.clone().addScaledVector(vel, -dt));
    this.w.push(1 / mass);
    this.r.push(radius);
    this.push.push(0);
    this.n.push(new THREE.Vector3(0, 1, 0));
    this.hit.push(0);
    this.slide.push(0);
  }

  stick(a: number, b: number, len = this.p[a].distanceTo(this.p[b]), min = false) {
    this.sticks.push({ a, b, len, min });
  }

  velocity(i: number, dt: number, out: THREE.Vector3) {
    return out.subVectors(this.p[i], this.prev[i]).divideScalar(dt);
  }

  step(dt: number, limits?: () => void) {
    const { p, prev } = this;
    for (let i = 0; i < p.length; i++) {
      this.v.subVectors(p[i], prev[i]).multiplyScalar(0.999);
      prev[i].copy(p[i]);
      p[i].add(this.v).y -= G * dt * dt;
      this.push[i] = 0;
    }
    for (let k = 0; k < ITERATIONS; k++) {
      for (const s of this.sticks) this.solve(s);
      limits?.();
      for (let i = 0; i < p.length; i++) this.collide(i);
    }
    for (let i = 0; i < p.length; i++) {
      this.hit[i] = this.slide[i] = 0;
      if (this.push[i] <= 0) continue;
      // the snow stops the fall into it (with a little bounce) and grips in proportion to how hard it pushed
      const n = this.n[i];
      const v = this.v.subVectors(p[i], prev[i]);
      const vn = v.dot(n);
      const into = Math.max(0, this.push[i] - vn);
      const tangent = this.t.copy(v).addScaledVector(n, -vn);
      const t = tangent.length();
      tangent.multiplyScalar(t > 1e-9 ? Math.max(0, 1 - (this.mu * this.push[i]) / t) * Math.exp(-this.plough * dt) : 0);
      prev[i].copy(p[i]).sub(tangent).addScaledVector(n, -(Math.max(0, vn) + this.bounce * into));
      this.hit[i] = into / dt;
      this.slide[i] = tangent.length() / dt;
    }
  }

  private solve(s: Stick) {
    const a = this.p[s.a], b = this.p[s.b];
    const d = this.v.subVectors(b, a);
    const len = d.length();
    if (len < 1e-6 || (s.min && len >= s.len)) return;
    const wa = this.w[s.a], wb = this.w[s.b];
    const f = (len - s.len) / (len * (wa + wb));
    a.addScaledVector(d, f * wa);
    b.addScaledVector(d, -f * wb);
  }

  private collide(i: number) {
    const p = this.p[i];
    const gap = this.terrain.heightAt(p.x, p.z) + this.r[i] - p.y;
    if (gap <= 0) return;
    const n = this.n[i];
    if (this.push[i] === 0) this.terrain.normalAt(p.x, p.z, n);
    const depth = gap * n.y;
    p.addScaledVector(n, depth);
    this.push[i] += depth;
  }
}

/** A ski or pole torn off in the fall: a two-point stick tumbling end over end. */
interface Loose {
  body: Verlet;
  mesh: THREE.Group;
  ski: boolean;
  /** Where the topsheet faces, and how fast it rolls about the ski's length. */
  up: THREE.Vector3;
  roll: number;
  cooldown: number;
}

export interface WipeoutEvents {
  onThud?: (impact: number) => void;
}

/**
 * A fall: the rider goes limp as a ragdoll, the bindings let go, and skis and poles
 * cartwheel off on their own. Everything throws up snow where it hits.
 */
export class Wipeout {
  active = false;
  /** Seconds since the fall, and how long the body has been lying still. */
  time = 0;
  still = 0;
  events: WipeoutEvents = {};
  readonly joints = Array.from({ length: JOINT_COUNT }, () => new THREE.Vector3());
  readonly velocity = new THREE.Vector3();

  private body: Verlet;
  private gear: Loose[] = [];
  private cooldown = new Float32Array(JOINT_COUNT);
  private sprayAcc = new Float32Array(JOINT_COUNT);
  private thudCooldown = 0;
  private scale = 1;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor(private scene: THREE.Scene, private terrain: Terrain, private particles: Particles) {
    this.body = new Verlet(terrain, 0.5, 0.6, 0.08);
  }

  /** The body has stopped tumbling and lain still a moment, or it has been long enough. */
  get settled() {
    return this.active && ((this.time > 1.4 && this.still > SETTLE_TIME) || this.time > MAX_TIME);
  }

  get pelvis() {
    return this.body.p[J.pelvis];
  }

  /** Fall from the skier's current pose with the given velocity, on snow facing `normal`. */
  start(skier: Skier, vel: THREE.Vector3, normal: THREE.Vector3, dt: number) {
    this.clear();
    this.active = true;
    this.time = this.still = this.thudCooldown = 0;
    this.scale = skier.root.scale.x;
    const s = this.scale;
    const rand = (a: number) => (Math.random() * 2 - 1) * a;

    // the edges bite and stop the feet; whatever hit the snow along its normal goes into the body, not back out
    const into = Math.min(0, vel.dot(normal));
    const slide = new THREE.Vector3().copy(vel).addScaledVector(normal, -vel.dot(normal));
    const across = new THREE.Vector3().crossVectors(normal, slide).normalize();
    const twist = rand(1.6);

    skier.captureJoints(this.joints);
    const body = (this.body = new Verlet(this.terrain, 0.5, 0.6, 0.08));
    for (let i = 0; i < JOINT_COUNT; i++) {
      const v = this.tmp.copy(slide).multiplyScalar(CARRY[i]).addScaledVector(normal, into * (CARRY[i] - 0.4));
      // thrown off balance: the shoulders wrench round and the arms fly out
      if (i === J.shoulder[0] || i === J.shoulder[1]) v.addScaledVector(across, i === J.shoulder[0] ? twist : -twist);
      if (i === J.chest || i === J.head) v.addScaledVector(normal, 0.6 + Math.random() * 0.8);
      if (i === J.hand[0] || i === J.hand[1] || i === J.elbow[0] || i === J.elbow[1]) v.add(this.tmp3.set(rand(2), 1 + Math.random() * 2, rand(2)));
      body.add(this.joints[i], v, dt, MASS[i], RADIUS[i] * s);
    }
    // the trunk and head are one rigid piece
    const trunk = [J.pelvis, J.chest, J.head, ...J.shoulder, ...J.hip];
    for (let a = 0; a < trunk.length; a++) for (let b = a + 1; b < trunk.length; b++) body.stick(trunk[a], trunk[b]);
    for (let i = 0; i < 2; i++) {
      body.stick(J.shoulder[i], J.elbow[i]);
      body.stick(J.elbow[i], J.hand[i]);
      body.stick(J.hip[i], J.knee[i]);
      body.stick(J.knee[i], J.foot[i]);
      // joints only fold so far: forearm against upper arm, calf against thigh, thigh against chest
      body.stick(J.shoulder[i], J.hand[i], 0.22 * s, true);
      body.stick(J.hip[i], J.foot[i], 0.26 * s, true);
      body.stick(J.chest, J.knee[i], 0.32 * s, true);
    }

    // bindings release: the skis spring off the boots and the poles fly out of the hands
    skier.gear = false;
    const tail = new THREE.Vector3(), tip = new THREE.Vector3(), up = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      skier.skiEnds(i, tail, tip, up);
      this.loose(makeSki(skier.character.skis, skier.character.accent, skier.character.outfit), true, tail, tip, up, slide, normal, dt, 0.55, 0.8 + Math.random() * 1.6, 1 + Math.random() * 1.8);
      skier.poleEnds(i, tail, tip);
      this.loose(makePole(skier.character.accent, i ? 1 : -1), false, tail, tip, up, slide, normal, dt, 0.85, 1.5 + Math.random() * 2, 2 + Math.random() * 3);
    }

    // the first slam into the snow
    const feet = this.tmp.addVectors(this.joints[J.foot[0]], this.joints[J.foot[1]]).multiplyScalar(0.5);
    this.puff(feet, slide, 8 + Math.min(10, vel.length() * 0.6), 1);
    this.pose();
  }

  private loose(mesh: THREE.Group, ski: boolean, a: THREE.Vector3, b: THREE.Vector3, up: THREE.Vector3, slide: THREE.Vector3, normal: THREE.Vector3, dt: number, carry: number, pop: number, spin: number) {
    const rand = (k: number) => (Math.random() * 2 - 1) * k;
    const body = ski ? new Verlet(this.terrain, 0.6, 1.5, 0.3) : new Verlet(this.terrain, 0.4, 1, 0.35);
    const v = this.tmp.copy(slide).multiplyScalar(carry).addScaledVector(normal, pop).add(this.tmp2.set(rand(1.5), 0, rand(1.5)));
    // the ends fly apart in opposite directions, so it cartwheels
    const kick = this.tmp2.set(rand(1), rand(1), rand(1)).normalize().multiplyScalar(spin);
    const r = (ski ? 0.03 : 0.02) * this.scale;
    body.add(a, this.tmp3.copy(v).sub(kick), dt, 1, r);
    body.add(b, this.tmp3.copy(v).add(kick), dt, 1, r);
    body.stick(0, 1);
    mesh.scale.setScalar(this.scale);
    this.scene.add(mesh);
    this.gear.push({ body, mesh, ski, up: up.clone(), roll: rand(14), cooldown: 0 });
  }

  update(dt: number) {
    if (!this.active) return;
    this.time += dt;
    this.thudCooldown -= dt;
    const body = this.body;
    body.step(dt, () => this.limits());

    let thud = 0;
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.cooldown[i] -= dt;
      const p = body.p[i];
      if (body.hit[i] > 3 && this.cooldown[i] <= 0) {
        this.cooldown[i] = 0.25;
        this.puff(p, body.velocity(i, dt, this.tmp2), Math.min(6, body.hit[i] * 0.6), 0.7 + MASS[i] / 25);
        thud = Math.max(thud, body.hit[i]);
      }
      // sliding on its front or back ploughs up a wake of powder
      if (body.slide[i] > 2.5 && MASS[i] >= 5) {
        this.sprayAcc[i] += body.slide[i] * 0.9 * dt;
        while (this.sprayAcc[i] > 1) {
          this.sprayAcc[i] -= 1;
          this.spray(p, body.velocity(i, dt, this.tmp2));
        }
      }
    }
    if (thud > 4 && this.thudCooldown <= 0) {
      this.thudCooldown = 0.12;
      this.events.onThud?.(thud);
    }

    for (const g of this.gear) this.updateLoose(g, dt);

    body.velocity(J.pelvis, dt, this.velocity);
    const moving = Math.max(this.velocity.length(), body.velocity(J.chest, dt, this.tmp).length(), body.velocity(J.head, dt, this.tmp).length());
    this.still = moving < 0.6 ? this.still + dt : 0;
    this.pose();
  }

  private pose() {
    for (let i = 0; i < JOINT_COUNT; i++) this.joints[i].copy(this.body.p[i]);
  }

  /** Knees only bend forward, and a thigh can't swing far behind the trunk. */
  private limits() {
    const p = this.body.p;
    const up = this.tmp.subVectors(p[J.chest], p[J.pelvis]).normalize();
    const right = this.tmp2.subVectors(p[J.shoulder[1]], p[J.shoulder[0]]);
    right.addScaledVector(up, -right.dot(up)).normalize();
    const fwd = right.crossVectors(right, up).normalize();
    for (let i = 0; i < 2; i++) {
      const hip = p[J.hip[i]], knee = p[J.knee[i]], foot = p[J.foot[i]];
      const thigh = this.tmp3.subVectors(knee, hip);
      const back = -0.3 * thigh.length() - thigh.dot(fwd);
      if (back > 0) knee.addScaledVector(fwd, back * 0.7);
      const axis = this.tmp3.subVectors(foot, hip);
      const along = axis.lengthSq();
      if (along < 1e-6) continue;
      // forward, square to the hip-foot line
      const bend = axis.multiplyScalar(-fwd.dot(axis) / along).add(fwd);
      const off = knee.x * bend.x + knee.y * bend.y + knee.z * bend.z - (hip.dot(bend) + foot.dot(bend)) / 2;
      if (off < 0) {
        const len = bend.lengthSq();
        knee.addScaledVector(bend, (-off / len) * 0.8);
        hip.addScaledVector(bend, (off / len) * 0.1);
        foot.addScaledVector(bend, (off / len) * 0.1);
      }
    }
  }

  private updateLoose(g: Loose, dt: number) {
    const b = g.body;
    b.step(dt);
    const a = b.p[0], tip = b.p[1];
    const dir = this.tmp.subVectors(tip, a).normalize();
    const grounded = b.push[0] > 0 || b.push[1] > 0;
    g.cooldown -= dt;
    const hit = Math.max(b.hit[0], b.hit[1]);
    if (hit > 3 && g.cooldown <= 0) {
      g.cooldown = 0.2;
      this.puff(b.hit[0] > b.hit[1] ? a : tip, b.velocity(0, dt, this.tmp2), Math.min(5, hit * 0.6), 0.6);
    }
    if (g.ski) {
      // tumbling, the ski rolls about its length; on the snow it falls flat onto its base or topsheet
      if (grounded) {
        const n = b.push[0] > 0 ? b.n[0] : b.n[1];
        g.up.lerp(this.tmp2.copy(n).multiplyScalar(Math.sign(g.up.dot(n)) || 1), 1 - Math.exp(-14 * dt));
        g.roll *= Math.exp(-8 * dt);
      } else g.up.applyAxisAngle(dir, g.roll * dt);
      g.up.addScaledVector(dir, -g.up.dot(dir)).normalize();
      const x = this.tmp2.crossVectors(g.up, dir);
      g.mesh.quaternion.setFromRotationMatrix(this.m.makeBasis(x, g.up, dir));
      g.mesh.position.copy(a).addScaledVector(dir, -SKI_TAIL * this.scale);
    } else {
      g.mesh.quaternion.setFromUnitVectors(this.tmp2.set(0, -1, 0), dir);
      g.mesh.position.copy(a);
    }
    // a little powder kicked up while it skids along
    const slide = Math.max(b.slide[0], b.slide[1]);
    if (slide > 3 && Math.random() < slide * dt * 1.5) this.spray(b.slide[0] > b.slide[1] ? a : tip, b.velocity(0, dt, this.tmp2));
  }

  /** A burst of powder: soft clouds that hang and spread, plus a few clumps that fall straight back. */
  private puff(at: THREE.Vector3, drift: THREE.Vector3, count: number, scale: number) {
    for (let k = 0; k < count; k++) {
      const p = this.tmp3.set(at.x + (Math.random() - 0.5) * 0.4 * scale, at.y + Math.random() * 0.15, at.z + (Math.random() - 0.5) * 0.4 * scale);
      const a = Math.random() * Math.PI * 2;
      const out = (0.8 + Math.random() * 2.2) * scale;
      const v = new THREE.Vector3(Math.cos(a) * out, (0.8 + Math.random() * 1.6) * scale, Math.sin(a) * out).addScaledVector(drift, 0.35);
      if (k % 4 === 3) {
        this.particles.emit(p, v.multiplyScalar(1.4), { size: 0.06 + Math.random() * 0.07, life: 0.6 + Math.random() * 0.4, drag: 1.2 });
      } else {
        this.particles.emit(p, v, {
          size: (0.18 + Math.random() * 0.24) * scale,
          life: 1 + Math.random() * 1,
          grow: 2.4 + Math.random() * 0.8,
          gravity: 0.15,
          drag: 3,
          color: Math.random() < 0.5 ? 0xffffff : 0xc9d3e4,
        });
      }
    }
  }

  private spray(at: THREE.Vector3, vel: THREE.Vector3) {
    this.particles.emit(
      this.tmp3.copy(at).setY(at.y + 0.05),
      new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5).addScaledVector(vel, 0.4),
      { size: 0.16 + Math.random() * 0.2, life: 0.8 + Math.random() * 0.6, grow: 2.2, gravity: 0.3, drag: 2.5, color: Math.random() < 0.5 ? 0xffffff : 0xdbe2ee },
    );
  }

  /** Pick everything up: the loose skis and poles leave the scene. */
  clear() {
    for (const g of this.gear) {
      this.scene.remove(g.mesh);
      g.mesh.traverse((part) => {
        if (part instanceof THREE.Mesh) part.geometry.dispose();
      });
    }
    this.gear.length = 0;
    this.active = false;
  }
}
