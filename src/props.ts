import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createNoise2D } from "./noise";

const wobbleNoise = createNoise2D(91);

/**
 * Displace vertices with smooth position-based noise so primitives look hand-sculpted.
 * The offset depends only on position, so split vertices (box edges, seams) stay welded.
 */
export function wobble(geo: THREE.BufferGeometry, amount: number, freq = 1.3, seed = 0) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * freq + seed;
    const y = pos.getY(i) * freq;
    const z = pos.getZ(i) * freq - seed;
    const ox = wobbleNoise(y + 3.1, z - 7.7);
    const oy = wobbleNoise(z + 5.3, x + 1.9);
    const oz = wobbleNoise(x - 2.6, y + 9.4);
    pos.setXYZ(i, pos.getX(i) + ox * amount, pos.getY(i) + oy * amount, pos.getZ(i) + oz * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

export interface PartOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
  wobble?: number;
}

/** Collects coloured primitives and merges them into a single vertex-coloured geometry. */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, o: PartOpts = {}) {
    let g = geo;
    if (o.wobble) wobble(g, o.wobble, 1.3, this.parts.length * 3.7);
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute("uv")) {
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    }
    const s = o.scale ?? 1;
    const sc = typeof s === "number" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
    this.e.set(...(o.rot ?? [0, 0, 0]));
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(...(o.pos ?? [0, 0, 0])), this.q, sc);
    g.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
    }
    this.parts.push(g);
    return this;
  }

  /** Tint vertices whose normal points up (snow on top of things). */
  snowCap(threshold = 0.55, color: THREE.ColorRepresentation = 0xf6f9ff) {
    const g = this.parts[this.parts.length - 1];
    const nor = g.getAttribute("normal");
    const col = g.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    for (let i = 0; i < nor.count; i++) if (nor.getY(i) > threshold) col.setXYZ(i, c.r, c.g, c.b);
    return this;
  }

  build() {
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    return g;
  }
}

const GREEN = 0x2f7a4e;
const GREEN_DARK = 0x245f3f;
const TRUNK = 0x7a4b30;
const SNOW = 0xf4f8ff;
const WOOD = 0x9a5f3c;
const WOOD_DARK = 0x6e4129;
const STONE = 0xc9c3bb;
const WINDOW = new THREE.Color(1.8, 1.25, 0.55);

export function pineGeometry(snowy: boolean) {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.22, 0.32, 1.6, 6, 1, true), TRUNK, { pos: [0, 0.8, 0] });
  const tiers = [
    { y: 1.2, r: 2.3, h: 2.6 },
    { y: 2.6, r: 1.8, h: 2.3 },
    { y: 3.9, r: 1.3, h: 2.0 },
    { y: 5.0, r: 0.8, h: 1.6 },
  ];
  tiers.forEach((t, i) => {
    b.add(new THREE.ConeGeometry(t.r, t.h, 8, 1), i % 2 ? GREEN_DARK : GREEN, { pos: [0, t.y + t.h / 2, 0], wobble: 0.12 });
    if (snowy || i === tiers.length - 1) {
      b.add(new THREE.ConeGeometry(t.r * 0.78, t.h * 0.45, 8, 1, true), SNOW, {
        pos: [0.05, t.y + t.h * 0.72, 0.03],
        wobble: 0.08,
      });
    }
  });
  return b.build();
}

export function rockGeometry(seed: number) {
  const b = new GeoBuilder();
  const g = new THREE.IcosahedronGeometry(1, 2);
  wobble(g, 0.35, 0.9, seed);
  b.add(g, 0x7d7680, { scale: [1.3, 0.8, 1.1] }).snowCap(0.6);
  return b.build();
}

/** Piste marker pole, coloured top part via instance colour. Origin at ground. */
export function markerGeometry() {
  const g = new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6);
  g.translate(0, 0.9, 0);
  return g;
}

function addWindow(b: GeoBuilder, x: number, y: number, z: number, ry: number) {
  b.add(new THREE.BoxGeometry(0.8, 0.9, 0.12), WINDOW, { pos: [x, y, z], rot: [0, ry, 0] });
  // shutters
  const off = 0.62;
  const dx = Math.cos(ry) * off;
  const dz = -Math.sin(ry) * off;
  b.add(new THREE.BoxGeometry(0.42, 1.0, 0.1), 0xc23b33, { pos: [x + dx, y, z + dz], rot: [0, ry, 0] });
  b.add(new THREE.BoxGeometry(0.42, 1.0, 0.1), 0xc23b33, { pos: [x - dx, y, z - dz], rot: [0, ry, 0] });
}

/** A cute Swiss chalet. Origin at ground centre, ridge along z. */
export function chaletGeometry() {
  const b = new GeoBuilder();
  const W = 6;
  const D = 7;
  b.add(new THREE.BoxGeometry(W, 1.4, D), STONE, { pos: [0, 0.7, 0], wobble: 0.05 });
  b.add(new THREE.BoxGeometry(W - 0.2, 2.6, D - 0.2), WOOD, { pos: [0, 2.7, 0], wobble: 0.04 });
  // gable triangles
  const gable = new THREE.Shape();
  gable.moveTo(-W / 2 + 0.1, 0);
  gable.lineTo(W / 2 - 0.1, 0);
  gable.lineTo(0, 2.1);
  gable.closePath();
  const gg = new THREE.ExtrudeGeometry(gable, { depth: D - 0.2, bevelEnabled: false });
  gg.translate(0, 0, -(D - 0.2) / 2);
  b.add(gg, WOOD_DARK, { pos: [0, 4.0, 0] });
  // roof slabs
  const slope = Math.atan2(2.1, W / 2);
  const len = Math.hypot(W / 2, 2.1) + 0.9;
  for (const s of [-1, 1]) {
    const cx = s * (len / 2 - 0.35) * Math.cos(slope);
    const cy = 4.0 + 2.1 - (len / 2 - 0.35) * Math.sin(slope);
    b.add(new THREE.BoxGeometry(len, 0.28, D + 1.4), WOOD_DARK, { pos: [cx, cy, 0], rot: [0, 0, -s * slope] });
    b.add(new THREE.BoxGeometry(len - 0.1, 0.35, D + 1.3), SNOW, { pos: [cx, cy + 0.3, 0], rot: [0, 0, -s * slope], wobble: 0.08 });
  }
  // balcony
  b.add(new THREE.BoxGeometry(W + 0.4, 0.15, 1.1), WOOD_DARK, { pos: [0, 2.6, D / 2 + 0.5] });
  b.add(new THREE.BoxGeometry(W + 0.4, 0.7, 0.1), WOOD, { pos: [0, 3.0, D / 2 + 1.0] });
  b.add(new THREE.BoxGeometry(W + 0.3, 0.2, 0.3), SNOW, { pos: [0, 3.42, D / 2 + 1.0], wobble: 0.04 });
  // windows front/back + sides
  addWindow(b, -1.4, 3.3, D / 2 - 0.02, 0);
  addWindow(b, 1.4, 3.3, D / 2 - 0.02, 0);
  addWindow(b, 0, 4.8, D / 2 - 0.02, 0);
  addWindow(b, -1.4, 3.0, -D / 2 + 0.02, Math.PI);
  addWindow(b, 1.4, 3.0, -D / 2 + 0.02, Math.PI);
  addWindow(b, W / 2 - 0.02, 2.9, 1.5, Math.PI / 2);
  addWindow(b, W / 2 - 0.02, 2.9, -1.5, Math.PI / 2);
  addWindow(b, -W / 2 + 0.02, 2.9, 1.5, -Math.PI / 2);
  addWindow(b, -W / 2 + 0.02, 2.9, -1.5, -Math.PI / 2);
  // door
  b.add(new THREE.BoxGeometry(1.1, 1.9, 0.14), WOOD_DARK, { pos: [0, 0.95, D / 2] });
  // chimney
  b.add(new THREE.BoxGeometry(0.7, 1.8, 0.7), STONE, { pos: [1.3, 5.6, -1.5], wobble: 0.05 });
  b.add(new THREE.BoxGeometry(0.85, 0.25, 0.85), SNOW, { pos: [1.3, 6.55, -1.5] });
  return b.build();
}

export const CHIMNEY_OFFSET = new THREE.Vector3(1.3, 6.8, -1.5);

export function churchGeometry() {
  const b = new GeoBuilder();
  const WALL = 0xf3ede2;
  const ROOF = 0x5e5a66;
  b.add(new THREE.BoxGeometry(7, 5, 12), WALL, { pos: [0, 2.5, 0], wobble: 0.05 });
  const slope = Math.atan2(3, 3.5);
  const len = Math.hypot(3.5, 3) + 0.6;
  for (const s of [-1, 1]) {
    const cx = s * (len / 2 - 0.3) * Math.cos(slope);
    const cy = 5 + 3 - (len / 2 - 0.3) * Math.sin(slope);
    b.add(new THREE.BoxGeometry(len, 0.3, 12.8), ROOF, { pos: [cx, cy, 0], rot: [0, 0, -s * slope] });
    b.add(new THREE.BoxGeometry(len - 0.2, 0.35, 12.6), SNOW, { pos: [cx, cy + 0.3, 0], rot: [0, 0, -s * slope], wobble: 0.06 });
  }
  const gable = new THREE.Shape();
  gable.moveTo(-3.5, 0);
  gable.lineTo(3.5, 0);
  gable.lineTo(0, 3);
  gable.closePath();
  const gg = new THREE.ExtrudeGeometry(gable, { depth: 12, bevelEnabled: false });
  gg.translate(0, 0, -6);
  b.add(gg, WALL, { pos: [0, 5, 0] });
  // tower
  b.add(new THREE.BoxGeometry(3.2, 12, 3.2), WALL, { pos: [0, 6, 7], wobble: 0.04 });
  b.add(new THREE.ConeGeometry(2.5, 6, 4), ROOF, { pos: [0, 15, 7], rot: [0, Math.PI / 4, 0] });
  b.add(new THREE.ConeGeometry(2.0, 2.6, 4), SNOW, { pos: [0, 13.6, 7], rot: [0, Math.PI / 4, 0] });
  b.add(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 16), 0xf6f1e3, { pos: [0, 10, 8.62], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.BoxGeometry(0.1, 0.7, 0.05), 0x222222, { pos: [0, 10.2, 8.7] });
  b.add(new THREE.BoxGeometry(0.5, 0.1, 0.05), 0x222222, { pos: [0.2, 10, 8.7] });
  // golden cross
  b.add(new THREE.BoxGeometry(0.12, 1.2, 0.12), 0xe0b445, { pos: [0, 18.5, 7] });
  b.add(new THREE.BoxGeometry(0.7, 0.12, 0.12), 0xe0b445, { pos: [0, 18.7, 7] });
  // windows
  for (const z of [-3.5, 0, 3.5]) {
    b.add(new THREE.BoxGeometry(0.12, 2, 1), WINDOW, { pos: [3.5, 3, z] });
    b.add(new THREE.BoxGeometry(0.12, 2, 1), WINDOW, { pos: [-3.5, 3, z] });
  }
  b.add(new THREE.BoxGeometry(1.4, 2.4, 0.14), WOOD_DARK, { pos: [0, 1.2, 8.62] });
  return b.build();
}

export function summitCrossGeometry() {
  const b = new GeoBuilder();
  b.add(new THREE.BoxGeometry(0.35, 5, 0.35), WOOD, { pos: [0, 2.5, 0], wobble: 0.03 });
  b.add(new THREE.BoxGeometry(2.6, 0.35, 0.35), WOOD, { pos: [0, 3.6, 0], wobble: 0.03 });
  b.add(new THREE.BoxGeometry(0.4, 0.12, 0.4), SNOW, { pos: [0, 5.05, 0] });
  b.add(new THREE.BoxGeometry(2.6, 0.12, 0.4), SNOW, { pos: [0, 3.82, 0] });
  b.add(new THREE.DodecahedronGeometry(1, 1), 0x7d7680, { pos: [0, 0, 0], scale: [1.4, 0.7, 1.2], wobble: 0.2 });
  return b.build();
}

/** Bench with hanger. Origin at the cable grip, faces +z. */
export function chairGeometry(accent: THREE.ColorRepresentation) {
  const b = new GeoBuilder();
  const METAL = 0x5c6370;
  b.add(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8), METAL, { pos: [0, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), METAL, { pos: [0, -1.25, -0.35] });
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), METAL, { pos: [0, -2.45, -0.35], rot: [0, 0, Math.PI / 2] });
  b.add(new THREE.BoxGeometry(1.8, 0.16, 0.65), accent, { pos: [0, -2.45, 0.0], wobble: 0.02 });
  b.add(new THREE.BoxGeometry(1.8, 0.75, 0.12), accent, { pos: [0, -2.0, -0.33], rot: [-0.12, 0, 0], wobble: 0.02 });
  // safety bar + footrest
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 6), METAL, { pos: [0, -1.75, 0.45], rot: [0, 0, Math.PI / 2] });
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), METAL, { pos: [0, -3.1, 0.65], rot: [0, 0, Math.PI / 2] });
  return b.build();
}

export function towerGeometry(height: number) {
  const b = new GeoBuilder();
  const METAL = 0x8a919c;
  b.add(new THREE.CylinderGeometry(0.35, 0.55, height, 10), METAL, { pos: [0, height / 2, 0] });
  b.add(new THREE.BoxGeometry(5.6, 0.35, 0.5), METAL, { pos: [0, height, 0] });
  b.add(new THREE.BoxGeometry(5.4, 0.15, 0.6), SNOW, { pos: [0, height + 0.25, 0] });
  for (const s of [-2.2, 2.2]) b.add(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10), 0x3c414a, { pos: [s, height - 0.25, 0], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 10), STONE, { pos: [0, 0.2, 0], wobble: 0.05 });
  return b.build();
}

/** Lift station hut + bullwheel. Origin at ground, line runs along +z (uphill). */
export function stationGeometry(accent: THREE.ColorRepresentation, isTop: boolean) {
  const b = new GeoBuilder();
  const CONCRETE = 0xb9b5b0;
  b.add(new THREE.BoxGeometry(9, 0.6, 12), CONCRETE, { pos: [0, 0.3, 0], wobble: 0.04 });
  // pillars and bullwheel housing
  b.add(new THREE.BoxGeometry(1.2, 6.2, 1.2), CONCRETE, { pos: [0, 3.1, isTop ? 2.5 : -2.5] });
  b.add(new THREE.CylinderGeometry(2.4, 2.4, 0.5, 24), 0x3c414a, { pos: [0, 6.2, isTop ? 2.5 : -2.5] });
  b.add(new THREE.BoxGeometry(5.8, 1.1, 6.4), accent, { pos: [0, 7.2, isTop ? 2.5 : -2.5], wobble: 0.03 });
  b.add(new THREE.BoxGeometry(6.0, 0.4, 6.6), SNOW, { pos: [0, 7.9, isTop ? 2.5 : -2.5], wobble: 0.05 });
  // operator hut
  const hx = 3.4;
  const hz = isTop ? -3.5 : 3.5;
  b.add(new THREE.BoxGeometry(2.6, 2.6, 2.8), WOOD, { pos: [hx, 1.9, hz], wobble: 0.03 });
  b.add(new THREE.BoxGeometry(3.2, 0.3, 3.4), WOOD_DARK, { pos: [hx, 3.3, hz] });
  b.add(new THREE.BoxGeometry(3.1, 0.35, 3.3), SNOW, { pos: [hx, 3.6, hz], wobble: 0.04 });
  b.add(new THREE.BoxGeometry(0.12, 0.9, 1.4), WINDOW, { pos: [hx - 1.32, 2.2, hz] });
  // flag pole
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 7, 6), 0xdddddd, { pos: [-3.8, 3.8, isTop ? -4.5 : 4.5] });
  return b.build();
}

/** Red flag with a white cross on a canvas texture. */
export function swissFlagMaterial() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e3242b";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#fff";
  ctx.fillRect(26, 12, 12, 40);
  ctx.fillRect(12, 26, 40, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
}
