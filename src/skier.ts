import * as THREE from "three";
import { damp, lerp } from "./noise";
import { CHARACTERS, type Character } from "./characters";
import { box, gearMesh, shellGeometry } from "./gear";
import { makeBoot, makeSki } from "./equipment";

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
}

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

/** A curved, single-piece goggle lens; +z is the covered face. */
function visorGeometry(radius: number, height: number) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i <= 12; i++) {
      const angle = (i / 12 - 0.5) * 2.15;
      positions.push(Math.sin(angle) * radius, (row - 0.5) * height, Math.cos(angle) * radius);
      uv.push(i / 12, row);
      if (!row && i < 12) indices.push(i, i + 1, i + 13, i + 1, i + 14, i + 13);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function lensMaterial(color: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 16, 64);
  const tint = new THREE.Color(color);
  gradient.addColorStop(0, `#${tint.clone().multiplyScalar(0.35).getHexString()}`);
  gradient.addColorStop(0.4, `#${tint.getHexString()}`);
  gradient.addColorStop(0.54, "#c8d8df");
  gradient.addColorStop(0.59, `#${tint.clone().multiplyScalar(0.65).getHexString()}`);
  gradient.addColorStop(1, `#${tint.clone().multiplyScalar(0.3).getHexString()}`);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "rgba(245,250,255,0.55)";
  ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(34, 0); ctx.lineTo(69, 64); ctx.lineTo(63, 64); ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, metalness: 0.48, roughness: 0.17, side: THREE.DoubleSide });
}

/** Human proportions, articulated outerwear and fully covered faces. Origin between the feet. */
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

  private crouch = 0;
  private leanAngle = 0;
  private hipY = 0.94;
  private time = 0;
  private polePhase = 0;
  private skatePhase = 0;
  private spread = 0;
  private plow = 0;
  private air = 0;
  private seat = 0;
  private flail = 0;
  private walk = 0;
  private walkPhase = 0;
  private wave = 0;

  constructor(readonly character: Character = CHARACTERS[0]) {
    const c = character;
    const female = c.gender === "female";
    const baggy = c.outfit === "park";
    const shoulder = female ? 0.405 : baggy ? 0.50 : 0.46;
    const waist = female ? 0.31 : baggy ? 0.43 : 0.37;
    const depth = baggy ? 0.275 : 0.235;
    this.root.name = `skier-${c.id}`;
    this.root.scale.setScalar(c.height);
    this.root.add(this.lean);
    this.lean.add(this.hips);
    this.hips.add(this.torso);

    for (const side of [-1, 1]) {
      const radius = baggy ? 0.102 : female ? 0.078 : 0.088;
      const thigh = gearMesh(new THREE.CylinderGeometry(radius, radius * 0.92, THIGH, 8), c.pants);
      const shin = gearMesh(new THREE.CylinderGeometry(radius * 0.92, 0.074, SHIN, 8), c.pants);
      const knee = gearMesh(new THREE.SphereGeometry(radius * 0.94, 8, 6), c.pants);
      this.lean.add(thigh, shin, knee);
      // Reinforced knees, ankle gaiters, and cargo pockets follow the articulated legs.
      box(shin, c.panel, [0.105, 0.105, 0.023], [0, -0.12, 0.065]);
      if (c.outfit === "freeride" || baggy) {
        box(thigh, c.pants, [0.04, 0.13, 0.115], [side * radius, 0.015, 0]);
        box(thigh, c.panel, [0.044, 0.015, 0.12], [side * radius, 0.075, 0]);
      } else {
        box(thigh, c.panel, [0.024, 0.24, 0.03], [side * radius * 0.8, 0, 0.054]);
      }
      const ski = new THREE.Group();
      const board = makeSki(c.skis, c.accent, c.outfit);
      ski.add(board, makeBoot(c.outfit === "race" ? c.panel : DARK));
      this.lean.add(ski);
      this.legs.push({ side, thigh, shin, knee, ski, board });
    }

    const body = gearMesh(shellGeometry([
      { y: -0.07, width: waist + 0.06, depth },
      { y: 0.13, width: waist, depth: depth * 0.91 },
      { y: 0.36, width: shoulder, depth },
      { y: 0.47, width: shoulder * 0.96, depth: depth * 0.9 },
      { y: 0.53, width: 0.19, depth: 0.17 },
    ]), c.jacket);
    this.torso.add(body);
    // A dark hem, technical zips, and contrasting yokes read from the follow camera too.
    box(this.torso, c.panel, [waist * 0.74, 0.038, depth + 0.006], [0, -0.047, 0]);
    box(this.torso, c.panel, [shoulder * 0.68, 0.075, 0.018], [0, 0.40, -depth / 2]);
    const zipHeight = baggy ? 0.18 : 0.42;
    box(this.torso, DARK, [0.012, zipHeight, 0.014], [0, 0.49 - zipHeight / 2, depth / 2 + 0.004]);
    box(this.torso, c.accent, [0.024, 0.035, 0.018], [0.007, 0.38, depth / 2 + 0.015], "plastic");
    for (const side of [-1, 1]) {
      const pocket = box(this.torso, c.panel, [0.008, 0.13, 0.013], [side * waist * 0.29, 0.15, depth / 2]);
      pocket.rotation.z = -side * 0.26;
    }
    // Covered collar overlaps the balaclava: there is no neck or face skin.
    const collar = gearMesh(new THREE.CylinderGeometry(0.108, 0.119, 0.15, 10), c.panel);
    collar.position.set(0, 0.545, 0); this.torso.add(collar);
    box(this.torso, c.accent, [0.053, 0.022, 0.016], [-0.115, 0.37, depth / 2 + 0.009]);

    if (c.outfit === "race") {
      for (const side of [-1, 1]) {
        box(this.torso, c.panel, [0.047, 0.26, 0.016], [side * 0.13, 0.29, depth / 2 + 0.004]);
        box(this.torso, c.panel, [0.04, 0.29, 0.016], [side * 0.11, 0.27, -depth / 2 - 0.004]);
      }
      box(this.torso, DARK, [0.235, 0.043, depth + 0.012], [0, 0.09, 0]);
      box(this.torso, 0xa1a8ae, [0.036, 0.032, 0.016], [0, 0.09, depth / 2 + 0.014], "metal");
    } else if (baggy) {
      box(this.torso, c.panel, [0.28, 0.12, 0.035], [0, 0.17, depth / 2]);
      box(this.torso, c.accent, [0.26, 0.012, 0.014], [0, 0.231, depth / 2 + 0.02]);
      box(this.torso, c.accent, [0.10, 0.018, 0.016], [0, 0.37, -depth / 2 - 0.01]);
    } else {
      this.addPack(c, depth);
    }
    // Packed hood behind the helmet, rather than a dangling decorative scarf.
    const hood = gearMesh(new THREE.TorusGeometry(0.108, 0.04, 5, 10, Math.PI), c.jacket);
    hood.rotation.x = -0.45; hood.position.set(0, 0.52, -0.06); this.torso.add(hood);

    this.head.position.y = 0.66;
    this.torso.add(this.head);
    this.addHead(c);
    this.addArm(this.armL, this.poleL, -1, c, shoulder);
    this.addArm(this.armR, this.poleR, 1, c, shoulder);
  }

  private addPack(c: Character, depth: number) {
    const alpine = c.outfit === "alpine";
    const pack = gearMesh(shellGeometry([
      { y: 0.035, width: 0.21, depth: 0.095 },
      { y: 0.25, width: alpine ? 0.27 : 0.25, depth: 0.145 },
      { y: 0.43, width: 0.22, depth: 0.11 },
    ]), alpine ? c.accent : c.panel);
    pack.position.z = -depth / 2 - 0.065;
    this.torso.add(pack);
    box(this.torso, DARK, [0.012, 0.29, 0.012], [0, 0.245, -depth / 2 - 0.14]);
    for (const side of [-1, 1]) {
      const strap = box(this.torso, DARK, [0.029, 0.32, 0.017], [side * 0.13, 0.31, depth / 2 + 0.014]);
      strap.rotation.z = -side * 0.14;
      box(this.torso, c.accent, [0.021, 0.047, 0.014], [side * 0.11, 0.25, depth / 2 + 0.028], "plastic");
    }
    box(this.torso, DARK, [0.23, 0.018, 0.017], [0, 0.32, depth / 2 + 0.028]);
    box(this.torso, c.accent, [0.085, 0.024, 0.012], [0, 0.34, -depth / 2 - 0.14]);
  }

  private addHead(c: Character) {
    const mask = gearMesh(new THREE.SphereGeometry(0.137, 12, 8), DARK);
    mask.scale.set(1, 1.15, 0.94); this.head.add(mask);
    const helmet = gearMesh(new THREE.SphereGeometry(0.158, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.56), c.helmet, "plastic");
    helmet.position.y = 0.025; helmet.scale.z = 1.06;
    this.head.add(helmet);
    for (const side of [-1, 1]) {
      const ear = gearMesh(new THREE.SphereGeometry(0.063, 8, 6), c.helmet, "rubber");
      ear.scale.set(0.45, 1, 0.8); ear.position.set(side * 0.14, -0.018, -0.012); this.head.add(ear);
      for (let i = 0; i < 2; i++) {
        const vent = box(this.head, DARK, [0.022, 0.008, 0.055], [side * (0.047 + i * 0.032), 0.172 - i * 0.018, -0.015], "rubber");
        vent.rotation.z = -side * 0.35;
      }
      box(this.head, c.accent, [0.009, 0.018, 0.062], [side * 0.159, 0.048, -0.022], "plastic");
    }
    // Balaclava nose panel and chin seam are fabric, never exposed skin.
    const nose = gearMesh(new THREE.ConeGeometry(0.035, 0.051, 4), DARK);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.033, 0.134); this.head.add(nose);
    box(this.head, 0x39414a, [0.055, 0.005, 0.011], [0, -0.088, 0.107]);
    const strap = gearMesh(new THREE.TorusGeometry(0.15, 0.013, 4, 16), c.panel, "rubber");
    strap.rotation.x = Math.PI / 2; strap.position.y = 0.035; this.head.add(strap);
    const frame = gearMesh(visorGeometry(0.168, 0.099), DARK, "rubber");
    frame.position.set(0, 0.032, 0.005); this.head.add(frame);
    const lens = new THREE.Mesh(visorGeometry(0.173, 0.077), lensMaterial(c.lens));
    lens.position.set(0, 0.035, 0.008); this.head.add(lens);
    this.ownedMaterials.push(lens.material);
    if (c.outfit === "race") {
      const stripe = box(this.head, c.panel, [0.025, 0.009, 0.12], [0, 0.18, -0.01], "plastic");
      stripe.rotation.x = 0.10;
    } else if (c.outfit === "alpine") {
      box(this.head, c.panel, [0.063, 0.036, 0.018], [0, 0.10, 0.148], "plastic");
    }
  }

  private addArm(arm: THREE.Group, pole: THREE.Group, side: number, c: Character, shoulder: number) {
    arm.position.set(side * shoulder / 2, 0.43, 0);
    const sleeve = gearMesh(new THREE.CylinderGeometry(0.074, 0.062, 0.28, 8), c.jacket);
    sleeve.position.y = -0.12; arm.add(sleeve);
    const elbow = gearMesh(new THREE.SphereGeometry(0.064, 8, 6), c.panel);
    elbow.position.y = -0.25; arm.add(elbow);
    const forearm = new THREE.Group();
    forearm.position.y = -0.25; forearm.rotation.x = -0.4;
    arm.add(forearm);
    const lower = gearMesh(new THREE.CylinderGeometry(0.061, 0.045, 0.235, 8), c.jacket);
    lower.position.y = -0.105; forearm.add(lower);
    box(forearm, c.panel, [0.086, 0.045, 0.10], [0, -0.215, 0]);
    box(forearm, c.accent, [0.055, 0.009, 0.012], [0, -0.209, 0.051], "plastic");
    const glove = gearMesh(new THREE.SphereGeometry(0.053, 8, 6), DARK, "rubber");
    glove.scale.set(0.9, 1.25, 0.8); glove.position.set(0, -0.266, 0.012); forearm.add(glove);
    const thumb = gearMesh(new THREE.SphereGeometry(0.025, 6, 4), DARK, "rubber");
    thumb.position.set(-side * 0.037, -0.258, 0.032); forearm.add(thumb);
    box(arm, c.panel, [0.015, 0.12, 0.11], [side * 0.074, -0.12, 0]);
    pole.position.set(0, -0.267, 0.023);
    const shaft = gearMesh(new THREE.CylinderGeometry(0.007, 0.005, 0.99, 6), 0x899398, "metal");
    shaft.position.y = -0.47; pole.add(shaft);
    const grip = gearMesh(new THREE.CylinderGeometry(0.019, 0.017, 0.105, 6), DARK, "rubber");
    pole.add(grip);
    const basket = gearMesh(new THREE.CylinderGeometry(0.032, 0.034, 0.009, 8), DARK, "plastic");
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
    this.walk = lerp(this.walk, p.walk ?? 0, k(10));
    this.wave = lerp(this.wave, p.wave ?? 0, k(8));
    if (this.walk > 0.02) this.walkPhase += dt * 10;

    // --- body
    const hipStand = 0.94;
    this.hipY = hipStand - this.crouch * 0.26;
    const bob = Math.sin(t * 2.2) * 0.008 * (1 - speedN);
    const skate = Math.sin(this.skatePhase) * p.skate;
    const stride = Math.sin(this.walkPhase) * this.walk;
    this.hips.position.set(skate * 0.06, this.hipY + bob + Math.abs(skate) * 0.03 + Math.abs(stride) * 0.025, -this.crouch * 0.08);
    this.lean.rotation.z = this.leanAngle;
    this.torso.rotation.x = 0.04 + this.crouch * 0.52 - this.seat * 0.15;
    this.torso.rotation.z = skate * 0.1;
    this.head.rotation.x = -this.torso.rotation.x * 0.7;
    this.head.rotation.y = lerp(this.head.rotation.y, -p.turn * 0.35, k(5));

    // --- legs
    for (const leg of this.legs) {
      const s = leg.side;
      const hip = this.tmpH.set(s * 0.12 + this.hips.position.x, this.hips.position.y, this.hips.position.z);
      const legSkate = Math.max(0, s * skate);
      const foot = this.tmpF.set(s * (0.13 + this.spread + legSkate * 0.12), 0.25 + legSkate * 0.06, 0);
      // Lean the torso while keeping both bindings on the snow plane.
      // The leg solver then bends each knee toward its grounded boot.
      const stanceX = foot.x;
      foot.x *= Math.cos(this.leanAngle);
      foot.y -= stanceX * Math.sin(this.leanAngle);
      if (this.seat > 0.01) {
        // dangling from the chair: feet in front and below the hips
        const swing = Math.sin(t * 1.5 + s) * 0.06;
        foot.x = lerp(foot.x, s * 0.14, this.seat);
        foot.y = lerp(foot.y, hip.y - 0.55, this.seat);
        foot.z = lerp(foot.z, hip.z + 0.42 + swing, this.seat);
      }
      if (this.air > 0.01) foot.y += this.air * 0.08;
      if (this.walk > 0.01) {
        // alternate steps: one foot swings forward and lifts while the other plants
        foot.z += s * stride * 0.16;
        foot.y += Math.max(0, s * Math.cos(this.walkPhase)) * 0.07 * this.walk;
      }
      this.solveLeg(leg, hip, foot);
      leg.ski.position.set(foot.x, foot.y - 0.25, foot.z);
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
      fwd -= s * stride * 0.45;
      if (s > 0) {
        fwd = lerp(fwd, 2.7, this.wave);
        out = lerp(out, 0.35 + Math.sin(t * 9) * 0.35, this.wave);
      }
      arm.rotation.x = lerp(arm.rotation.x, -fwd, k(10));
      arm.rotation.z = lerp(arm.rotation.z, s * out, k(10));
      // poles trail behind, roughly parallel to the slope
      pole.rotation.x = lerp(pole.rotation.x, fwd + 0.75 - plant * 0.7 + (p.tuck ? 0.9 : 0) - this.seat * 0.6, k(10));
      pole.rotation.z = lerp(pole.rotation.z, -s * out * 0.6, k(10));
    }
  }
}
