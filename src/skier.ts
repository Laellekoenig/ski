import * as THREE from "three";
import { damp, lerp } from "./noise";
import { CHARACTERS, type Character } from "./characters";
import { gearMesh, limbGeometry, loftGeometry } from "./gear";
import { makeBoot, makeSki } from "./equipment";
import { dressHead, dressNeck, jacketMaterial, pantsMaterial } from "./looks";

export { makeSki } from "./equipment";

const DARK = 0x181d23;
const THIGH = 0.39;
const SHIN = 0.38;
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
  crashed: boolean;
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
  private edgeSide = 0;
  /** Pole plant progress per side, 0..1 (1 = idle). */
  private plant = [1, 1];
  private hipY = 0.94;
  private time = 0;
  private skatePhase = 0;
  private spread = 0;
  private plow = 0;
  private duck = 0;
  private air = 0;
  private seat = 0;
  private flail = 0;
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
    const puffy = c.print === "quilted";
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
    arm.position.set(side * (shoulder / 2 - r * 0.45), 0.42, 0);
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
    const shaft = gearMesh(new THREE.CylinderGeometry(0.007, 0.005, 0.99, 6), 0x899398, "metal");
    shaft.position.y = -0.47; pole.add(shaft);
    const grip = gearMesh(new THREE.CylinderGeometry(0.019, 0.017, 0.105, 8), DARK, "rubber");
    pole.add(grip);
    const basket = gearMesh(new THREE.CylinderGeometry(0.032, 0.034, 0.009, 8), c.accent, "plastic");
    basket.position.y = -0.9; pole.add(basket);
    const loop = gearMesh(new THREE.TorusGeometry(0.026, 0.005, 4, 8), DARK, "rubber");
    loop.position.set(side * 0.018, 0.015, 0); pole.add(loop);
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
  private tmpM = new THREE.Matrix4();

  private solveLeg(leg: Leg, hip: THREE.Vector3, foot: THREE.Vector3) {
    const vz = foot.z - hip.z;
    const vy = foot.y - hip.y;
    const d = Math.min(Math.hypot(vz, vy), THIGH + SHIN - 0.001);
    const phiV = Math.atan2(vz, -vy);
    const alpha = Math.acos(THREE.MathUtils.clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    const phiT = phiV + alpha;
    this.tmpK.set(lerp(hip.x, foot.x, 0.5), hip.y - Math.cos(phiT) * THIGH, hip.z + Math.sin(phiT) * THIGH);
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
    const grounded = !p.air && !p.seated && !p.crashed;
    const skid = grounded ? p.skid ?? 0 : 0;

    // --- flight: pop off the lip, fold the knees up (maybe grab), then reach for the snow
    const flying = p.air && !p.crashed;
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
    const edgeT = grounded ? (p.edge ?? p.turn * (0.15 + speedN * 0.4)) * (1 - this.plow * 0.6) : 0;
    const lean = this.leanS.step(edgeT, dt);
    const side = Math.abs(edgeT) > 0.14 ? Math.sign(edgeT) : Math.abs(edgeT) < 0.05 ? 0 : this.edgeSide;
    if (side !== this.edgeSide) {
      // plant the new inside pole to time the edge change
      if (side && grounded && !p.tuck && p.speed > 4) this.plant[side > 0 ? 0 : 1] = 0;
      this.edgeSide = side;
    }
    for (let i = 0; i < 2; i++) this.plant[i] = Math.min(1, this.plant[i] + dt / 0.55);
    // crossing from edge to edge the body rises and floats over the skis
    const cross = grounded ? Math.min(0.28, Math.abs(this.leanS.v) * 0.05) : 0;

    let crouchT = 0.25 + speedN * 0.25 + Math.abs(lean) * 0.3;
    if (p.tuck) crouchT = 0.95 + Math.abs(lean) * 0.1;
    if (p.duck) crouchT = 1.15;
    if (p.brake) crouchT = 0.45;
    crouchT += (p.absorb ?? 0) - cross;
    if (p.air) crouchT = tricks ? lerp(lerp(0.62, 0.05, pop), 0.35, this.reach) : 0.75;
    crouchT = Math.min(1.2, crouchT + p.squash);
    this.crouch = clamp(this.crouchS.step(crouchT, dt), -0.1, 1.3);
    // momentum: braking and landings throw the upper body forward, accelerating leaves it behind
    const surge = grounded ? clamp(-(p.accel ?? 0) * 0.025, -0.15, 0.3) : 0;
    const pitch = this.pitchS.step(surge + p.squash * 0.35, dt);
    // counter-rotate against the turn on snow; lead the spin in the air
    const twist = this.twistS.step(grounded ? lean * 0.4 : -(p.spin ?? 0) * 0.06, dt);

    this.spread = lerp(this.spread, p.air ? 0.02 : p.brake ? 0.18 : 0.06 + Math.abs(lean) * 0.05, k(8));
    this.air = lerp(this.air, p.air ? 1 : 0, k(8));
    this.seat = lerp(this.seat, p.seated ? 1 : 0, k(6));
    this.flail = lerp(this.flail, p.crashed ? 1 : 0, k(10));
    if (p.skate > 0.05) this.skatePhase += dt * 6;
    this.walk = lerp(this.walk, p.walk ?? 0, k(10));
    this.wave = lerp(this.wave, p.wave ?? 0, k(8));
    if (this.walk > 0.02) this.walkPhase += dt * 10;

    // --- body
    const hipStand = 0.94;
    this.hipY = hipStand - this.crouch * 0.26 + this.fold * 0.06;
    const bob = Math.sin(t * 2.2) * 0.008 * (1 - speedN);
    // skis chatter when they skid, and the snow buzzes through them at speed
    const chatter = grounded ? Math.sin(t * 61) * Math.sin(t * 23.7) * (skid * 0.6 + speedN * speedN * 0.3) : 0;
    const skate = Math.sin(this.skatePhase) * p.skate;
    const stride = Math.sin(this.walkPhase) * this.walk;
    this.hips.position.set(
      skate * 0.06 - lean * 0.08,
      this.hipY + bob + Math.abs(skate) * 0.03 + Math.abs(stride) * 0.025 + chatter * 0.01,
      -this.crouch * 0.08 - pitch * 0.05,
    );
    this.lean.rotation.z = lean;
    this.torso.rotation.set(
      0.04 + this.crouch * 0.52 + this.duck * 0.4 - this.seat * 0.15 + pitch + this.fold * 0.3 + this.grab * 0.25,
      twist,
      skate * 0.1 - lean * 0.45,
    );
    // eyes stay level and ahead; they look into the turn and down at the landing
    this.head.rotation.x = -this.torso.rotation.x * 0.7 + this.reach * 0.25;
    this.head.rotation.y = lerp(this.head.rotation.y, -p.turn * 0.35 + twist * (grounded ? -1 : 0.6), k(5));
    this.head.rotation.z = -lean * 0.25;

    // --- legs
    const tweak = this.style === AIR_SAFETY_L ? -1 : this.style === AIR_SAFETY_R ? 1 : 0;
    for (const leg of this.legs) {
      const s = leg.side;
      const hip = this.tmpH.set(s * 0.12 + this.hips.position.x, this.hips.position.y, this.hips.position.z);
      const legSkate = Math.max(0, s * skate);
      // the inside ski leads a little through the turn
      const inside = Math.max(0, -s * Math.sign(lean)) * Math.min(1, Math.abs(lean) / 0.6);
      const foot = this.tmpF.set(s * (0.13 + this.spread + legSkate * 0.12), 0.25 + legSkate * 0.06, inside * 0.09);
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
      leg.ski.position.set(foot.x, foot.y - 0.25, foot.z);
      // carving rolls the skis further over than the body; skidding flattens and twists them across
      leg.ski.rotation.set(
        this.seat * -0.3 + this.air * -0.12 - this.fold * 0.1 + chatter * 0.03,
        -s * this.plow * 0.28 + s * legSkate * 0.35 - Math.sign(lean) * skid * 0.2 * Math.min(1, Math.abs(lean) * 3),
        lerp(0.12, -0.45, skid) * lean + tweak * this.grab * 0.35,
      );
    }

    // --- arms + poles
    for (const [arm, pole, i, s] of [
      [this.armL, this.poleL, 0, -1],
      [this.armR, this.poleR, 1, 1],
    ] as const) {
      const outside = Math.max(0, s * lean) / 0.8;
      const inside = Math.max(0, -s * lean) / 0.8;
      const u = this.plant[i];
      const plant = u < 0.3 ? smoothstep(u, 0, 0.3) : 1 - smoothstep(u, 0.3, 1);
      // inside hand reaches forward, outside hand lifts for balance
      let fwd = 0.55 + plant * 0.4 + inside * 0.25 - outside * 0.05 + chatter * 0.04;
      let out = 0.2 + outside * 0.35;
      if (p.tuck) {
        fwd = 1.15;
        out = 0.05;
      }
      fwd = lerp(fwd, 1.8, this.duck);
      out = lerp(out, -0.12, this.duck);
      if (p.skate > 0.05) fwd = 0.6 + Math.sin(this.skatePhase + (s > 0 ? 0 : Math.PI)) * 0.6;
      // flight: arms swing up off the lip, spread for balance, then forward to meet the landing
      fwd = lerp(fwd, lerp(0.35, 1.25, pop) + Math.sin(t * 2.3 + s) * 0.12 + (this.style === AIR_TUCK ? this.fold * 0.6 : 0), this.air);
      out = lerp(out, 0.75 + this.spinning * 0.5 - (this.style === AIR_TUCK ? this.fold * 0.4 : 0), this.air);
      fwd = lerp(fwd, 0.9, this.reach);
      out = lerp(out, 0.45, this.reach);
      fwd = lerp(fwd, 0.5, this.seat);
      out = lerp(out, 0.15, this.seat);
      fwd = lerp(fwd, 2.6 + Math.sin(t * 18 + s) * 0.8, this.flail);
      out = lerp(out, 1.3, this.flail);
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
      this.forearms[i].rotation.x = lerp(-0.4, -0.1, grab);
      arm.rotation.x = lerp(arm.rotation.x, -fwd, k(10));
      arm.rotation.z = lerp(arm.rotation.z, s * out, k(10));
      // poles trail behind, roughly parallel to the slope; a plant swings the tip forward into the snow
      pole.rotation.x = lerp(pole.rotation.x, fwd + 0.75 - plant * 0.9 + (p.tuck ? 0.9 : 0) - this.duck * 0.6 - this.seat * 0.6, k(10));
      pole.rotation.z = lerp(pole.rotation.z, -s * out * 0.6, k(10));
    }
  }
}
