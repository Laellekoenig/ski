import * as THREE from "three";
import { Skier } from "./skier";
import type { World } from "./world";
import type { InputState } from "./input";
import type { Particles } from "./particles";
import type { Trails } from "./trails";
import { BOUNDS, RUN_END, SUMMIT } from "./layout";
import type { Surface } from "./terrain";
import { damp, lerp, smoothstep } from "./noise";
import { Wipeout } from "./wipeout";

const G = 9.81;
const MU = 0.08;
/** Quadratic air drag per metre (≈ ½ρC_dA/m), upright and tucked. */
const DRAG = 0.011;
const DRAG_TUCK = 0.0068;
/** Shift's low racing crouch: even less drag, at the cost of most of the steering. */
const DRAG_DUCK = 0.0042;
const DUCK_STEER = 0.3;
/** Share of the sideways kinetic energy an edge carves back into forward speed. */
const CARVE_KEEP = 0.85;
/** Skating: push strength from standstill, fading out by this speed. */
const SKATE_ACC = 4.5;
const SKATE_MAX = 9;
/** Uphill grade (rise per metre travelled) at which skating stops helping. */
const SKATE_MAX_GRADE = 0.07;
/** Jump pop along the snow's normal, plus a little straight up. */
const JUMP_POP = 3.4;
const JUMP_LIFT = 0.8;
/** Double-tap swing: a quick pivot across the skis that sheds part of the speed in a burst of snow. */
const SWING_TIME = 0.45;
const SWING_YAW = 0.5;
const SWING_SHED = 0.3;
const SWING_SHED_MAX = 6;
const SWING_MIN_SPEED = 4;
/** Landing harder than this into the snow (m/s along its normal) folds the legs and throws the rider. */
const CRASH_IMPACT = 15;
/** After a fall: the screen washes out to snow white, the rider is back on the skis, and it clears. */
const FADE_OUT = 0.35;
const FADE_HOLD = 0.15;
const FADE_IN = 0.5;
/** Down the single snowfield, toward the Engadine backdrop. */
export const START_HEADING = 0;

export type PlayerState = "ski" | "crash";

export interface PlayerEvents {
  onJump?: () => void;
  onLand?: (impact: number, airTime: number) => void;
  onCrash?: () => void;
  /** A body part slamming into the snow mid-fall. */
  onThud?: (impact: number) => void;
  onTrick?: (label: string) => void;
  onSwing?: () => void;
  onFinish?: (runDistance: number) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  skier = new Skier();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0;
  state: PlayerState = "ski";
  grounded = true;
  airTime = 0;
  runDistance = 0;
  finished = false;
  /** 0..1, how much the skis are skidding (for sfx/spray) */
  skid = 0;
  surface: Surface = "snow";
  events: PlayerEvents = {};
  /** 0..1, the white-out that hides getting back up after a fall. */
  fade = 0;

  private world: World;
  private particles: Particles;
  private trails: Trails;
  private n = new THREE.Vector3(0, 1, 0);
  private visN = new THREE.Vector3(0, 1, 0);
  private steer = 0;
  private wipeout: Wipeout;
  /** Seconds since the body came to rest. */
  private recover = 0;
  private squash = 0;
  private spin = 0;
  private sprayAcc = 0;
  private skate = 0;
  private ducking = false;
  /** Seconds left in the current swing, its side, and its speed loss in m/s². */
  private swingT = 0;
  private swingSide = 0;
  private swingDecel = 0;
  private cloudAcc = 0;
  /** Smoothed pose signals for the rider's animation. */
  private yawRate = 0;
  private accel = 0;
  private absorb = 0;
  private lastHeading = 0;
  private lastSpeed = 0;
  private landing = new THREE.Vector3();
  private blob: THREE.Mesh;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private lat = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private qn = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private hitVel = new THREE.Vector3();

  constructor(world: World, particles: Particles, trails: Trails) {
    this.world = world;
    this.particles = particles;
    this.trails = trails;
    this.wipeout = new Wipeout(world.scene, world.terrain, particles);
    this.wipeout.events.onThud = (impact) => this.events.onThud?.(impact);
    world.scene.add(this.skier.root);
    const tex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(40,50,90,0.55)");
      g.addColorStop(1, "rgba(40,50,90,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
    );
    world.scene.add(this.blob);
  }

  get speed() {
    return this.vel.length();
  }

  /** Take over a skier that is already in the scene, e.g. the one picked from the lineup. */
  adoptSkier(skier: Skier, squash = 0) {
    if (skier !== this.skier) {
      this.world.scene.remove(this.skier.root);
      this.skier.dispose();
      this.skier = skier;
      skier.skis = true;
      this.world.scene.add(skier.root);
    }
    this.squash = squash;
  }

  /** Hide the skier and its blob shadow, e.g. while the lineup is on stage. */
  set visible(visible: boolean) {
    this.skier.root.visible = this.blob.visible = visible;
  }

  /** Every new run starts at the top of the snowfield. */
  spawnAtSummit() {
    this.spawnAt(SUMMIT.x, SUMMIT.z, START_HEADING);
  }

  spawnAt(x: number, z: number, heading: number) {
    this.pos.set(x, this.world.terrain.heightAt(x, z), z);
    this.heading = heading;
    this.resetMotion();
    this.vel.set(0, 0, 0);
  }

  private resetMotion() {
    this.state = "ski";
    this.grounded = true;
    this.finished = false;
    this.airTime = this.spin = this.recover = this.steer = this.skid = 0;
    this.yawRate = this.accel = this.absorb = this.lastSpeed = 0;
    this.swingT = this.cloudAcc = 0;
    this.lastHeading = this.heading;
    if (this.wipeout.active) {
      this.wipeout.clear();
      this.skier.endRagdoll();
    }
    this.world.terrain.normalAt(this.pos.x, this.pos.z, this.n);
    this.visN.copy(this.n);
    this.trails.break();
  }

  update(dt: number, input: InputState) {
    this.ducking = input.duck && !input.brake && this.state !== "crash" && !this.finished;
    this.steer = lerp(this.steer, input.steer * (this.ducking ? DUCK_STEER : 1), damp(10, dt));
    this.squash = Math.max(0, this.squash - dt * 2.5);
    if (this.state !== "crash") this.fade = Math.max(0, this.fade - dt / FADE_IN);

    if (this.state === "crash") {
      this.updateCrash(dt);
      return;
    }
    if (!this.finished) this.updateSki(dt, input);

    this.updateVisuals(dt, input);
  }

  /** Ragdolling down the slope; once the body lies still, white out and stand back up on the skis. */
  private updateCrash(dt: number) {
    const w = this.wipeout;
    w.update(dt);
    this.pos.copy(w.pelvis);
    this.vel.copy(w.velocity);
    const t = this.world.terrain;
    this.grounded = this.pos.y - t.heightAt(this.pos.x, this.pos.z) < 0.4;
    this.skid = this.grounded ? Math.min(1, this.vel.length() / 6) : 0;
    this.skier.poseRagdoll(w.joints);
    this.blob.visible = false;
    if (w.settled) this.recover += dt;
    this.fade = Math.min(1, this.recover / FADE_OUT);
    if (this.recover < FADE_OUT + FADE_HOLD) return;

    // up on the skis where the body came to rest, pointing down the fall line
    const x = THREE.MathUtils.clamp(this.pos.x, BOUNDS.minX, BOUNDS.maxX);
    const z = THREE.MathUtils.clamp(this.pos.z, BOUNDS.minZ, BOUNDS.maxZ);
    const n = t.normalAt(x, z, this.tmp);
    const heading = Math.hypot(n.x, n.z) > 0.02 ? Math.atan2(n.x, n.z) : this.heading;
    this.spawnAt(x, z, heading);
    this.squash = 0.5;
  }

  private updateSki(dt: number, input: InputState) {
    const t = this.world.terrain;
    const before = this.prev.copy(this.pos);

    const tuck = input.tuck;
    const brake = input.brake;
    this.swingT = Math.max(0, this.swingT - dt);
    this.surface = t.surfaceAt(this.pos.x, this.pos.z);

    if (this.grounded) {
      t.normalAt(this.pos.x, this.pos.z, this.n);
      const n = this.n;
      const speed = this.vel.length();
      if (input.swingPressed && this.swingT <= 0 && speed > SWING_MIN_SPEED) this.startSwing(input.swingPressed, speed);
      const swing = this.swingEnvelope();
      const speedN = Math.min(1, speed / 25);
      const rate = (brake ? 2.8 : 2.4) - speedN * 0.9;
      // the swing pivots the skis across the line of travel; the momentum keeps going, so they skid
      this.heading -= (this.steer * rate + this.swingSide * swing * SWING_YAW * Math.PI / (2 * SWING_TIME)) * dt;
      this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      this.fwd.addScaledVector(n, -this.fwd.dot(n)).normalize();
      this.lat.crossVectors(n, this.fwd).normalize();

      // gravity along the slope
      this.vel.y -= G * dt;
      // the ground can push but not pull: if the surface drops away from our
      // velocity (crests, kicker lips) we fly instead of sticking to it
      const vn = this.vel.dot(n);
      if (vn > 0.35 && speed > 4) {
        this.grounded = false;
        this.airTime = 0;
        this.spin = 0;
      } else {
        this.vel.addScaledVector(n, -vn);

        let vf = this.vel.dot(this.fwd);
        let vl = this.vel.dot(this.lat);
        // edges grip: sideways motion bleeds off, part of its energy is carved into
        // forward speed. Never more than was lost, so turning can't pump up speed.
        // (a swing skids too, but its speed loss is metered separately below)
        const grip = brake ? 2.2 : swing > 0 ? 3 : 7.5;
        const newVl = vl * Math.exp(-grip * dt);
        if (!brake) {
          vf = Math.sign(vf || 1) * Math.sqrt(vf * vf + CARVE_KEEP * (vl * vl - newVl * newVl));
        }
        vl = newVl;
        this.skid = Math.min(1, Math.abs(vl) / 4 + (brake ? Math.min(1, speed / 6) : 0) + swing * 2);

        // friction & drag
        const mu = MU + (brake ? 0.55 : 0);
        const fr = mu * G * n.y * dt;
        const sv = Math.hypot(vf, vl);
        if (sv > 1e-4) {
          const f = Math.max(0, sv - fr) / sv;
          vf *= f;
          vl *= f;
        }
        const drag = this.ducking ? DRAG_DUCK : tuck ? DRAG_TUCK : DRAG;
        vf -= Math.sign(vf) * drag * vf * vf * dt;
        const sw = Math.hypot(vf, vl);
        if (swing > 0 && sw > 1e-4) {
          const f = Math.max(0, sw - this.swingDecel * swing * dt) / sw;
          vf *= f;
          vl *= f;
        }

        // skating / pushing off: only gets you going on the flat, it can't beat
        // gravity up a real slope or keep pushing once the skis are running
        const skating = tuck && !this.ducking && vf < SKATE_MAX;
        this.skate = lerp(this.skate, skating ? 1 : 0, damp(6, dt));
        if (skating) {
          const flat = 1 - smoothstep(0, SKATE_MAX_GRADE, this.fwd.y);
          vf += SKATE_ACC * flat * (1 - Math.max(0, vf) / SKATE_MAX) * dt;
        }

        this.vel.copy(this.fwd).multiplyScalar(vf).addScaledVector(this.lat, vl);

        if (input.jumpPressed) {
          this.vel.addScaledVector(n, JUMP_POP).y += JUMP_LIFT;
          this.grounded = false;
          this.airTime = 0;
          this.spin = 0;
          this.squash = 0.35;
          this.events.onJump?.();
        }
      }
    } else {
      // airborne
      this.airTime += dt;
      this.vel.y -= G * dt;
      const airSpeed = this.vel.length();
      this.vel.multiplyScalar(Math.max(0, 1 - (this.ducking ? DRAG_DUCK : input.tuck ? DRAG_TUCK : DRAG) * airSpeed * dt));
      const spinRate = 6.5 * this.steer;
      this.heading -= spinRate * dt;
      this.spin += spinRate * dt;
      this.skid = 0;
    }

    this.pos.addScaledVector(this.vel, dt);

    // soft world bounds
    const clampAxis = (axis: "x" | "z", min: number, max: number) => {
      if (this.pos[axis] < min) {
        this.pos[axis] = min;
        if (this.vel[axis] < 0) this.vel[axis] = 0;
      } else if (this.pos[axis] > max) {
        this.pos[axis] = max;
        if (this.vel[axis] > 0) this.vel[axis] = 0;
      }
    };
    clampAxis("x", BOUNDS.minX, BOUNDS.maxX);
    clampAxis("z", BOUNDS.minZ, BOUNDS.maxZ);

    // ground contact
    const gy = t.heightAt(this.pos.x, this.pos.z);
    if (this.grounded) {
      if (gy < this.pos.y - 0.06) {
        // terrain fell away faster than we follow: launch
        this.grounded = false;
        this.airTime = 0;
        this.spin = 0;
      } else {
        this.pos.y = gy;
      }
    } else if (this.pos.y <= gy) {
      this.land(gy, dt);
      if (this.state === "crash") return;
    }

    if (this.grounded) {
      this.runDistance += this.pos.distanceTo(before);
    } else {
      this.runDistance += Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    }
    if (this.pos.z >= RUN_END) {
      this.finished = true;
      this.pos.y = t.heightAt(this.pos.x, this.pos.z);
      this.vel.set(0, 0, 0);
      this.grounded = true;
      this.state = "ski";
      this.skid = this.steer = this.skate = 0;
      this.trails.break();
      this.events.onFinish?.(this.runDistance);
    }
  }

  private startSwing(side: number, speed: number) {
    this.swingT = SWING_TIME;
    this.swingSide = Math.sign(side);
    // the envelope averages 2/π, so this sheds exactly the planned speed over the swing
    this.swingDecel = Math.min(speed * SWING_SHED, SWING_SHED_MAX) / (SWING_TIME * 2 / Math.PI);
    this.squash = Math.max(this.squash, 0.3);
    this.cloudAcc = 18; // the opening puff
    this.events.onSwing?.();
  }

  /** 0..1..0 over the swing: the skis bite hardest in the middle. */
  private swingEnvelope() {
    return this.swingT > 0 ? Math.sin(Math.PI * (1 - this.swingT / SWING_TIME)) : 0;
  }

  private land(gy: number, dt: number) {
    const t = this.world.terrain;
    this.pos.y = gy;
    t.normalAt(this.pos.x, this.pos.z, this.n);
    const vn = this.vel.dot(this.n);
    const impact = Math.max(0, -vn);
    const hit = this.hitVel.copy(this.vel);
    this.vel.addScaledVector(this.n, -vn);
    this.grounded = true;
    const air = this.airTime;

    if (air > 0.25) {
      // how well do the skis line up with the direction of travel?
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      const cos = hv > 1 ? (this.vel.x * fx + this.vel.z * fz) / hv : 1;
      if ((hv > 6 && Math.abs(cos) < 0.45) || impact > CRASH_IMPACT) {
        this.crash(hit, dt);
        return;
      } else {
        if (cos < -0.45) this.heading += Math.PI; // landed switch: spin round
        const turns = Math.round(Math.abs(this.spin) / Math.PI) * 180;
        if (turns >= 360) this.events.onTrick?.(`${turns}!`);
        else if (air > 1.2) this.events.onTrick?.("Big air!");
      }
    }
    this.squash = Math.min(0.6, impact * 0.05 + (air > 0.25 ? 0.15 : 0));
    if (air > 0.2) {
      this.events.onLand?.(impact, air);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.emit(
          this.pos,
          new THREE.Vector3(Math.cos(a) * 3, 1.5 + Math.random() * 2, Math.sin(a) * 3).addScaledVector(this.vel, 0.3),
          { size: 0.18 + Math.random() * 0.15, life: 0.7 },
        );
      }
    }
  }

  /** Thrown off the skis with velocity `hit`: from here the ragdoll has the rider until it lies still. */
  private crash(hit: THREE.Vector3, dt: number) {
    if (this.state === "crash") return;
    this.state = "crash";
    this.recover = this.swingT = this.skate = 0;
    // the skis no longer point anywhere: follow the line the rider was thrown along
    if (Math.hypot(hit.x, hit.z) > 1) this.heading = Math.atan2(hit.x, hit.z);
    this.trails.break();
    this.events.onCrash?.();
    this.wipeout.start(this.skier, hit, this.n, dt);
  }

  /** Seconds until the current flight meets the snow; also stores where it lands. */
  private timeToGround() {
    const t = this.world.terrain;
    const p = this.pos, v = this.vel;
    let s = 0.04;
    for (; s < 3; s += 0.04) {
      this.landing.set(p.x + v.x * s, p.y + v.y * s - 0.5 * G * s * s, p.z + v.z * s);
      if (this.landing.y <= t.heightAt(this.landing.x, this.landing.z)) break;
    }
    return s;
  }

  private updateVisuals(dt: number, input: InputState) {
    const root = this.skier.root;
    const t = this.world.terrain;
    const speed = this.speed;
    const hv = Math.hypot(this.vel.x, this.vel.z);

    // lateral load from the turn rate: lean in as far as the speed demands
    let dh = Math.atan2(Math.sin(this.heading - this.lastHeading), Math.cos(this.heading - this.lastHeading));
    if (Math.abs(dh) > 1) dh = 0; // landed switch and spun round
    this.lastHeading = this.heading;
    this.yawRate = lerp(this.yawRate, this.grounded ? dh / dt : 0, damp(12, dt));
    // (the arcade turn rate is far tighter than real carving, so the lean eases toward its limit
    // instead of saturating: a gentle curve still leans visibly less than a hard one at speed)
    const edge = -0.75 * Math.tanh(((speed * this.yawRate) / G) * 0.55);
    this.accel = lerp(this.accel, this.grounded ? (speed - this.lastSpeed) / dt : 0, damp(6, dt));
    this.lastSpeed = speed;
    // terrain curvature along the line of travel: compressions push up, crests drop away
    let absorb = 0;
    if (this.grounded && hv > 2) {
      const d = 2.5, dx = (this.vel.x / hv) * d, dz = (this.vel.z / hv) * d;
      const curve = (t.heightAt(this.pos.x + dx, this.pos.z + dz) + t.heightAt(this.pos.x - dx, this.pos.z - dz) - 2 * t.heightAt(this.pos.x, this.pos.z)) / (d * d);
      absorb = THREE.MathUtils.clamp((hv * hv * curve / G) * 0.35, -0.35, 0.5);
    }
    this.absorb = lerp(this.absorb, absorb, damp(10, dt));

    // in the air, keep the skis square to the flight path, then match the slope at the landing
    const toGround = this.grounded ? 0 : this.timeToGround();
    const targetN = this.grounded ? this.n : this.tmp.set(-this.vel.y * this.vel.x / Math.max(hv, 1) * 0.5, Math.max(hv, 1), -this.vel.y * this.vel.z / Math.max(hv, 1) * 0.5).normalize();
    if (!this.grounded) {
      const meet = 1 - THREE.MathUtils.smoothstep(toGround, 0.15, 0.6);
      targetN.lerp(t.normalAt(this.landing.x, this.landing.z, this.qn), meet).normalize();
    }
    this.visN.lerp(targetN, damp(this.grounded ? 14 : 3, dt)).normalize();

    root.position.copy(this.pos);
    this.qa.setFromUnitVectors(UP, this.visN);
    this.qb.setFromAxisAngle(UP, this.heading);
    root.quaternion.copy(this.qa).multiply(this.qb);

    this.skier.update(dt, {
      speed: this.speed,
      turn: this.steer,
      tuck: (input.tuck || this.ducking) && this.skate < 0.5,
      duck: this.ducking,
      brake: input.brake,
      air: !this.grounded && this.airTime > 0.1,
      skate: this.skate,
      seated: false,
      squash: this.squash,
      edge,
      accel: this.accel,
      absorb: this.absorb,
      skid: this.skid,
      airTime: this.airTime,
      toGround,
      spin: this.grounded ? 0 : 6.5 * this.steer,
    });

    // blob shadow
    const gy = t.heightAt(this.pos.x, this.pos.z);
    const h = this.pos.y - gy;
    this.blob.visible = true;
    this.blob.position.set(this.pos.x, gy + 0.05, this.pos.z);
    this.blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.normalAt(this.pos.x, this.pos.z, this.tmp));
    this.blob.rotateZ(-this.heading);
    const s = 1 / (1 + h * 0.15);
    this.blob.scale.setScalar(s);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = s;

    // tracks + spray
    if (this.grounded && this.speed > 0.5) {
      this.trails.add(this.pos, this.lat, 0.15);
    } else {
      this.trails.break();
    }
    if (this.grounded && this.speed > 3) {
      const rate = (this.skid * 90 + (this.speed > 15 ? (this.speed - 15) * 2 : 0));
      this.sprayAcc += rate * dt;
      while (this.sprayAcc > 1) {
        this.sprayAcc -= 1;
        const side = Math.sign(this.vel.dot(this.lat)) || 1;
        const p = this.tmp.copy(this.pos).addScaledVector(this.fwd, -0.4 + Math.random() * 0.6);
        p.y += 0.1;
        this.particles.emit(
          p,
          new THREE.Vector3((Math.random() - 0.5) * 2, 1.2 + Math.random() * 2.2, (Math.random() - 0.5) * 2)
            .addScaledVector(this.vel, 0.35)
            .addScaledVector(this.lat, side * (1.5 + this.skid * 3)),
          { size: 0.08 + Math.random() * 0.14, life: 0.5 + Math.random() * 0.4, drag: 2 },
        );
      }
    }
    // swing: a soft cloud of powder thrown out from the edges, hanging in the air a moment
    if (this.grounded && this.swingT > 0) {
      this.cloudAcc += 90 * this.swingEnvelope() * dt;
      const side = Math.sign(this.vel.dot(this.lat)) || -this.swingSide;
      while (this.cloudAcc > 1) {
        this.cloudAcc -= 1;
        const p = this.tmp.copy(this.pos).addScaledVector(this.fwd, -0.6 + Math.random() * 1.2).addScaledVector(this.lat, side * 0.3);
        p.y += 0.15;
        this.particles.emit(
          p,
          new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5)
            .addScaledVector(this.vel, 0.55)
            .addScaledVector(this.lat, side * (2 + Math.random() * 2.5)),
          // some puffs catch the light, some sit in their own shade, so the cloud reads against the snow
          { size: 0.22 + Math.random() * 0.3, life: 1 + Math.random() * 0.7, grow: 2.6, gravity: 0.2, drag: 3, color: Math.random() < 0.5 ? 0xffffff : 0xc9d3e4 },
        );
      }
    } else this.cloudAcc = 0;
  }
}
