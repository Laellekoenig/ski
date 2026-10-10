import * as THREE from "three";
import { Skier } from "./skier";
import type { World } from "./world";
import { GENTLE_STEER, type InputState } from "./input";
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
/**
 * Carve timing: holding a turn warms the skis and boots up until they flare bright in the sweet spot.
 * Switch to the other edge then for a burst of speed and a shower of sparks. Switching early or holding
 * on past it costs no speed, but the glow goes out. Letting go costs nothing either, but only the edge
 * change earns the boost. Gentle Q / E curves fill slowly with a wide sweet spot, hard A / D turns fill
 * fast with a narrow one.
 */
const CARVE_MIN_SPEED = 5;
const CARVE_FILL_GENTLE = 1.5;
const CARVE_FILL_HARD = 0.85;
const CARVE_SWEET = 0.7;
/** Half the sweet spot's width, in charge. */
const CARVE_SWEET_GENTLE = 0.13;
const CARVE_SWEET_HARD = 0.05;
/** Carves in a row for the glow to burn its hottest. */
const CARVE_STREAK_FULL = 6;
/** Flat out with a streak lit, the boots catch fire: from this speed, fully ablaze by this one (m/s). */
const FIRE_FROM = 19;
const FIRE_FULL = 22;
/** Speed a well-timed carve adds, in m/s, eased in over a moment. */
const CARVE_BOOST_GENTLE = 1.1;
const CARVE_BOOST_HARD = 1.6;
const CARVE_BOOST_TIME = 0.3;
/** The boost fades out over the last few m/s below this, so carving can't run away with the speed. */
const CARVE_TOP_SPEED = 26;
const CARVE_FADE = 8;
/** Landing harder than this into the snow (m/s along its normal) folds the legs and throws the rider. */
const CRASH_IMPACT = 15;
/** Landing a spin: skis within this of the line of travel (tips or tails first) touch down clean, rad. */
const LAND_CLEAN = 0.38;
/** Further round than this and the edges catch: a fall. Fast it is tight, slow there is more slack. */
const LAND_CATCH_FAST = 0.72;
const LAND_CATCH_SLOW = 1.05;
/** Slower than this a crooked landing just skids round. */
const LAND_CATCH_MIN_SPEED = 3;
/** Share of the speed a landing right at the edge of a fall scrubs off as it skids straight. */
const LAND_SCRUB = 0.4;
/** After a fall: the screen washes out to snow white, the rider is back on the skis, and it clears. */
const FADE_OUT = 0.35;
const FADE_HOLD = 0.15;
const FADE_IN = 0.5;
/** Down the single snowfield, toward the Engadine backdrop. */
export const START_HEADING = 0;

export type PlayerState = "ski" | "crash";

/** Timing of the turn in progress, 0 (just begun) .. 1 (held far too long). */
export interface CarveTiming {
  /** -1 / 1 while a turn is held, 0 once it's let go */
  side: number;
  charge: number;
  sweetLo: number;
  sweetHi: number;
  /** this turn was held on past the sweet spot */
  late: boolean;
  /** well-timed edge changes in a row */
  streak: number;
  /** seconds since the last well-timed edge change */
  carved: number;
}

export interface PlayerEvents {
  onJump?: () => void;
  onLand?: (impact: number, airTime: number) => void;
  onCrash?: () => void;
  /** A body part slamming into the snow mid-fall. */
  onThud?: (impact: number) => void;
  onTrick?: (label: string) => void;
  onSwing?: () => void;
  onCarve?: (streak: number) => void;
  /** The carve glow went out: an edge change missed, or the streak cooled off. */
  onMiss?: () => void;
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
  /** Riding backwards: the tails lead, after landing a 180 or spinning one off a hop. */
  switch = false;
  readonly carve: CarveTiming = { side: 0, charge: 0, sweetLo: 0, sweetHi: 0, late: false, streak: 0, carved: Infinity };

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
  /** How hard the held turn is, 0 (gentle Q / E) .. 1 (full A / D), and the carve boost still to come. */
  private carveHard = 0;
  private boostT = 0;
  private boostAcc = 0;
  /** 0..1 shine of the skis and boots, 0..1 how hard the boots burn, and the sparks or smoke still to throw. */
  private glow = 0;
  private fire = 0;
  private flameAcc = 0;
  private sparks = 0;
  private smoke = false;
  /** Smoothed pose signals for the rider's animation. */
  private yawRate = 0;
  private accel = 0;
  private absorb = 0;
  private lastHeading = 0;
  private lastSpeed = 0;
  private landing = new THREE.Vector3();
  private blob: THREE.Mesh;
  private pool: THREE.Mesh;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private lat = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private qn = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private hitVel = new THREE.Vector3();
  private boot = new THREE.Vector3();
  private sparkVel = new THREE.Vector3();

  constructor(world: World, particles: Particles, trails: Trails) {
    this.world = world;
    this.particles = particles;
    this.trails = trails;
    this.wipeout = new Wipeout(world.scene, world.terrain, particles);
    this.wipeout.events.onThud = (impact) => this.events.onThud?.(impact);
    world.scene.add(this.skier.root);
    const tex = (inner: string, outer: string) => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    };
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.2),
      new THREE.MeshBasicMaterial({ map: tex("rgba(40,50,90,0.55)", "rgba(40,50,90,0)"), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
    );
    world.scene.add(this.blob);
    // the glowing skis light up the snow around them
    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 2.6),
      new THREE.MeshBasicMaterial({ map: tex("rgba(255,255,255,1)", "rgba(255,255,255,0)"), color: 0xff8a2a, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7 }),
    );
    this.pool.visible = false;
    world.scene.add(this.pool);
  }

  get speed() {
    return this.vel.length();
  }

  /** The way the rider is going: the tips, or the tails when riding switch. */
  get facing() {
    return this.heading + (this.switch ? Math.PI : 0);
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
    if (!visible) this.pool.visible = false;
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
    this.switch = false;
    this.airTime = this.spin = this.recover = this.steer = this.skid = 0;
    this.yawRate = this.accel = this.absorb = this.lastSpeed = 0;
    this.swingT = this.cloudAcc = this.boostT = 0;
    this.resetCarve();
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
      this.carveTurn(dt, input, speed, swing);
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
        // forward speed. Never more than was lost, so turning alone can't pump up speed;
        // only a well-timed carve does (below). (a swing skids too, its loss is metered separately)
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
        // a timed carve springs out of the turn, fading out toward the top speed
        if (this.boostT > 0) {
          const step = Math.min(dt, this.boostT);
          this.boostT -= step;
          vf += Math.sign(vf || 1) * this.boostAcc * (1 - smoothstep(CARVE_TOP_SPEED - CARVE_FADE, CARVE_TOP_SPEED, Math.hypot(vf, vl))) * step;
        }

        // skating / pushing off: only gets you going on the flat, it can't beat
        // gravity up a real slope or keep pushing once the skis are running
        const skating = tuck && !this.ducking && !this.switch && vf < SKATE_MAX;
        this.skate = lerp(this.skate, skating ? 1 : 0, damp(6, dt));
        if (skating) {
          const flat = 1 - smoothstep(0, SKATE_MAX_GRADE, this.fwd.y);
          vf += SKATE_ACC * flat * (1 - Math.max(0, vf) / SKATE_MAX) * dt;
        }

        this.vel.copy(this.fwd).multiplyScalar(vf).addScaledVector(this.lat, vl);

        if (input.jumpPressed) {
          this.endCarve();
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
      this.endCarve();
      this.carve.carved += dt;
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
    this.updateSwitch();

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
      this.skid = this.steer = this.skate = this.boostT = 0;
      this.resetCarve();
      this.trails.break();
      this.events.onFinish?.(this.runDistance);
    }
  }

  /** Tips or tails first? Decided by whichever end the travel is closer to; at a standstill the tips lead again. */
  private updateSwitch() {
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > 1) this.switch = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading) < 0;
    else if (this.grounded && hv < 0.3) this.switch = false;
  }

  /** Time the turn while it is held; switching to the other edge is the moment that counts. */
  private carveTurn(dt: number, input: InputState, speed: number, swing: number) {
    const c = this.carve;
    c.carved += dt;
    const side = Math.abs(input.steer) > 0.15 ? Math.sign(input.steer) : 0;
    // braking, swinging or slowing right down cools the skis off
    if (input.brake || swing > 0 || speed < CARVE_MIN_SPEED) {
      this.endCarve();
      if (c.streak) this.loseStreak();
    }
    if (c.side && side === -c.side) {
      if (c.charge >= c.sweetLo && c.charge <= c.sweetHi) {
        c.carved = 0;
        c.streak++;
        this.boostT = CARVE_BOOST_TIME;
        this.boostAcc = lerp(CARVE_BOOST_GENTLE, CARVE_BOOST_HARD, this.carveHard) / CARVE_BOOST_TIME;
        this.squash = Math.max(this.squash, 0.2);
        this.sparks = c.side;
        this.events.onCarve?.(c.streak);
      } else if (!c.late) this.loseStreak();
      this.endCarve();
    }
    if (side && !c.side && speed > CARVE_MIN_SPEED && !input.brake && swing <= 0) {
      c.side = side;
      c.charge = 0;
      c.late = false;
    }
    if (!c.side) return;
    // let go: the edges flatten without a penalty, and the meter runs on so the edge change
    // can still be timed; once it's past the sweet spot the turn simply ends
    const held = side === c.side;
    if (!held && c.charge > c.sweetHi) {
      this.endCarve();
      return;
    }

    if (held) {
      // the sweet spot follows the keys held, so easing from A onto Q mid-turn widens it
      this.carveHard = THREE.MathUtils.clamp((Math.abs(input.steer) - GENTLE_STEER) / (1 - GENTLE_STEER), 0, 1);
      const half = lerp(CARVE_SWEET_GENTLE, CARVE_SWEET_HARD, this.carveHard);
      c.sweetLo = CARVE_SWEET - half;
      c.sweetHi = CARVE_SWEET + half;
    }
    c.charge = Math.min(1, c.charge + dt / lerp(CARVE_FILL_GENTLE, CARVE_FILL_HARD, this.carveHard));
    // held on past the sweet spot: no harm to the speed, but the glow goes out
    if (held && !c.late && c.charge > c.sweetHi) {
      c.late = true;
      this.loseStreak(true);
    }
  }

  private endCarve() {
    this.carve.side = 0;
  }

  /** Out of rhythm: the streak is over and the glow goes out, with a fizzle if it was lit. */
  private loseStreak(lit = this.carve.streak > 0) {
    this.carve.streak = 0;
    if (!lit) return;
    this.smoke = true;
    this.events.onMiss?.();
  }

  /** A fresh start: no turn, no streak, no glow. */
  private resetCarve() {
    const c = this.carve;
    c.side = c.streak = 0;
    c.late = false;
    c.carved = Infinity;
    this.glow = this.fire = this.sparks = 0;
    this.smoke = false;
    this.skier.setGlow(0, 0);
  }

  /** `side` 0 pivots nowhere: the skis just skid, as after a crooked landing. */
  private startSwing(side: number, speed: number, shed = SWING_SHED) {
    this.swingT = SWING_TIME;
    this.swingSide = Math.sign(side);
    // the envelope averages 2/π, so this sheds exactly the planned speed over the swing
    this.swingDecel = Math.min(speed * shed, SWING_SHED_MAX) / (SWING_TIME * 2 / Math.PI);
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

    if (air > 0.25 || Math.abs(this.spin) > LAND_CLEAN) {
      // how well do the skis line up with the direction of travel?
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      const cos = hv > 1 ? (this.vel.x * fx + this.vel.z * fz) / hv : 1;
      // off the line by this much, whichever end leads: 0 straight, π/2 fully sideways
      const off = Math.acos(Math.min(1, Math.abs(cos)));
      const limit = lerp(LAND_CATCH_SLOW, LAND_CATCH_FAST, smoothstep(4, 14, hv));
      if ((hv > LAND_CATCH_MIN_SPEED && off > limit) || impact > CRASH_IMPACT) {
        this.crash(hit, dt);
        return;
      }
      // landed backwards: ride it out switch
      this.switch = cos < 0;
      if (off > LAND_CLEAN && hv > LAND_CATCH_MIN_SPEED) {
        // sketchy: the skis skid round under the rider, scrubbing speed the nearer it came to a fall
        this.startSwing(0, hv, LAND_SCRUB * smoothstep(LAND_CLEAN, limit, off));
      } else {
        const turns = Math.round(Math.abs(this.spin) / Math.PI) * 180;
        if (turns >= 180) this.events.onTrick?.(`${turns}${this.switch ? " switch" : ""}!`);
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
    this.recover = this.swingT = this.skate = this.boostT = 0;
    this.resetCarve();
    this.pool.visible = false;
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
    if (Math.abs(dh) > 1) dh = 0; // respawned facing somewhere else
    this.lastHeading = this.heading;
    this.yawRate = lerp(this.yawRate, this.grounded ? dh / dt : 0, damp(12, dt));
    // (the arcade turn rate is far tighter than real carving, so the lean eases toward its limit
    // instead of saturating: a gentle curve still leans visibly less than a hard one at speed)
    // (riding switch the body faces back up the turn, so the inside is on its other side)
    const edge = (this.switch ? 0.75 : -0.75) * Math.tanh(((speed * this.yawRate) / G) * 0.55);
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
      turn: this.switch ? -this.steer : this.steer,
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
      switch: this.switch,
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
        // thrown up behind the feet, which riding switch is toward the tips
        const p = this.tmp.copy(this.pos).addScaledVector(this.fwd, (this.switch ? -1 : 1) * (-0.4 + Math.random() * 0.6));
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

    this.updateGlow(dt, speed, gy);
  }

  /** Skis and boots lit up by the carve timing, plus the sparks, flames and smoke that go with it. */
  private updateGlow(dt: number, speed: number, gy: number) {
    const c = this.carve;
    const heat = Math.min(1, c.streak / CARVE_STREAK_FULL);
    // a turn warms the skis up as it goes and they flare bright in the sweet spot; a streak keeps them lit
    let cue = 0;
    if (c.side && !c.late) {
      cue = c.charge < c.sweetLo ? 0.5 * smoothstep(0.1, c.sweetLo, c.charge) : c.charge <= c.sweetHi ? 1 : 0;
    }
    const lit = c.streak ? lerp(0.3, 0.6, heat) : 0;
    const glow = Math.max(lit, cue);
    this.glow = lerp(this.glow, glow, damp(glow > this.glow ? 30 : 9, dt));
    const fire = c.streak ? smoothstep(FIRE_FROM, FIRE_FULL, speed) : 0;
    this.fire = lerp(this.fire, fire, damp(fire > this.fire ? 4 : 10, dt));
    this.skier.setGlow(Math.max(this.glow, this.fire), Math.max(heat, this.fire));

    const pool = this.pool;
    const shine = this.grounded ? Math.max(this.glow, this.fire) * (0.3 + 0.4 * heat) : 0;
    pool.visible = shine > 0.01;
    if (pool.visible) {
      pool.position.set(this.pos.x, gy + 0.06, this.pos.z);
      pool.quaternion.copy(this.blob.quaternion);
      (pool.material as THREE.MeshBasicMaterial).opacity = shine;
    }

    if (!this.sparks && !this.smoke && this.fire < 0.02) {
      this.flameAcc = 0;
      return;
    }
    this.skier.root.updateMatrixWorld();
    if (this.sparks) {
      // a shower of sparks off the edges, thrown to the outside of the turn just finished, and a lick of flame
      const out = -this.sparks;
      const n = 20 + Math.min(c.streak, CARVE_STREAK_FULL) * 5;
      for (let i = 0; i < n; i++) {
        const p = this.tmp.copy(this.pos).addScaledVector(this.fwd, -0.7 + Math.random() * 1.5).addScaledVector(this.lat, out * 0.08);
        p.y += 0.05;
        this.sparkVel.set((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 1.5)
          .addScaledVector(this.vel, 0.9)
          .addScaledVector(this.lat, out * (1.5 + Math.random() * 3.5));
        this.particles.emit(p, this.sparkVel, { size: 0.045 + Math.random() * 0.04, life: 0.25 + Math.random() * 0.35, gravity: 0.9, drag: 1.5, color: SPARK[i % SPARK.length] });
      }
      for (let i = 0; i < 2; i++) for (let k = 0; k < 6 + heat * 6; k++) this.flame(i, 1 + heat * 0.5);
      this.sparks = 0;
    }
    if (this.smoke) {
      // the glow goes out in a little puff
      for (let i = 0; i < 2; i++) {
        this.skier.bootAt(i, this.boot);
        for (let k = 0; k < 5; k++) {
          this.particles.emit(this.boot, this.sparkVel.set((Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8).addScaledVector(this.vel, 0.6), {
            size: 0.07 + Math.random() * 0.06, life: 0.5 + Math.random() * 0.4, grow: 2.4, gravity: -0.05, drag: 2, color: 0x9aa0a8,
          });
        }
      }
      this.smoke = false;
    }
    // shoes on fire: flames stream back off the boots
    this.flameAcc += this.fire * 140 * dt;
    while (this.flameAcc > 1) {
      this.flameAcc -= 1;
      this.flame(Math.random() < 0.5 ? 0 : 1, this.fire);
    }
  }

  /** One lick of flame off boot `i`, `size` 0..1. */
  private flame(i: number, size: number) {
    this.skier.bootAt(i, this.boot);
    this.boot.x += (Math.random() - 0.5) * 0.12;
    this.boot.z += (Math.random() - 0.5) * 0.12;
    this.boot.y += Math.random() * 0.1;
    this.sparkVel.set((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6).addScaledVector(this.vel, 0.95);
    this.particles.emit(this.boot, this.sparkVel, {
      size: (0.1 + Math.random() * 0.1) * size, life: 0.18 + Math.random() * 0.2, grow: 0.3, gravity: -0.3, drag: 0, color: FLAME[Math.floor(Math.random() * FLAME.length)],
    });
  }
}

const SPARK = [0xffea8a, 0xffb820, 0xff7a10];
const FLAME = [0xffd23a, 0xff9a1a, 0xff6410, 0xe8380c];
