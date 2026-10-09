import * as THREE from "three";
import { clay } from "./materials";
import { damp, lerp } from "./noise";
import { CHARACTERS, type Character } from "./characters";
import { sculptAnimal } from "./animals";

const WHITE = 0xfbfbf7;
const BOOT = 0x3a3f4a;
const POLE = 0x9aa3ad;

export interface PoseInput {
  speed: number;
  /** -1 (left) .. 1 (right) */
  turn: number;
  tuck: boolean;
  brake: boolean;
  air: boolean;
  /** 0..1, pushing off at low speed */
  skate: number;
  seated: boolean;
  crashed: boolean;
  /** compress legs briefly, e.g. on landing or before jumping */
  squash: number;
}

const THIGH = 0.27;
const SHIN = 0.27;
const UP = new THREE.Vector3(0, 1, 0);

function mesh(geo: THREE.BufferGeometry, color: number, opts?: Parameters<typeof clay>[1]) {
  const m = new THREE.Mesh(geo, clay(color, { bump: 0.22, ...opts }));
  m.castShadow = true;
  return m;
}

interface Leg {
  side: number;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
  ski: THREE.Group;
}

/** A round little skier made of clay. Origin between the feet; faces +z. */
export class Skier {
  readonly root = new THREE.Group();
  /** body that leans into turns (child of root) */
  readonly lean = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private poleL = new THREE.Group();
  private poleR = new THREE.Group();
  private scarfTail = new THREE.Group();
  private pompom: THREE.Mesh;
  private eyes: THREE.Group[] = [];
  private ears: THREE.Group[] = [];
  private animalTail: THREE.Group;
  private legs: Leg[] = [];

  private crouch = 0;
  private leanAngle = 0;
  private hipY = 0.62;
  private time = 0;
  private blinkTimer = 2;
  private polePhase = 0;
  private skatePhase = 0;
  private spread = 0;
  private plow = 0;
  private air = 0;
  private seat = 0;
  private flail = 0;
  private pompomVel = new THREE.Vector2();
  private pompomOff = new THREE.Vector2();

  constructor(readonly character: Character = CHARACTERS[0]) {
    const { jacket: JACKET, pants: PANTS, hat: HAT, skis: SKI } = character;
    this.root.name = `skier-${character.id}`;
    this.root.add(this.lean);
    this.lean.add(this.hips);
    this.hips.add(this.torso);

    // ---- legs + skis
    for (const side of [-1, 1]) {
      const thigh = mesh(new THREE.CapsuleGeometry(0.085, THIGH - 0.06, 4, 10), PANTS);
      const shin = mesh(new THREE.CapsuleGeometry(0.08, SHIN - 0.06, 4, 10), PANTS);
      const knee = mesh(new THREE.SphereGeometry(0.088, 10, 8), PANTS);
      this.lean.add(thigh, shin, knee);
      const ski = new THREE.Group();
      const board = mesh(new THREE.BoxGeometry(0.13, 0.035, 1.45), SKI, { bump: 0.25 });
      board.position.set(0, 0.018, -0.05);
      const tip = mesh(new THREE.BoxGeometry(0.13, 0.035, 0.28), SKI, { bump: 0.25 });
      tip.position.set(0, 0.06, 0.76);
      tip.rotation.x = -0.45;
      const tail = mesh(new THREE.BoxGeometry(0.13, 0.035, 0.14), SKI, { bump: 0.25 });
      tail.position.set(0, 0.03, -0.81);
      tail.rotation.x = 0.25;
      const stripe = mesh(new THREE.BoxGeometry(0.135, 0.038, 0.12), WHITE, { bump: 0.2 });
      stripe.position.set(0, 0.02, 0.45);
      const boot = mesh(new THREE.BoxGeometry(0.15, 0.17, 0.27), BOOT);
      boot.position.set(0, 0.12, 0.0);
      const cuff = mesh(new THREE.CylinderGeometry(0.09, 0.095, 0.08, 10), HAT);
      cuff.position.set(0, 0.2, -0.01);
      ski.add(board, tip, tail, stripe, boot, cuff);
      this.lean.add(ski);
      this.legs.push({ side, thigh, shin, knee, ski });
    }

    // ---- torso
    const body = mesh(new THREE.CapsuleGeometry(0.235, 0.2, 6, 16), JACKET);
    body.position.y = 0.2;
    body.scale.set(1, 1, 0.9);
    this.torso.add(body);
    const belly = mesh(new THREE.SphereGeometry(0.2, 14, 10), JACKET);
    belly.position.set(0, 0.12, 0.05);
    this.torso.add(belly);
    // Rounded colour-block pockets on a puffy ski jacket.
    for (const side of [-1, 1]) {
      const pocket = mesh(new THREE.CapsuleGeometry(0.057, 0.035, 4, 10), HAT);
      pocket.rotation.z = side * -0.28;
      pocket.scale.z = 0.35;
      pocket.position.set(side * 0.125, 0.13, 0.21);
      this.torso.add(pocket);
    }
    // zipper + swiss cross on the back
    const zip = mesh(new THREE.BoxGeometry(0.02, 0.3, 0.02), WHITE, { bump: 0.1 });
    zip.position.set(0, 0.24, 0.232);
    this.torso.add(zip);
    const crossV = mesh(new THREE.BoxGeometry(0.05, 0.15, 0.03), WHITE, { bump: 0.1 });
    const crossH = mesh(new THREE.BoxGeometry(0.15, 0.05, 0.03), WHITE, { bump: 0.1 });
    crossV.position.set(0, 0.28, -0.205);
    crossH.position.set(0, 0.28, -0.205);
    this.torso.add(crossV, crossH);

    // scarf
    const scarf = mesh(new THREE.TorusGeometry(0.17, 0.06, 8, 18), WHITE);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.45;
    this.torso.add(scarf);
    this.scarfTail.position.set(0.1, 0.45, -0.15);
    const tailMesh = mesh(new THREE.BoxGeometry(0.1, 0.03, 0.32), WHITE);
    tailMesh.position.z = -0.15;
    const tailStripe = mesh(new THREE.BoxGeometry(0.105, 0.035, 0.05), JACKET);
    tailStripe.position.z = -0.27;
    this.scarfTail.add(tailMesh, tailStripe);
    this.torso.add(this.scarfTail);

    // ---- head
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    const animal = sculptAnimal(this.head, this.torso, character);
    this.eyes = animal.eyes;
    this.ears = animal.ears;
    this.animalTail = animal.tail;

    // beanie
    const hat = mesh(new THREE.SphereGeometry(0.275, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), HAT);
    hat.position.set(0, 0.09, -0.045);
    hat.scale.set(1.04, 1.05, 1.02);
    this.head.add(hat);
    const rim = mesh(new THREE.TorusGeometry(0.272, 0.045, 8, 24), HAT);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0.1, -0.045);
    rim.scale.set(1.04, 1.02, 1);
    this.head.add(rim);
    for (let i = 0; i < 3; i++) {
      const band = mesh(new THREE.TorusGeometry(0.26 - i * 0.07, 0.022, 6, 24), JACKET);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 0.18 + i * 0.07, -0.045);
      band.scale.setScalar(1 - i * 0.12);
      this.head.add(band);
    }
    this.pompom = mesh(new THREE.SphereGeometry(0.087, 14, 10), WHITE, { bump: 0.9 });
    this.pompom.position.y = 0.38;
    this.head.add(this.pompom);
    // goggles resting on the hat
    const strap = mesh(new THREE.TorusGeometry(0.285, 0.022, 6, 28), 0x30343c);
    strap.rotation.x = Math.PI / 2 - 0.25;
    strap.position.set(0, 0.19, -0.045);
    this.head.add(strap);
    const lens = mesh(new THREE.CapsuleGeometry(0.07, 0.12, 4, 12), 0x8bdce4, { roughness: 0.15, bump: 0 });
    lens.rotation.z = Math.PI / 2;
    lens.scale.set(1, 1, 0.5);
    lens.position.set(0, 0.255, 0.22);
    lens.rotation.x = -0.35;
    this.head.add(lens);

    // ---- arms
    for (const [arm, pole, s] of [
      [this.armL, this.poleL, -1],
      [this.armR, this.poleR, 1],
    ] as const) {
      arm.position.set(s * 0.25, 0.36, 0);
      const sleeve = mesh(new THREE.CapsuleGeometry(0.07, 0.2, 4, 10), JACKET);
      sleeve.position.y = -0.14;
      const mitt = mesh(new THREE.SphereGeometry(0.075, 12, 10), HAT);
      mitt.position.y = -0.3;
      const thumb = mesh(new THREE.SphereGeometry(0.035, 8, 6), HAT);
      thumb.position.set(-s * 0.05, -0.27, 0.04);
      arm.add(sleeve, mitt, thumb);
      pole.position.y = -0.3;
      const shaft = mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.05, 6), POLE, { bump: 0 });
      shaft.position.y = -0.45;
      const basket = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), 0x30343c, { bump: 0 });
      basket.rotation.x = Math.PI / 2;
      basket.position.y = -0.85;
      const grip = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), 0x30343c, { bump: 0 });
      pole.add(shaft, basket, grip);
      arm.add(pole);
      this.torso.add(arm);
    }
  }

  dispose() {
    this.root.traverse((part) => {
      if (part instanceof THREE.Mesh) part.geometry.dispose();
    });
  }

  private placeSegment(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    const d = new THREE.Vector3().subVectors(b, a).normalize();
    m.quaternion.setFromUnitVectors(UP, d);
  }

  private tmpH = new THREE.Vector3();
  private tmpF = new THREE.Vector3();
  private tmpK = new THREE.Vector3();

  private solveLeg(leg: Leg, hip: THREE.Vector3, foot: THREE.Vector3) {
    const vz = foot.z - hip.z;
    const vy = foot.y - hip.y;
    const d = Math.min(Math.hypot(vz, vy), THIGH + SHIN - 0.001);
    const phiV = Math.atan2(vz, -vy);
    const alpha = Math.acos(THREE.MathUtils.clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    const phiT = phiV + alpha;
    this.tmpK.set(lerp(hip.x, foot.x, 0.5), hip.y - Math.cos(phiT) * THIGH, hip.z + Math.sin(phiT) * THIGH);
    this.placeSegment(leg.thigh, hip, this.tmpK);
    this.placeSegment(leg.shin, this.tmpK, foot);
    leg.knee.position.copy(this.tmpK);
  }

  update(dt: number, p: PoseInput) {
    this.time += dt;
    const t = this.time;
    const k = (r: number) => damp(r, dt);

    // --- targets
    const speedN = Math.min(1, p.speed / 25);
    let crouchT = 0.25 + speedN * 0.25;
    if (p.tuck) crouchT = 0.95;
    if (p.brake) crouchT = 0.45;
    if (p.air) crouchT = 0.75;
    crouchT = Math.min(1.2, crouchT + p.squash);
    this.crouch = lerp(this.crouch, crouchT, k(10));
    this.leanAngle = lerp(this.leanAngle, p.air || p.seated ? 0 : p.turn * (0.15 + speedN * 0.4), k(8));
    this.spread = lerp(this.spread, p.air ? 0.02 : p.brake ? 0.18 : 0.06, k(8));
    this.plow = lerp(this.plow, p.brake ? 1 : 0, k(8));
    this.air = lerp(this.air, p.air ? 1 : 0, k(8));
    this.seat = lerp(this.seat, p.seated ? 1 : 0, k(6));
    this.flail = lerp(this.flail, p.crashed ? 1 : 0, k(10));
    if (p.skate > 0.05) this.skatePhase += dt * 6;

    // --- body
    const hipStand = 0.6;
    this.hipY = hipStand - this.crouch * 0.2;
    const bob = Math.sin(t * 2.2) * 0.008 * (1 - speedN);
    const skate = Math.sin(this.skatePhase) * p.skate;
    this.hips.position.set(skate * 0.06, this.hipY + bob + Math.abs(skate) * 0.03, -this.crouch * 0.08);
    this.lean.rotation.z = this.leanAngle;
    this.torso.rotation.x = 0.1 + this.crouch * 0.55 - this.seat * 0.15;
    this.torso.rotation.z = skate * 0.1;
    this.head.rotation.x = -this.torso.rotation.x * 0.7;
    this.head.rotation.y = lerp(this.head.rotation.y, -p.turn * 0.35, k(5));

    // --- legs
    for (const leg of this.legs) {
      const s = leg.side;
      const hip = this.tmpH.set(s * 0.1 + this.hips.position.x, this.hips.position.y, this.hips.position.z);
      const legSkate = Math.max(0, s * skate);
      const foot = this.tmpF.set(s * (0.13 + this.spread + legSkate * 0.12), 0.18 + legSkate * 0.06, 0);
      if (this.seat > 0.01) {
        // dangling from the chair: feet in front and below the hips
        const swing = Math.sin(t * 1.5 + s) * 0.06;
        foot.x = lerp(foot.x, s * 0.14, this.seat);
        foot.y = lerp(foot.y, hip.y - 0.36, this.seat);
        foot.z = lerp(foot.z, hip.z + 0.3 + swing, this.seat);
      }
      if (this.air > 0.01) foot.y += this.air * 0.08;
      this.solveLeg(leg, hip, foot);
      leg.ski.position.set(foot.x, foot.y - 0.18, foot.z);
      leg.ski.rotation.set(this.seat * -0.3 + this.air * -0.15, -s * this.plow * 0.28 + s * legSkate * 0.35, -this.leanAngle * 0.4);
    }

    // --- arms + poles
    const polePlant = p.speed > 3 && !p.air && !p.tuck && !p.seated && !p.crashed;
    if (polePlant) this.polePhase += dt * (2 + speedN * 2);
    const plant = polePlant ? Math.max(0, Math.sin(this.polePhase)) : 0;
    for (const [arm, pole, s] of [
      [this.armL, this.poleL, -1],
      [this.armR, this.poleR, 1],
    ] as const) {
      let fwd = 0.55 + plant * 0.35 * (s > 0 ? 1 : 0.6);
      let out = 0.2;
      if (p.tuck) {
        fwd = 1.15;
        out = 0.05;
      }
      if (p.skate > 0.05) fwd = 0.6 + Math.sin(this.skatePhase + (s > 0 ? 0 : Math.PI)) * 0.6;
      fwd = lerp(fwd, 0.2, this.air);
      out = lerp(out, 1.1, this.air);
      fwd = lerp(fwd, 0.5, this.seat);
      out = lerp(out, 0.15, this.seat);
      fwd = lerp(fwd, 2.6 + Math.sin(t * 18 + s) * 0.8, this.flail);
      out = lerp(out, 1.3, this.flail);
      // also lift the outside arm a little in turns
      out += Math.max(0, -s * p.turn) * 0.25 * speedN;
      arm.rotation.x = lerp(arm.rotation.x, -fwd, k(10));
      arm.rotation.z = lerp(arm.rotation.z, s * out, k(10));
      // poles trail behind, roughly parallel to the slope
      pole.rotation.x = lerp(pole.rotation.x, fwd + 0.35 - plant * 0.7 + (p.tuck ? 0.9 : 0) - this.seat * 0.6, k(10));
      pole.rotation.z = lerp(pole.rotation.z, -s * out * 0.6, k(10));
    }

    // --- scarf flaps in the wind
    const wind = Math.min(1, p.speed / 18);
    this.scarfTail.rotation.x = -0.9 + wind * 0.9 + Math.sin(t * (6 + wind * 14)) * (0.08 + wind * 0.15);
    this.scarfTail.rotation.y = Math.sin(t * 9.3) * 0.15 * wind;

    // --- pompom jiggle (spring)
    const accel = (this.crouch - crouchT) * 2;
    this.pompomVel.x += (-this.pompomOff.x * 120 - this.pompomVel.x * 8 + p.turn * 4 * speedN) * dt;
    this.pompomVel.y += (-this.pompomOff.y * 120 - this.pompomVel.y * 8 + accel + wind * 2) * dt;
    this.pompomOff.addScaledVector(this.pompomVel, dt);
    this.pompom.position.set(this.pompomOff.x * 0.12, 0.38, -this.pompomOff.y * 0.12);

    this.animalTail.rotation.y = Math.sin(t * 3.5) * (0.14 + wind * 0.15);
    this.ears.forEach((ear, i) => {
      ear.rotation.x = Math.sin(t * 2.4 + i * 0.8) * 0.045 + wind * 0.12;
    });

    // --- blink
    this.blinkTimer -= dt;
    const blink = this.blinkTimer < 0.12 ? 0.1 : p.crashed ? 0.2 : 1;
    if (this.blinkTimer < 0) this.blinkTimer = 2 + Math.random() * 3;
    for (const e of this.eyes) e.scale.y = lerp(e.scale.y, blink, k(40));
  }
}
