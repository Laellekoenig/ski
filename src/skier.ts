import * as THREE from "three";
import { damp, lerp } from "./noise";
import { CHARACTERS, type Character } from "./characters";
import { gearMesh, limbGeometry, loftGeometry } from "./gear";
import { makeBoot, makePole, makeSki, POLE_LENGTH, SKI_TAIL, SKI_TIP } from "./equipment";
import { dressHead } from "./headwear";
import { dressNeck, jacketMaterial, pantsMaterial } from "./looks";

export { makeSki } from "./equipment";

const THIGH = 0.39;
const SHIN = 0.38;
/** Grip to pole tip. */
const POLE = 0.95;
/** Shoulder line above the hips, hips either side of them, the ankle above the ski's base and the hand below the elbow. */
const SHOULDER_Y = 0.42;
const HIP_X = 0.12;
const ANKLE = 0.25;
const HAND = 0.262;
/** Shoulder to elbow, and elbow to the pole grip. */
const UPPER_ARM = 0.25;
const GRIP = 0.267;
/** Skating stride cycle (left push + right push), rad/s: brisk first steps, longer glides as the skis run. */
const SKATE_RATE_START = 4.4;
const SKATE_RATE_RUNNING = 2.5;
const UP = new THREE.Vector3(0, 1, 0);

export interface PoseInput {
  speed: number;
  /** -1 (left) .. 1 (right) */
  turn: number;
  tuck: boolean;
  /** Low racing crouch: chest down over the knees, hands together in front. */
  duck?: boolean;
  brake: boolean;
  air: boolean;
  /** 0..1, pushing off at low speed */
  skate: number;
  seated: boolean;
  /** compress legs briefly, e.g. on landing or before jumping */
  squash: number;
  /** 0..1, stepping on foot (skis off) */
  walk?: number;
  /** 0..1, waving the right arm */
  wave?: number;
  /** Lean into the turn in radians, from the lateral load; derived from `turn` when omitted. */
  edge?: number;
  /** m/s² along the skis; braking throws the upper body forward. */
  accel?: number;
  /** Terrain under the skis: compressions (+) fold the legs, crests (−) let them extend. */
  absorb?: number;
  /** 0..1, skis skidding sideways rather than carving. */
  skid?: number;
  /** Seconds since takeoff; enables the full flight sequence. */
  airTime?: number;
  /** Estimated seconds until touchdown. */
  toGround?: number;
  /** Spin rate in the air, rad/s; positive spins right. */
  spin?: number;
}

/** A damped spring: the body overshoots and settles, so it reads as carrying momentum. */
class Spring {
  x = 0;
  v = 0;
  constructor(private freq: number, private zeta: number) {}
  step(target: number, dt: number) {
    const w = Math.PI * 2 * this.freq;
    const h = Math.min(dt, 1 / 30);
    this.v += (w * w * (target - this.x) - 2 * this.zeta * w * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

/** Air styles cycle from jump to jump. */
const AIR_TUCK = 0;
const AIR_SAFETY_R = 1;
const AIR_TRUCK = 2;
const AIR_SAFETY_L = 3;
const AIR_STYLES = 4;

interface Leg {
  side: number;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
  ski: THREE.Group;
  board: THREE.Group;
}

/** Feet sit this far apart when standing on skis. */
export const SKI_GAP = 0.19;

/** Ragdoll joints, in the order `captureJoints` writes and `poseRagdoll` reads them. Pairs are [side −1, side +1]. */
export const JOINT = { pelvis: 0, chest: 1, head: 2, shoulder: [3, 4], elbow: [5, 6], hand: [7, 8], hip: [9, 10], knee: [11, 12], foot: [13, 14] } as const;
export const JOINT_COUNT = 15;

/** Smooth, rounded bodies in loud early-2000s outfits with painted faces. Origin between the feet. */
export class Skier {
  readonly root = new THREE.Group();
  readonly lean = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private poleL = new THREE.Group();
  private poleR = new THREE.Group();
  private legs: Leg[] = [];
  /** These materials belong to this rider; shared fabric and equipment materials are cached. */
  private ownedMaterials: THREE.Material[] = [];

  private forearms: THREE.Group[] = [];

  private crouch = 0;
  private crouchS = new Spring(2.6, 0.45);
  private leanS = new Spring(1.7, 0.55);
  private pitchS = new Spring(1.8, 0.5);
  private twistS = new Spring(1.4, 0.6);
  /** The way the rider is steering, −1, 0 or 1, held through small stick wobbles. */
  private turnSide = 0;
  /** Pole plant progress per side, 0..1 (1 = idle). */
  private plant = [1, 1];
  /** Fades plants in on the snow and out in the air or a tuck. */
  private planting = 0;
  /** Pole pitch and roll in the forearm before a plant takes over the tip. */
  private poleRest = [new THREE.Vector2(), new THREE.Vector2()];
  private hipY = 0.94;
  private time = 0;
  private skatePhase = 0;
  /** Skating weight, faded out whenever the skis leave the snow. */
  private skating = 0;
  private spread = 0;
  private plow = 0;
  private duck = 0;
  private air = 0;
  private seat = 0;
  private walk = 0;
  private walkPhase = 0;
  private wave = 0;
  private wasFlying = false;
  private style = AIR_STYLES - 1;
  private fold = 0;
  private grab = 0;
  private reach = 0;
  private spinning = 0;

  constructor(readonly character: Character = CHARACTERS[0]) {
    const c = character;
    const own = <T extends THREE.Material>(material: T) => {
      this.ownedMaterials.push(material);
      return material;
    };
    const female = c.gender === "female";
    const baggy = c.outfit === "park";
    const puffy = !!c.puffy;
    const shoulder = (female ? 0.37 : baggy ? 0.47 : 0.44) + (puffy ? 0.04 : 0);
    const waist = (female ? 0.27 : baggy ? 0.42 : 0.34) + (puffy ? 0.04 : 0);
    const hipWidth = female ? waist + 0.08 : waist + 0.04;
    const depth = (baggy ? 0.25 : 0.22) + (puffy ? 0.03 : 0);
    const jacket = jacketMaterial(c, own);
    const pants = pantsMaterial(c, own);
    this.root.name = `skier-${c.id}`;
    this.root.scale.setScalar(c.height);
    this.root.add(this.lean);
    this.lean.add(this.hips);
    this.hips.add(this.torso);

    // The seat of the trousers joins both thighs under the jacket hem.
    const pelvis = gearMesh(new THREE.SphereGeometry(1, 16, 10), pants);
    pelvis.scale.set(hipWidth * 0.52, 0.13, depth * 0.5); pelvis.position.y = -0.03;
    this.hips.add(pelvis);

    for (const side of [-1, 1]) {
      const r = baggy ? 0.1 : female ? 0.074 : 0.084;
      // Lathed from the lower joint up: knee to hip, and boot to knee with a hem over the boot.
      const thigh = gearMesh(limbGeometry(THIGH, [r * 0.86, r * 0.98, r * 1.08, r * 1.1]), pants);
      const hem = baggy ? 0.118 : c.outfit === "race" ? 0.094 : 0.1;
      const shin = gearMesh(limbGeometry(SHIN, [hem, r * 0.8, r * 0.86, r * 0.84], { hem: 0.045 }), pants);
      const knee = gearMesh(new THREE.SphereGeometry(r * 0.88, 12, 8), pants);
      this.lean.add(thigh, shin, knee);
      const ski = new THREE.Group();
      const board = makeSki(c.skis, c.accent, c.outfit);
      ski.add(board, makeBoot(c.gloves));
      this.lean.add(ski);
      this.legs.push({ side, thigh, shin, knee, ski, board });
    }

    const hem = baggy ? -0.14 : -0.09;
    const body = gearMesh(loftGeometry([
      { y: hem, width: hipWidth + (baggy ? 0.03 : 0.01), depth: depth * 1.02 },
      { y: 0.05, width: hipWidth * 0.98, depth: depth * 0.98 },
      { y: 0.17, width: waist, depth: depth * 0.92 },
      { y: 0.29, width: lerp(waist, shoulder, 0.78), depth: depth * (female ? 1.08 : 1.02), z: 0.008 },
      { y: 0.39, width: shoulder, depth },
      { y: 0.46, width: shoulder * 0.9, depth: depth * 0.86 },
      { y: 0.51, width: shoulder * 0.56, depth: depth * 0.62 },
      { y: 0.54, width: 0.16, depth: 0.14 },
    ]), jacket);
    this.torso.add(body);
    dressNeck(this.torso, c, own, 0.54);

    this.head.position.y = 0.645;
    this.torso.add(this.head);
    dressHead(this.head, c, own);
    const arm = (female ? 0.058 : baggy ? 0.074 : 0.066) + (puffy ? 0.012 : 0);
    this.addArm(this.armL, this.poleL, -1, c, shoulder, arm, jacket);
    this.addArm(this.armR, this.poleR, 1, c, shoulder, arm, jacket);
  }

  private addArm(arm: THREE.Group, pole: THREE.Group, side: number, c: Character, shoulder: number, r: number, jacket: THREE.Material) {
    arm.position.set(side * (shoulder / 2 - r * 0.45), SHOULDER_Y, 0);
    const deltoid = gearMesh(new THREE.SphereGeometry(r * 1.12, 12, 8), jacket);
    deltoid.scale.set(1.05, 0.95, 1); arm.add(deltoid);
    const sleeve = gearMesh(limbGeometry(0.25, [r * 0.84, r * 0.98, r * 1.04]), jacket);
    sleeve.position.y = -0.125; arm.add(sleeve);
    const elbow = gearMesh(new THREE.SphereGeometry(r * 0.86, 10, 8), jacket);
    elbow.position.y = -0.25; arm.add(elbow);
    const forearm = new THREE.Group();
    forearm.position.y = -0.25; forearm.rotation.x = -0.4;
    arm.add(forearm);
    this.forearms.push(forearm);
    const lower = gearMesh(limbGeometry(0.2, [r * 0.74, r * 0.8, r * 0.84]), jacket);
    lower.position.y = -0.1; forearm.add(lower);
    // Gauntlet glove pulled over the cuff, then a rounded mitt and thumb.
    const gauntlet = gearMesh(limbGeometry(0.05, [0.054, 0.046], { hem: 0.012 }), c.gloves);
    gauntlet.position.y = -0.21; gauntlet.rotation.x = Math.PI; forearm.add(gauntlet);
    const glove = gearMesh(new THREE.SphereGeometry(0.05, 10, 8), c.gloves);
    glove.scale.set(0.88, 1.2, 0.78); glove.position.set(0, -0.262, 0.012); forearm.add(glove);
    const thumb = gearMesh(new THREE.SphereGeometry(0.022, 8, 6), c.gloves);
    thumb.scale.set(1, 1.3, 1); thumb.position.set(-side * 0.035, -0.252, 0.03); forearm.add(thumb);
    pole.position.set(0, -0.267, 0.023);
    pole.add(makePole(c.accent, side));
    forearm.add(pole);
    this.torso.add(arm);
  }

  /** Skis on the feet, or left lying in the snow while walking around. */
  get skis() {
    return this.legs[0].board.visible;
  }
  set skis(on: boolean) {
    for (const leg of this.legs) leg.board.visible = on;
  }

  /** Skis and poles on the rider, or torn off in a fall. */
  set gear(on: boolean) {
    this.skis = on;
    this.poleL.visible = this.poleR.visible = on;
  }

  /** World-space joint positions of the current pose, to hand over to a ragdoll. */
  captureJoints(out: THREE.Vector3[]) {
    this.root.updateMatrixWorld(true);
    out[JOINT.pelvis].setFromMatrixPosition(this.hips.matrixWorld);
    this.torso.localToWorld(out[JOINT.chest].set(0, SHOULDER_Y, 0));
    out[JOINT.head].setFromMatrixPosition(this.head.matrixWorld);
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      out[JOINT.shoulder[i]].setFromMatrixPosition((i ? this.armR : this.armL).matrixWorld);
      out[JOINT.elbow[i]].setFromMatrixPosition(this.forearms[i].matrixWorld);
      this.forearms[i].localToWorld(out[JOINT.hand[i]].set(0, -HAND, 0));
      this.hips.localToWorld(out[JOINT.hip[i]].set(leg.side * HIP_X, 0, 0));
      out[JOINT.knee[i]].setFromMatrixPosition(leg.knee.matrixWorld);
      this.lean.localToWorld(out[JOINT.foot[i]].copy(leg.ski.position).setY(leg.ski.position.y + ANKLE));
    }
  }

  /** World-space ends of a ski (tail, tip) and the way its topsheet faces. */
  skiEnds(i: number, tail: THREE.Vector3, tip: THREE.Vector3, up: THREE.Vector3) {
    const board = this.legs[i].board;
    board.localToWorld(tail.set(0, 0, SKI_TAIL));
    board.localToWorld(tip.set(0, 0, SKI_TIP));
    up.setFromMatrixColumn(board.matrixWorld, 1).normalize();
  }

  /** World-space grip and tip of a pole. */
  poleEnds(i: number, grip: THREE.Vector3, tip: THREE.Vector3) {
    const pole = i ? this.poleR : this.poleL;
    pole.localToWorld(grip.set(0, 0, 0));
    pole.localToWorld(tip.set(0, -POLE_LENGTH, 0));
  }

  private tmpU = new THREE.Vector3();
  private tmpR = new THREE.Vector3();
  private tmpZ = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private local = Array.from({ length: JOINT_COUNT }, () => new THREE.Vector3());

  /** Lay the body over world-space ragdoll joints; the trunk, head and boots stay rigid. */
  poseRagdoll(joints: readonly THREE.Vector3[]) {
    const scale = this.root.scale.x;
    const j = this.local;
    for (let i = 0; i < JOINT_COUNT; i++) j[i].subVectors(joints[i], joints[JOINT.pelvis]).divideScalar(scale);
    this.root.position.copy(joints[JOINT.pelvis]);
    this.root.quaternion.identity();
    this.lean.rotation.set(0, 0, 0);

    // the trunk: up the spine, across the shoulders
    const up = this.tmpU.copy(j[JOINT.chest]).normalize();
    const right = this.tmpR.subVectors(j[JOINT.shoulder[1]], j[JOINT.shoulder[0]]);
    right.addScaledVector(up, -right.dot(up)).normalize();
    const fwd = this.tmpZ.crossVectors(right, up);
    this.hips.position.set(0, 0, 0);
    this.hips.quaternion.setFromRotationMatrix(this.tmpM.makeBasis(right, up, fwd));
    this.torso.rotation.set(0, 0, 0);
    const trunk = this.tmpQ.copy(this.hips.quaternion).invert();

    // arms: the upper arm points at the elbow, the elbow folds toward the hand
    for (let i = 0; i < 2; i++) {
      const arm = i ? this.armR : this.armL;
      const y = this.tmpH.subVectors(j[JOINT.shoulder[i]], j[JOINT.elbow[i]]).applyQuaternion(trunk).normalize();
      const lower = this.tmpF.subVectors(j[JOINT.hand[i]], j[JOINT.elbow[i]]).applyQuaternion(trunk).normalize();
      const z = this.tmpK.copy(lower).addScaledVector(y, -lower.dot(y));
      if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
      z.normalize();
      const x = this.tmpG.crossVectors(y, z);
      arm.quaternion.setFromRotationMatrix(this.tmpM.makeBasis(x, y, z));
      this.forearms[i].rotation.set(Math.atan2(-lower.dot(z), -lower.dot(y)), 0, 0);
    }

    // legs: thigh and shin between the joints, the boot square to the shin with its toe under the knee
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const hip = j[JOINT.hip[i]], knee = j[JOINT.knee[i]], foot = j[JOINT.foot[i]];
      this.placeSegment(leg.thigh, knee, hip);
      this.placeSegment(leg.shin, foot, knee);
      leg.knee.position.copy(knee);
      const y = this.tmpH.subVectors(knee, foot).normalize();
      const z = this.tmpF.addVectors(hip, foot).multiplyScalar(-0.5).add(knee);
      z.addScaledVector(y, -z.dot(y));
      if (z.lengthSq() < 1e-6) z.copy(fwd).addScaledVector(y, -fwd.dot(y));
      z.normalize();
      leg.ski.quaternion.setFromRotationMatrix(this.tmpM.makeBasis(this.tmpG.crossVectors(y, z), y, z));
      leg.ski.position.copy(foot).addScaledVector(y, -ANKLE);
    }
  }

  /** Back on the feet: clear the ragdoll's rotations so the animated pose takes over again. */
  endRagdoll() {
    this.hips.rotation.set(0, 0, 0);
    for (const arm of [this.armL, this.armR]) arm.rotation.set(0, 0, 0);
    this.gear = true;
  }

  dispose() {
    this.root.traverse((part) => {
      if (part instanceof THREE.Mesh) part.geometry.dispose();
    });
    for (const material of this.ownedMaterials) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
  }

  private placeSegment(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    const d = new THREE.Vector3().subVectors(b, a).normalize();
    m.quaternion.setFromUnitVectors(UP, d);
  }

  private tmpH = new THREE.Vector3();
  private tmpF = new THREE.Vector3();
  private tmpK = new THREE.Vector3();
  private tmpG = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpAim = new THREE.Vector2();
  private tmpAim3 = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpT = new THREE.Vector3();

  private solveLeg(leg: Leg, hip: THREE.Vector3, foot: THREE.Vector3) {
    const v = this.tmpV.subVectors(foot, hip);
    const d = Math.min(v.length(), THIGH + SHIN - 0.001);
    v.normalize();
    const alpha = Math.acos(THREE.MathUtils.clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    // the knee bends forward, square to the hip-foot line, so legs pushed out wide still fold true
    const bend = this.tmpB.set(0, 0, 1).addScaledVector(v, -v.z).normalize();
    this.tmpK.copy(hip).addScaledVector(v, Math.cos(alpha) * THIGH).addScaledVector(bend, Math.sin(alpha) * THIGH);
    // Limbs are lathed from their lower joint up.
    this.placeSegment(leg.thigh, this.tmpK, hip);
    this.placeSegment(leg.shin, foot, this.tmpK);
    leg.knee.position.copy(this.tmpK);
  }

  /** Aim an arm (shoulder joint) at a point given in lean space; returns its euler angles. */
  private aim(arm: THREE.Group, target: THREE.Vector3) {
    this.hips.updateMatrix();
    this.torso.updateMatrix();
    this.tmpM.multiplyMatrices(this.hips.matrix, this.torso.matrix).invert();
    const d = target.applyMatrix4(this.tmpM).sub(arm.position).normalize();
    return { x: Math.atan2(-d.z, -d.y), z: Math.asin(THREE.MathUtils.clamp(d.x, -1, 1)) };
  }

  /** Where a hand grabs its ski in the current air style, in lean space. */
  private grabTarget(s: number) {
    const ski = this.legs[s < 0 ? 0 : 1].ski.position;
    return this.style === AIR_TRUCK
      ? this.tmpG.set(ski.x + s * 0.02, ski.y + 0.06, ski.z + 0.45)
      : this.tmpG.set(ski.x + s * 0.075, ski.y + 0.07, ski.z + 0.12);
  }

  update(dt: number, p: PoseInput) {
    this.time += dt;
    const t = this.time;
    const k = (r: number) => damp(r, dt);
    const { smoothstep, clamp } = THREE.MathUtils;
    const speedN = Math.min(1, p.speed / 25);
    const grounded = !p.air && !p.seated;
    const skid = grounded ? p.skid ?? 0 : 0;

    // --- flight: pop off the lip, fold the knees up (maybe grab), then reach for the snow
    const flying = p.air;
    if (flying && !this.wasFlying) this.style = (this.style + 1) % AIR_STYLES;
    this.wasFlying = flying;
    const tricks = flying && p.airTime !== undefined;
    const airTime = p.airTime ?? 1;
    const toGround = p.toGround ?? 1;
    const pop = tricks ? 1 - smoothstep(airTime, 0.1, 0.3) : 0;
    const fold = tricks ? smoothstep(airTime, 0.14, 0.4) * smoothstep(toGround, 0.1, 0.42) : 0;
    const long = airTime + toGround > 0.8 && this.style !== AIR_TUCK;
    this.fold = lerp(this.fold, fold, k(12));
    this.grab = lerp(this.grab, long ? fold : 0, k(10));
    this.reach = lerp(this.reach, tricks ? 1 - smoothstep(toGround, 0.1, 0.4) : 0, k(14));
    this.spinning = lerp(this.spinning, flying ? Math.min(1, Math.abs(p.spin ?? 0) / 4) : 0, k(6));

    // --- carving: lean into the load, edges bite, the upper body stays quiet over the skis
    this.plow = lerp(this.plow, p.brake ? 1 : 0, k(8));
    this.duck = lerp(this.duck, p.duck && grounded ? 1 : 0, k(7));
    this.skating = lerp(this.skating, grounded ? p.skate : 0, k(8));
    const edgeT = grounded ? (p.edge ?? p.turn * (0.15 + speedN * 0.4)) * (1 - this.plow * 0.6) : 0;
    const lean = this.leanS.step(edgeT, dt);
    const side = Math.abs(p.turn) > 0.25 ? Math.sign(p.turn) : Math.abs(p.turn) < 0.1 ? 0 : this.turnSide;
    if (side !== this.turnSide) {
      // steering into a new turn plants its inside pole to time the edge change (left turn, left
      // pole); a pole still in the snow from the last one finishes its plant first
      const i = side > 0 ? 0 : 1;
      if (side && grounded && !p.tuck && !p.duck && p.speed > 4 && this.plant[i] > 0.7) this.plant[i] = 0;
      this.turnSide = side;
    }
    // the faster the run, the quicker the touch
    for (let i = 0; i < 2; i++) this.plant[i] = Math.min(1, this.plant[i] + dt / lerp(0.75, 0.5, speedN));
    this.planting = lerp(this.planting, grounded && !p.tuck && !p.duck ? 1 : 0, k(12));
    // crossing from edge to edge the body rises and floats over the skis
    const cross = grounded ? Math.min(0.28, Math.abs(this.leanS.v) * 0.05) : 0;

    let crouchT = 0.25 + speedN * 0.25 + Math.abs(lean) * 0.3;
    if (p.tuck) crouchT = 0.95 + Math.abs(lean) * 0.1;
    if (p.duck) crouchT = 1.15;
    if (p.brake) crouchT = 0.45;
    crouchT = lerp(crouchT, 0.68, this.skating);
    crouchT += (p.absorb ?? 0) - cross;
    if (p.air) crouchT = tricks ? lerp(lerp(0.62, 0.05, pop), 0.35, this.reach) : 0.75;
    crouchT = Math.min(1.2, crouchT + p.squash);
    this.crouch = clamp(this.crouchS.step(crouchT, dt), -0.1, 1.3);
    // momentum: braking and landings throw the upper body forward, accelerating leaves it behind
    // (a skater pushing off keeps the chest forward over the skis)
    const surge = grounded ? clamp(-(p.accel ?? 0) * 0.025, -0.15, 0.3) * (1 - this.skating * 0.8) : 0;
    const pitch = this.pitchS.step(surge + p.squash * 0.35, dt);
    // counter-rotate against the turn on snow; lead the spin in the air
    const twist = this.twistS.step(grounded ? lean * 0.4 : -(p.spin ?? 0) * 0.06, dt);

    this.spread = lerp(this.spread, p.air ? 0.02 : p.brake ? 0.18 : 0.06 + Math.abs(lean) * 0.05, k(8));
    this.air = lerp(this.air, p.air ? 1 : 0, k(8));
    this.seat = lerp(this.seat, p.seated ? 1 : 0, k(6));
    if (this.skating > 0.05) this.skatePhase += dt * lerp(SKATE_RATE_START, SKATE_RATE_RUNNING, smoothstep(p.speed, 0.5, 8));
    this.walk = lerp(this.walk, p.walk ?? 0, k(10));
    this.wave = lerp(this.wave, p.wave ?? 0, k(8));
    if (this.walk > 0.02) this.walkPhase += dt * 10;

    // --- body
    const hipStand = 0.94;
    this.hipY = hipStand - this.crouch * 0.26 + this.fold * 0.06;
    const bob = Math.sin(t * 2.2) * 0.008 * (1 - speedN);
    // skis chatter when they skid, and the snow buzzes through them at speed
    const chatter = grounded ? Math.sin(t * 61) * Math.sin(t * 23.7) * (skid * 0.6 + speedN * speedN * 0.3) : 0;
    // skating, V2 style, ridden like a skater: set the ski down, ride it in a long glide with the
    // whole body over it, sink, then push it out sideways while the weight flows across onto the
    // other ski. Half-cycle `beat` 0 is a ski touching down; the glide leg loads around 0.8 and
    // pushes through to 0.2 of the next beat. Both poles plant as it loads and drive with the push.
    const sk = this.skating;
    const beat = (this.skatePhase / Math.PI) % 1;
    const poleBeat = (beat + 0.25) % 1;
    const crunch = smoothstep(poleBeat, 0, 0.3) * (1 - smoothstep(poleBeat, 0.35, 0.8)) * sk;
    const drive = smoothstep(poleBeat, 0.02, 0.4) - smoothstep(poleBeat, 0.45, 0.95);
    // tall through the glide, lowest as the glide leg loads up for its push
    const sink = (1 - Math.cos(Math.PI * 2 * (beat - 0.3))) * 0.5 * sk;
    // weight settles fully over the right ski for its glide (0..π) and crosses to the left one at π
    const sway = (Math.tanh(1.8 * Math.sin(this.skatePhase)) / Math.tanh(1.8)) * sk;
    const stride = Math.sin(this.walkPhase) * this.walk;
    this.hips.position.set(
      sway * 0.12 - lean * 0.08,
      this.hipY + bob - sink * 0.05 + Math.abs(stride) * 0.025 + chatter * 0.01,
      -this.crouch * 0.08 - pitch * 0.05 - crunch * 0.03,
    );
    this.lean.rotation.z = lean;
    // shoulders ride over the gliding ski and turn gently towards it
    this.torso.rotation.set(
      0.04 + this.crouch * 0.52 + this.duck * 0.4 - this.seat * 0.15 + pitch + this.fold * 0.3 + this.grab * 0.25 + crunch * 0.26 + sink * 0.08 + this.skating * 0.12,
      twist - sway * 0.08,
      sway * 0.07 - lean * 0.45,
    );
    // eyes stay level and ahead; they look into the turn and down at the landing
    this.head.rotation.x = -this.torso.rotation.x * 0.7 + this.reach * 0.25;
    this.head.rotation.y = lerp(this.head.rotation.y, -p.turn * 0.35 + twist * (grounded ? -1 : 0.6) + sway * 0.07, k(5));
    this.head.rotation.z = -lean * 0.25 - sway * 0.06;

    // --- legs
    const tweak = this.style === AIR_SAFETY_L ? -1 : this.style === AIR_SAFETY_R ? 1 : 0;
    for (const leg of this.legs) {
      const s = leg.side;
      const hip = this.tmpH.set(s * HIP_X + this.hips.position.x, this.hips.position.y, this.hips.position.z);
      // skating: set down under the body and glide out on it, then press it out sideways off the
      // inside edge; the spent ski floats just off the snow and swings back in for the next step
      const u = (this.skatePhase / (Math.PI * 2) + (s > 0 ? 0 : 0.5)) % 1;
      const glide = smoothstep(u, 0, 0.4) * (1 - smoothstep(u, 0.6, 0.95));
      const kick = smoothstep(u, 0.38, 0.6) * (1 - smoothstep(u, 0.62, 0.98));
      const lift = Math.sin(Math.PI * clamp((u - 0.6) / 0.37, 0, 1));
      // the inside ski leads a little through the turn
      const inside = Math.max(0, -s * Math.sign(lean)) * Math.min(1, Math.abs(lean) / 0.6);
      const foot = this.tmpF.set(
        lerp(s * (0.13 + this.spread), s * (0.09 + glide * 0.04 + kick * 0.3), sk),
        ANKLE + (kick * 0.02 + lift * 0.06) * sk,
        inside * 0.09 + (lift * 0.03 - kick * 0.1) * sk,
      );
      // Lean the torso while keeping both bindings on the snow plane.
      // The leg solver then bends each knee toward its grounded boot.
      const stanceX = foot.x;
      foot.x *= Math.cos(lean);
      foot.y -= stanceX * Math.sin(lean);
      if (this.seat > 0.01) {
        // dangling from the chair: feet in front and below the hips
        const swing = Math.sin(t * 1.5 + s) * 0.06;
        foot.x = lerp(foot.x, s * 0.14, this.seat);
        foot.y = lerp(foot.y, hip.y - 0.55, this.seat);
        foot.z = lerp(foot.z, hip.z + 0.42 + swing, this.seat);
      }
      if (this.air > 0.01) foot.y += this.air * 0.06 + this.fold * 0.4;
      foot.z += this.fold * 0.06;
      foot.y += chatter * 0.006 * s;
      if (this.walk > 0.01) {
        // alternate steps: one foot swings forward and lifts while the other plants
        foot.z += s * stride * 0.16;
        foot.y += Math.max(0, s * Math.cos(this.walkPhase)) * 0.07 * this.walk;
      }
      this.solveLeg(leg, hip, foot);
      leg.ski.position.set(foot.x, foot.y - ANKLE, foot.z);
      // carving rolls the skis further over than the body; skidding flattens and twists them across
      leg.ski.rotation.set(
        this.seat * -0.3 + this.air * -0.12 - this.fold * 0.1 + chatter * 0.03 - lift * sk * 0.08,
        -s * this.plow * 0.28 + s * sk * (0.17 + kick * 0.06) - Math.sign(lean) * skid * 0.2 * Math.min(1, Math.abs(lean) * 3),
        lerp(0.12, -0.45, skid) * lean + tweak * this.grab * 0.35 + s * kick * sk * 0.32,
      );
    }

    // --- arms + poles
    for (const [arm, pole, i, s] of [
      [this.armL, this.poleL, 0, -1],
      [this.armR, this.poleR, 1, 1],
    ] as const) {
      const outside = Math.max(0, s * lean) / 0.8;
      const inside = Math.max(0, -s * lean) / 0.8;
      // pole plant: the inside hand lifts forward while the wrist swings the tip round, then drives
      // it into the snow ahead of the boot and outside the inside ski at the edge change. The body
      // runs past the planted tip as the new turn leans over, then it lifts and trails again.
      const u = this.plant[i];
      const plants = this.planting * (1 - sk);
      const reach = smoothstep(u, 0, 0.12) * (1 - smoothstep(u, 0.45, 0.8)) * plants;
      // (the pole hands back to its trailing pose only once its path has brought the tip back there)
      const lead = smoothstep(u, 0, 0.08) * (1 - smoothstep(u, 0.88, 1)) * plants;
      // where the tip goes in, in skier space; it slides back under the passing body
      const spot = this.tmpS.set(s * 0.5, 0, lerp(0.5, 0.05, smoothstep(u, 0.15, 0.5)));
      // inside hand reaches forward, outside hand lifts for balance
      let fwd = 0.55 + inside * 0.25 - outside * 0.05 + chatter * 0.04;
      let out = 0.2 + outside * 0.35;
      let bend = 0.4;
      if (reach > 0.001) {
        // the hand rides up the shaft from the spot: up, a little in and back
        const ik = this.reachFor(arm, s, this.tmpT.copy(spot).add(this.tmpU.set(-s * 0.2, 0.8, -0.25).setLength(POLE_LENGTH)));
        fwd = lerp(fwd, ik.x, reach);
        out = lerp(out, ik.y, reach);
        bend = lerp(bend, ik.z, reach);
      }
      if (p.tuck) {
        fwd = 1.15;
        out = 0.05;
      }
      fwd = lerp(fwd, 1.8, this.duck);
      out = lerp(out, -0.12, this.duck);
      // skating: both arms reach forward to plant, press down and back past the hips, then swing through
      fwd = lerp(fwd, lerp(0.85, -0.55, drive), sk);
      out = lerp(out, 0.18 + drive * 0.12, sk);
      // flight: arms swing up off the lip, spread for balance, then forward to meet the landing
      fwd = lerp(fwd, lerp(0.35, 1.25, pop) + Math.sin(t * 2.3 + s) * 0.12 + (this.style === AIR_TUCK ? this.fold * 0.6 : 0), this.air);
      out = lerp(out, 0.75 + this.spinning * 0.5 - (this.style === AIR_TUCK ? this.fold * 0.4 : 0), this.air);
      fwd = lerp(fwd, 0.9, this.reach);
      out = lerp(out, 0.45, this.reach);
      fwd = lerp(fwd, 0.5, this.seat);
      out = lerp(out, 0.15, this.seat);
      fwd -= s * stride * 0.45;
      if (s > 0) {
        fwd = lerp(fwd, 2.7, this.wave);
        out = lerp(out, 0.35 + Math.sin(t * 9) * 0.35, this.wave);
      }
      // hand on the ski
      const grab = this.grab * (this.style === AIR_TRUCK || this.style === (s < 0 ? AIR_SAFETY_L : AIR_SAFETY_R) ? 1 : 0);
      if (grab > 0.01) {
        const aim = this.aim(arm, this.grabTarget(s));
        fwd = lerp(fwd, -aim.x, grab);
        out = lerp(out, s * aim.z, grab);
      }
      // a turn's plant bends the elbow to hold the grip up the shaft; skating bends it to plant and locks it out at the end of the drive
      this.forearms[i].rotation.x = lerp(lerp(-bend, lerp(-0.6, -0.12, drive), sk), -0.1, grab);
      const armRate = k(10 + sk * 6 + reach * 14);
      arm.rotation.x = lerp(arm.rotation.x, -fwd, armRate);
      arm.rotation.z = lerp(arm.rotation.z, s * out, armRate);
      const rest = this.poleRest[i];
      rest.y = lerp(rest.y, -s * out * 0.6, k(10));
      // poles trail behind, roughly parallel to the slope
      let poleX = fwd + 0.75 + (p.tuck ? 0.9 : 0) - this.duck * 0.6 - this.seat * 0.6;
      if (sk > 0.01) {
        // skating: keep the tips on the snow through the drive, then swing them through for the next plant
        const hand = this.tmpV.copy(pole.position);
        for (const part of [this.forearms[i], arm, this.torso, this.hips]) {
          part.updateMatrix();
          hand.applyMatrix4(part.matrix);
        }
        const height = hand.x * Math.sin(lean) + hand.y * Math.cos(lean);
        const planted = Math.acos(clamp(height / (POLE * Math.cos(out * 0.4)), 0, 1));
        const hold = smoothstep(poleBeat, 0, 0.05) * (1 - smoothstep(poleBeat, 0.4, 0.5));
        const swing = Math.max(planted, lerp(0.9, 0.2, smoothstep(poleBeat, 0.5, 0.95)));
        const chain = this.torso.rotation.x + arm.rotation.x + this.forearms[i].rotation.x;
        poleX = lerp(poleX, lerp(swing, planted, hold) - chain, sk);
      }
      rest.x = lerp(rest.x, poleX, k(10 + sk * 30));
      pole.rotation.set(rest.x, 0, rest.y);
      if (lead > 0.001) {
        // the tip swings round the outside from behind the hand to the spot, touches down, and lifts
        // to trail again once the body has run past (bearing from straight ahead, toward the outside)
        const grip = this.gripAt(i);
        const toSpot = Math.atan2(s * (spot.x - grip.x), spot.z - grip.z);
        const bearing = u < 0.15 ? lerp(2.9, toSpot, smoothstep(u, 0.01, 0.15)) : lerp(toSpot, 2.9, smoothstep(u, 0.45, 0.8));
        const lift = 0.06 * (1 - smoothstep(u, 0.1, 0.15)) + 0.14 * smoothstep(u, 0.45, 0.6) - 0.05 * smoothstep(u, 0.7, 0.95);
        const aim = this.poleAim(i, s * Math.sin(bearing), Math.cos(bearing), lift);
        // (the short way round from the trailing pitch)
        pole.rotation.set(lerp(rest.x, rest.x + Math.atan2(Math.sin(aim.x - rest.x), Math.cos(aim.x - rest.x)), lead), 0, lerp(rest.y, aim.y, lead));
      }
      // a low inside hand carries its tip just clear of the snow instead of through it
      // (a planted or swinging tip is already on its own path)
      if (grounded && sk < 0.5 && (lead < 0.5 || u > 0.7)) pole.rotation.x = Math.max(pole.rotation.x, this.poleToSnow(i, 0.08));
    }
  }

  /** Skier-space grip of a pole; leaves the forearm-to-skier transform in `tmpM`. */
  private gripAt(i: number) {
    const m = this.tmpM.identity();
    for (const part of [this.lean, this.hips, this.torso, i ? this.armR : this.armL, this.forearms[i]]) {
      part.updateMatrix();
      m.multiply(part.matrix);
    }
    return this.tmpV.copy((i ? this.poleR : this.poleL).position).applyMatrix4(m);
  }

  /**
   * Shoulder swing forward (x), out (y) and elbow bend (z) that put the grip on a skier-space point,
   * or as near as the arm reaches.
   */
  private reachFor(arm: THREE.Group, s: number, target: THREE.Vector3) {
    this.lean.updateMatrix();
    this.hips.updateMatrix();
    this.torso.updateMatrix();
    this.tmpM.multiplyMatrices(this.lean.matrix, this.hips.matrix).multiply(this.torso.matrix).invert();
    const d = target.applyMatrix4(this.tmpM).sub(arm.position);
    const a = UPPER_ARM, b = GRIP;
    const len = THREE.MathUtils.clamp(d.length(), Math.abs(a - b) + 0.02, a + b - 0.001);
    const bend = Math.acos(THREE.MathUtils.clamp((len * len - a * a - b * b) / (2 * a * b), -1, 1));
    // the bent arm in its own frame hangs down to (0, y, z); roll it out, then swing it forward onto the target
    const y = -(a + b * Math.cos(bend)), z = b * Math.sin(bend);
    const roll = Math.asin(THREE.MathUtils.clamp(d.x / -y, -1, 1));
    const swing = Math.atan2(d.z, d.y) - Math.atan2(z, y * Math.cos(roll));
    return this.tmpAim3.set(-Math.atan2(Math.sin(swing), Math.cos(swing)), s * roll, bend);
  }

  /**
   * Forearm-space pole pitch (x) and roll (y) that put the tip `lift` above the snow, out from the hand
   * along the skier-space heading (`x`, `z`).
   */
  private poleAim(i: number, x: number, z: number, lift: number) {
    const grip = this.gripAt(i);
    const m = this.tmpM;
    // the shaft reaches this far across the snow (a hand too high just lets it hang); swing it that way
    const drop = Math.min(grip.y - lift, POLE_LENGTH * 0.995);
    const span = Math.sqrt(POLE_LENGTH * POLE_LENGTH - drop * drop);
    const d = this.tmpB.set(x * span, -drop, z * span).transformDirection(m.invert());
    // the shaft hangs along −y, rolled by z then pitched by x
    return this.tmpAim.set(Math.atan2(-d.z, -d.y), Math.asin(THREE.MathUtils.clamp(d.x, -1, 1)));
  }

  /** Forearm-space pole pitch that puts the tip `clear` above the snow behind the hand; −∞ when it can't reach. */
  private poleToSnow(i: number, clear: number) {
    const arm = i ? this.armR : this.armL;
    const pole = i ? this.poleR : this.poleL;
    const m = this.tmpM.identity();
    for (const part of [this.lean, this.hips, this.torso, arm, this.forearms[i]]) {
      part.updateMatrix();
      m.multiply(part.matrix);
    }
    // only the height above the snow matters: row y of the forearm-to-skier transform
    const e = m.elements;
    const grip = pole.position;
    const height = e[1] * grip.x + e[5] * grip.y + e[9] * grip.z + e[13];
    // the shaft hangs along −y, rolled out by z then pitched by x: solve tip height = clear for x
    const c = pole.rotation.z;
    const r = Math.hypot(e[5], e[9]);
    const q = (e[1] * Math.sin(c) + (height - clear) / POLE_LENGTH) / (Math.cos(c) * r);
    return q < 1 ? Math.atan2(e[9], e[5]) + Math.acos(Math.max(-1, q)) : -Infinity;
  }
}
