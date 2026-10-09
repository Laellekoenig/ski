import * as THREE from "three";
import { Skier } from "./skier";
import type { World } from "./world";
import type { Lift } from "./lifts";
import { RIDE_SPEED } from "./lifts";
import type { InputState } from "./input";
import type { Particles } from "./particles";
import type { Trails } from "./trails";
import { BOUNDS } from "./layout";
import { damp, lerp } from "./noise";

const G = 9.81;
const MU = { piste: 0.04, snow: 0.08, ice: 0.006 };
const DRAG = 0.0095;
const DRAG_TUCK = 0.0058;
const BOARD_RADIUS = 13;

export type PlayerState = "ski" | "crash" | "lift";

export interface PlayerEvents {
  onJump?: () => void;
  onLand?: (impact: number, airTime: number) => void;
  onCrash?: () => void;
  onTrick?: (label: string) => void;
  onBoard?: (lift: Lift, runDistance: number) => void;
  onDismount?: (lift: Lift) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  readonly skier = new Skier();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0;
  state: PlayerState = "ski";
  grounded = true;
  airTime = 0;
  runDistance = 0;
  /** lift you are close enough to board, if any */
  nearbyLift: Lift | null = null;
  lift: Lift | null = null;
  rideS = 0;
  /** 0..1, how much the skis are skidding (for sfx/spray) */
  skid = 0;
  surface: "piste" | "snow" | "ice" = "piste";
  events: PlayerEvents = {};

  private world: World;
  private particles: Particles;
  private trails: Trails;
  private n = new THREE.Vector3(0, 1, 0);
  private visN = new THREE.Vector3(0, 1, 0);
  private steer = 0;
  private crashTimer = 0;
  private tumble = 0;
  private squash = 0;
  private spin = 0;
  private sprayAcc = 0;
  private skate = 0;
  private blob: THREE.Mesh;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private lat = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private prev = new THREE.Vector3();

  constructor(world: World, particles: Particles, trails: Trails) {
    this.world = world;
    this.particles = particles;
    this.trails = trails;
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

  /** Place the skier at a lift's top exit, facing downhill. */
  spawnAtTop(lift: Lift) {
    const p = this.tmp.copy(lift.top).addScaledVector(lift.right, 9).addScaledVector(lift.dir, -4);
    this.pos.set(p.x, this.world.terrain.heightAt(p.x, p.z), p.z);
    // look a little way down the line, off the flat station pad
    const n = this.world.terrain.normalAt(this.pos.x - lift.dir.x * 25, this.pos.z - lift.dir.z * 25);
    // face downhill (or the direction away from the lift if it's flat)
    const dx = Math.abs(n.x) + Math.abs(n.z) > 0.05 ? n.x : -lift.dir.x;
    const dz = Math.abs(n.x) + Math.abs(n.z) > 0.05 ? n.z : -lift.dir.z;
    this.heading = Math.atan2(dx, dz);
    this.vel.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(2);
    this.state = "ski";
    this.grounded = true;
    // also covers resetting mid-ride from the pause menu
    if (this.lift) this.lift.rideChair.visible = false;
    this.lift = null;
    this.trails.break();
  }

  update(dt: number, input: InputState) {
    this.steer = lerp(this.steer, input.steer, damp(10, dt));
    this.squash = Math.max(0, this.squash - dt * 2.5);

    if (this.state === "lift") this.updateLift(dt, input);
    else this.updateSki(dt, input);

    this.updateVisuals(dt, input);
  }

  /** Title screen: stand still, just animate. */
  idle(dt: number, input: InputState) {
    this.vel.set(0, 0, 0);
    this.updateVisuals(dt, input);
  }

  private updateLift(dt: number, input: InputState) {
    const lift = this.lift!;
    this.rideS += RIDE_SPEED * (input.jumpHeld || input.tuck ? 3.5 : 1) * dt;
    const grip = lift.ridePoint(this.rideS, this.tmp);
    const yaw = Math.atan2(lift.dir.x, lift.dir.z);
    lift.rideChair.visible = true;
    lift.rideChair.position.copy(grip);
    lift.rideChair.rotation.set(0, yaw, 0);
    this.heading = yaw;
    this.pos.copy(grip).addScaledVector(lift.dir, 0.08);
    this.pos.y -= 2.82;
    this.vel.set(0, 0, 0);
    if (this.rideS >= lift.rideLength) {
      this.spawnAtTop(lift);
      this.squash = 0.4;
      this.events.onDismount?.(lift);
    }
  }

  private board(lift: Lift) {
    this.events.onBoard?.(lift, this.runDistance);
    this.runDistance = 0;
    this.state = "lift";
    this.lift = lift;
    this.rideS = 0;
    this.trails.break();
  }

  private updateSki(dt: number, input: InputState) {
    const t = this.world.terrain;
    const crashed = this.state === "crash";
    const before = this.prev.copy(this.pos);

    // lift boarding
    this.nearbyLift = null;
    if (!crashed && this.grounded) {
      for (const l of this.world.lifts) {
        if (Math.hypot(this.pos.x - l.bottom.x, this.pos.z - l.bottom.z) < BOARD_RADIUS) this.nearbyLift = l;
      }
    }
    if (this.nearbyLift && input.actionPressed) {
      this.board(this.nearbyLift);
      return;
    }

    if (crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.state = "ski";
        this.tumble = 0;
        this.squash = 0.5;
      }
    }

    const tuck = input.tuck && !crashed;
    const brake = input.brake && !crashed;
    this.surface = t.surfaceAt(this.pos.x, this.pos.z);

    if (this.grounded) {
      t.normalAt(this.pos.x, this.pos.z, this.n);
      const n = this.n;
      const speed = this.vel.length();
      if (!crashed) {
        const speedN = Math.min(1, speed / 25);
        const rate = (brake ? 2.8 : 2.4) - speedN * 0.9;
        this.heading -= this.steer * rate * dt;
      }
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
        // edges grip: sideways motion bleeds off, part of it is carved into forward speed
        const grip = crashed ? 1.2 : brake ? 2.2 : this.surface === "ice" ? 1.6 : 7.5;
        const newVl = vl * Math.exp(-grip * dt);
        const lost = Math.abs(vl) - Math.abs(newVl);
        vl = newVl;
        if (!crashed && !brake) vf += Math.sign(vf || 1) * lost * 0.6;
        this.skid = Math.min(1, Math.abs(vl) / 4 + (brake ? Math.min(1, speed / 6) : 0));

        // friction & drag
        const mu = (crashed ? 0.6 : MU[this.surface]) + (brake ? 0.45 : 0);
        const fr = mu * G * n.y * dt;
        const sv = Math.hypot(vf, vl);
        if (sv > 1e-4) {
          const f = Math.max(0, sv - fr) / sv;
          vf *= f;
          vl *= f;
        }
        const drag = tuck ? DRAG_TUCK : DRAG;
        vf -= Math.sign(vf) * drag * vf * vf * dt;

        // skating / pushing off when slow
        this.skate = lerp(this.skate, tuck && vf < 10 ? 1 : 0, damp(6, dt));
        if (tuck && vf < 10) vf += (vf < 0 ? 8 : 4.5) * dt;

        this.vel.copy(this.fwd).multiplyScalar(vf).addScaledVector(this.lat, vl);

        if (input.jumpPressed && !crashed) {
          this.vel.addScaledVector(n, 3.2).y += 2.6;
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
      this.vel.multiplyScalar(Math.exp(-0.02 * dt));
      if (!crashed) {
        const spinRate = 6.5 * this.steer;
        this.heading -= spinRate * dt;
        this.spin += spinRate * dt;
      }
      this.skid = 0;
    }

    this.pos.addScaledVector(this.vel, dt);

    // soft world bounds
    const clampAxis = (axis: "x" | "z", min: number, max: number) => {
      if (this.pos[axis] < min) {
        this.pos[axis] = min;
        if (this.vel[axis] < 0) this.vel[axis] *= -0.3;
      } else if (this.pos[axis] > max) {
        this.pos[axis] = max;
        if (this.vel[axis] > 0) this.vel[axis] *= -0.3;
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
      this.land(gy);
    }

    this.collide();

    if (this.grounded) {
      this.runDistance += this.pos.distanceTo(before);
    } else {
      this.runDistance += Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    }
  }

  private land(gy: number) {
    const t = this.world.terrain;
    this.pos.y = gy;
    t.normalAt(this.pos.x, this.pos.z, this.n);
    const vn = this.vel.dot(this.n);
    const impact = Math.max(0, -vn);
    this.vel.addScaledVector(this.n, -vn);
    this.grounded = true;
    const air = this.airTime;

    if (this.state === "ski" && air > 0.25) {
      // how well do the skis line up with the direction of travel?
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      const cos = hv > 1 ? (this.vel.x * fx + this.vel.z * fz) / hv : 1;
      if (hv > 6 && Math.abs(cos) < 0.45) {
        this.crash();
      } else if (impact > 17) {
        this.crash();
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

  private collide() {
    for (const c of this.world.collidersNear(this.pos.x, this.pos.z)) {
      if (this.pos.y > c.top) continue;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const r = c.r + 0.35;
      if (d >= r || d < 1e-5) continue;
      const nx = dx / d;
      const nz = dz / d;
      const into = this.vel.x * nx + this.vel.z * nz;
      this.pos.x = c.x + nx * r;
      this.pos.z = c.z + nz * r;
      if (into < 0) {
        if (-into > 7 && this.state === "ski") {
          this.vel.x -= 1.4 * into * nx;
          this.vel.z -= 1.4 * into * nz;
          this.vel.multiplyScalar(0.3);
          this.crash();
        } else {
          this.vel.x -= into * nx;
          this.vel.z -= into * nz;
        }
      }
    }
  }

  private crash() {
    if (this.state === "crash") return;
    this.state = "crash";
    this.crashTimer = 1.6;
    this.trails.break();
    this.events.onCrash?.();
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.emit(
        this.tmp.copy(this.pos).add(new THREE.Vector3(0, 0.6, 0)),
        new THREE.Vector3(Math.cos(a) * 4, 2 + Math.random() * 4, Math.sin(a) * 4),
        { size: 0.25 + Math.random() * 0.25, life: 1.1, grow: 1.4 },
      );
    }
  }

  private updateVisuals(dt: number, input: InputState) {
    const root = this.skier.root;
    const seated = this.state === "lift";
    const crashed = this.state === "crash";
    const targetN = seated || !this.grounded ? UP : this.n;
    this.visN.lerp(targetN, damp(this.grounded ? 14 : 3, dt)).normalize();

    root.position.copy(this.pos);
    this.qa.setFromUnitVectors(UP, this.visN);
    this.qb.setFromAxisAngle(UP, this.heading);
    root.quaternion.copy(this.qa).multiply(this.qb);
    if (crashed) {
      this.tumble += dt * Math.max(2, this.speed * 0.9);
      const settle = Math.min(1, this.crashTimer / 0.6);
      root.quaternion.multiply(this.qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(this.tumble) * 1.3 * settle + (1 - settle) * 0));
      root.position.y += Math.abs(Math.sin(this.tumble * 0.5)) * 0.4 * settle;
    }

    this.skier.update(dt, {
      speed: this.speed,
      turn: crashed ? 0 : this.steer,
      tuck: input.tuck && this.skate < 0.5 && !crashed && !seated,
      brake: input.brake && !crashed && !seated,
      air: !this.grounded && this.airTime > 0.1,
      skate: seated ? 0 : this.skate,
      seated,
      crashed,
      squash: this.squash,
    });

    // blob shadow
    const t = this.world.terrain;
    const gy = t.heightAt(this.pos.x, this.pos.z);
    const h = this.pos.y - gy;
    this.blob.visible = !seated || h < 30;
    this.blob.position.set(this.pos.x, gy + 0.05, this.pos.z);
    this.blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.normalAt(this.pos.x, this.pos.z, this.tmp));
    this.blob.rotateZ(-this.heading);
    const s = 1 / (1 + h * 0.15);
    this.blob.scale.setScalar(s);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = s;

    // tracks + spray
    if (this.grounded && !seated && !crashed && this.speed > 0.5) {
      this.trails.add(this.pos, this.lat, 0.15);
    } else {
      this.trails.break();
    }
    if (this.grounded && !seated && this.speed > 3) {
      const rate = (this.skid * 90 + (this.speed > 15 ? (this.speed - 15) * 2 : 0)) * (this.surface === "ice" ? 0.2 : 1);
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
  }
}
