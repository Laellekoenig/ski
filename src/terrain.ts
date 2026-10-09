import * as THREE from "three";
import { createNoise2D, fbm, ridged, clamp, lerp, smoothstep } from "./noise";
import { CHALETS, CHURCH, KICKERS, LAKE, LIFTS, PISTES, type V2 } from "./layout";
import { snowNormalMap } from "./materials";

// High-res playable grid
const X0 = -500;
const Z0 = -720;
const CELL = 2;
const NX = 501;
const NZ = 721;
const X1 = X0 + (NX - 1) * CELL;
const Z1 = Z0 + (NZ - 1) * CELL;

const noiseA = createNoise2D(7);
const noiseB = createNoise2D(13);
const noiseC = createNoise2D(29);

/** Catmull-Rom resample of a control polyline. */
export function smoothPath(points: V2[], perSegment = 8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * The analytic mountain. `groom` in [0,1] smooths out the small bumps (pistes are groomed).
 */
export function baseHeight(x: number, z: number, groom = 0): number {
  // Main face: concave profile from summit down to the valley floor
  const t = clamp((z + 600) / 1150, 0, 1);
  let h = 360 * Math.pow(1 - t, 1.5);
  // behind the summit the ground drops away into a col
  if (z < -600) h -= Math.pow((-600 - z) / 120, 2) * 40;
  // the valley keeps descending gently past the village
  if (z > 550) h -= (z - 550) * 0.04;

  // Summit pyramid
  const sx = x / 95;
  const sz = (z + 605) / 75;
  h += 95 * Math.exp(-(sx * sx + sz * sz)) + 25 * Math.exp(-(sx * sx * 4 + sz * sz * 4));

  // Valley walls, wavy
  const ax = Math.abs(x + 25 * noiseB(z * 0.004, 3.1));
  const wall = smoothstep(290, 540, ax);
  h += 300 * wall * wall + 110 * wall * ridged(noiseC, x * 0.0025, z * 0.0025, 3);

  // Rolling shapes (gullies, shoulders). Simplex has a max derivative of ~6, so keep amp*freq small.
  const big = fbm(noiseA, x * 0.0025, z * 0.0025, 2);
  const medium = fbm(noiseC, x * 0.012, z * 0.012, 2);
  h += big * 18 * (0.4 + 0.6 * smoothstep(-650, -100, z)) + medium * 3;

  // Small bumps / moguls, mostly off-piste
  const small = fbm(noiseB, x * 0.06, z * 0.06, 2) * 0.55 + noiseC(x * 0.2, z * 0.2) * 0.06;
  h += small * (1 - groom * 0.85);

  // Far mountains, outside the playable area
  const dx = Math.max(0, Math.abs(x) - 520);
  const dzBack = Math.max(0, -z - 760);
  const dzFront = Math.max(0, z - 760);
  const d = Math.sqrt(dx * dx + dzBack * dzBack + dzFront * dzFront * 0.15);
  if (d > 0) {
    const farMask = smoothstep(0, 700, d);
    // keep the valley ahead open so you can see down to the Matterhorn
    const valley = smoothstep(500, 1600, z) * (1 - smoothstep(250, 900, Math.abs(x - 150)));
    // soft, rounded massifs rather than spiky noise: clay mountains
    const massif = ridged(noiseA, x * 0.0009, z * 0.0009, 4) * 900 + fbm(noiseB, x * 0.0006, z * 0.0006, 2) * 200;
    h += farMask * (1 - valley * 0.85) * (massif + 150);
  }
  // Matterhorn-ish pyramid down the valley
  {
    const mx = x - 420;
    const mz = z - 2900;
    const r = Math.sqrt(mx * mx + mz * mz);
    const linf = Math.max(Math.abs(mx * 0.7 + mz * 0.7), Math.abs(mx * 0.7 - mz * 0.7));
    const k = Math.max(0, 1 - (0.55 * linf + 0.45 * r) / 750);
    h += 1500 * Math.pow(k, 1.6);
  }
  return h;
}

export type Surface = "snow" | "piste" | "ice";

export class Terrain {
  readonly heights = new Float32Array(NX * NZ);
  /** distance to the nearest piste centerline (capped) */
  readonly pisteDist = new Float32Array(NX * NZ);
  readonly lakeY: number;
  readonly mesh: THREE.Mesh;
  readonly farMesh: THREE.Mesh;
  readonly pistePaths: V2[][];

  constructor() {
    this.pistePaths = PISTES.map((p) => smoothPath(p.points));
    this.computePisteDistance();

    // raw heights
    for (let j = 0; j < NZ; j++) {
      const z = Z0 + j * CELL;
      for (let i = 0; i < NX; i++) {
        const x = X0 + i * CELL;
        const k = j * NX + i;
        const groom = 1 - smoothstep(0, 1, (this.pisteDist[k] - 17) / 8);
        this.heights[k] = baseHeight(x, z, groom);
      }
    }

    // flatten pads for lift stations, village & lake
    const pads: { x: number; z: number; r: number; blend: number; y: number }[] = [];
    for (const l of LIFTS) {
      for (const p of [l.bottom, l.top]) pads.push({ x: p.x, z: p.z, r: 15, blend: 18, y: this.heightAt(p.x, p.z) });
    }
    for (const c of CHALETS) pads.push({ x: c.x, z: c.z, r: 7 * c.size, blend: 8, y: this.heightAt(c.x, c.z) });
    pads.push({ x: CHURCH.x, z: CHURCH.z, r: 10, blend: 8, y: this.heightAt(CHURCH.x, CHURCH.z) });
    this.lakeY = this.heightAt(LAKE.x, LAKE.z) - 2.5;
    pads.push({ x: LAKE.x, z: LAKE.z, r: LAKE.radius, blend: 24, y: this.lakeY });

    for (const pad of pads) {
      this.forCells(pad.x, pad.z, pad.r + pad.blend, (k, x, z) => {
        const d = Math.hypot(x - pad.x, z - pad.z);
        const w = 1 - smoothstep(pad.r, pad.r + pad.blend, d);
        this.heights[k] = lerp(this.heights[k], pad.y, w);
      });
    }

    // kickers
    for (const kk of KICKERS) {
      const pts = PISTES[kk.piste].points;
      const c = pts[kk.point];
      const a = pts[kk.point - 1];
      const b = pts[kk.point + 1];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      const H = kk.height;
      const L = 11;
      const W = 5;
      this.forCells(c.x, c.z, 16, (k, x, z) => {
        const rx = x - c.x;
        const rz = z - c.z;
        const u = rx * dx + rz * dz; // along piste
        const vv = Math.abs(-rx * dz + rz * dx); // across
        if (u < -L || u > 2.5) return;
        const side = 1 - smoothstep(W - 1.5, W + 1.5, vv);
        let prof: number;
        if (u <= 0) prof = Math.pow((u + L) / L, 1.8);
        else prof = 1 - smoothstep(0, 2.5, u);
        this.heights[k] += H * prof * side;
      });
    }

    this.mesh = this.buildMesh();
    this.farMesh = this.buildFarMesh();
  }

  private computePisteDistance() {
    this.pisteDist.fill(60);
    const reach = 40;
    for (const path of this.pistePaths) {
      for (let s = 0; s < path.length - 1; s++) {
        const a = path[s];
        const b = path[s + 1];
        const minX = Math.min(a.x, b.x) - reach;
        const maxX = Math.max(a.x, b.x) + reach;
        const minZ = Math.min(a.z, b.z) - reach;
        const maxZ = Math.max(a.z, b.z) + reach;
        const i0 = Math.max(0, Math.floor((minX - X0) / CELL));
        const i1 = Math.min(NX - 1, Math.ceil((maxX - X0) / CELL));
        const j0 = Math.max(0, Math.floor((minZ - Z0) / CELL));
        const j1 = Math.min(NZ - 1, Math.ceil((maxZ - Z0) / CELL));
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const ab2 = abx * abx + abz * abz || 1;
        for (let j = j0; j <= j1; j++) {
          const z = Z0 + j * CELL;
          for (let i = i0; i <= i1; i++) {
            const x = X0 + i * CELL;
            const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / ab2, 0, 1);
            const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
            const k = j * NX + i;
            if (d < this.pisteDist[k]) this.pisteDist[k] = d;
          }
        }
      }
    }
  }

  private forCells(cx: number, cz: number, r: number, fn: (k: number, x: number, z: number) => void) {
    const i0 = Math.max(0, Math.floor((cx - r - X0) / CELL));
    const i1 = Math.min(NX - 1, Math.ceil((cx + r - X0) / CELL));
    const j0 = Math.max(0, Math.floor((cz - r - Z0) / CELL));
    const j1 = Math.min(NZ - 1, Math.ceil((cz + r - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * NX + i, X0 + i * CELL, Z0 + j * CELL);
  }

  inGrid(x: number, z: number) {
    return x >= X0 && x < X1 && z >= Z0 && z < Z1;
  }

  /** Exact height of the rendered surface (matches the mesh triangulation). */
  heightAt(x: number, z: number): number {
    if (!this.inGrid(x, z)) return baseHeight(x, z);
    const gx = (x - X0) / CELL;
    const gz = (z - Z0) / CELL;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const k = j * NX + i;
    const h = this.heights;
    const ha = h[k];
    const hb = h[k + 1];
    const hc = h[k + NX];
    const hd = h[k + NX + 1];
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }

  /** Smoothed surface normal. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 1.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  pisteDistanceAt(x: number, z: number) {
    if (!this.inGrid(x, z)) return 60;
    const i = Math.round((x - X0) / CELL);
    const j = Math.round((z - Z0) / CELL);
    return this.pisteDist[j * NX + i];
  }

  surfaceAt(x: number, z: number): Surface {
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius - 2) return "ice";
    return this.pisteDistanceAt(x, z) < 17 ? "piste" : "snow";
  }

  private buildMesh(): THREE.Mesh {
    const count = NX * NZ;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const h = this.heights;
    const n = new THREE.Vector3();

    const snowA = new THREE.Color(0xf4f7ff);
    const snowB = new THREE.Color(0xdfe8fb);
    const piste = new THREE.Color(0xfdfdff);
    const rock = new THREE.Color(0x6f6670);
    const rockB = new THREE.Color(0x8a7d72);
    const lakeBed = new THREE.Color(0x5b8fb8);
    const c = new THREE.Color();
    const tmp = new THREE.Color();

    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        const x = X0 + i * CELL;
        const z = Z0 + j * CELL;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h[k];
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 7;
        uv[k * 2 + 1] = z / 7;

        const il = Math.max(0, i - 1);
        const ir = Math.min(NX - 1, i + 1);
        const jd = Math.max(0, j - 1);
        const ju = Math.min(NZ - 1, j + 1);
        n.set(
          -(h[j * NX + ir] - h[j * NX + il]) / ((ir - il) * CELL),
          1,
          -(h[ju * NX + i] - h[jd * NX + i]) / ((ju - jd) * CELL),
        ).normalize();
        nor[k * 3] = n.x;
        nor[k * 3 + 1] = n.y;
        nor[k * 3 + 2] = n.z;

        // colour
        const nv = fbm(noiseC, x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
        c.copy(snowA).lerp(snowB, nv * 0.8);
        const pd = this.pisteDist[k];
        const onPiste = 1 - smoothstep(14, 18, pd);
        c.lerp(piste, onPiste * 0.85);
        // faint piste edge line
        const edge = Math.exp(-Math.pow((pd - 17.5) / 0.9, 2));
        c.lerp(tmp.set(0xd2dcf3), edge * 0.5);

        const steep = smoothstep(0.74, 0.55, n.y + noiseA(x * 0.03, z * 0.03) * 0.08);
        if (steep > 0) {
          tmp.copy(rock).lerp(rockB, noiseB(x * 0.05, z * 0.05) * 0.5 + 0.5);
          c.lerp(tmp, steep);
        }
        const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
        if (lakeD < LAKE.radius + 2) c.lerp(lakeBed, 1 - smoothstep(LAKE.radius - 6, LAKE.radius + 2, lakeD));

        // cheap ambient occlusion from local concavity
        const r = 4;
        const avg =
          (h[j * NX + Math.max(0, i - r)] +
            h[j * NX + Math.min(NX - 1, i + r)] +
            h[Math.max(0, j - r) * NX + i] +
            h[Math.min(NZ - 1, j + r) * NX + i]) *
          0.25;
        const ao = clamp(1 - (avg - h[k]) * 0.035, 0.72, 1.04);
        c.multiplyScalar(ao);

        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }

    const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let p = 0;
    for (let j = 0; j < NZ - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const a = j * NX + i;
        const b = a + 1;
        const cc = a + NX;
        const d = cc + 1;
        idx[p++] = a;
        idx[p++] = cc;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = cc;
        idx[p++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      normalMap: snowNormalMap(),
      normalScale: new THREE.Vector2(0.45, 0.45),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Coarse surrounding landscape with a hole where the high-res grid sits. */
  private buildFarMesh(): THREE.Mesh {
    const R = 6000;
    const S = 30;
    const N = Math.floor((2 * R) / S) + 1;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const snow = new THREE.Color(0xf1f5ff);
    const snowShade = new THREE.Color(0xc9d6f0);
    const rock = new THREE.Color(0x6a6272);
    const forest = new THREE.Color(0x3e6b4e);
    const c = new THREE.Color();
    const hs = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -R + i * S;
        const z = -R + j * S;
        const inside = x > X0 + S && x < X1 - S && z > Z0 + S && z < Z1 - S;
        const y = inside ? baseHeight(x, z) - 6 : baseHeight(x, z) - 0.6;
        hs[j * N + i] = y;
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = -R + i * S;
        const z = -R + j * S;
        const y = hs[k];
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        const il = Math.max(0, i - 1);
        const ir = Math.min(N - 1, i + 1);
        const jd = Math.max(0, j - 1);
        const ju = Math.min(N - 1, j + 1);
        const gx = (hs[j * N + ir] - hs[j * N + il]) / ((ir - il) * S);
        const gz = (hs[ju * N + i] - hs[jd * N + i]) / ((ju - jd) * S);
        const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
        c.copy(snow).lerp(snowShade, clamp(-gz * 0.8 + 0.3, 0, 1) * 0.6);
        const steep = smoothstep(0.72, 0.5, ny + noiseA(x * 0.004, z * 0.004) * 0.1);
        c.lerp(rock, steep);
        // forested lower valley slopes
        const forestMask = (1 - smoothstep(150, 320, y)) * smoothstep(0.6, 0.9, ny) * (fbm(noiseB, x * 0.003, z * 0.003, 3) > -0.1 ? 1 : 0);
        if (Math.abs(x) > 480 || z > 700) c.lerp(forest, forestMask * 0.85);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const x = -R + i * S;
        const z = -R + j * S;
        // skip cells fully inside the high-res grid (keep a one-cell overlap)
        if (x >= X0 + S && x + S <= X1 - S && z >= Z0 + S && z + S <= Z1 - S) continue;
        const a = j * N + i;
        const b = a + 1;
        const cc = a + N;
        const d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    return mesh;
  }
}

export const GRID = { X0, Z0, X1, Z1, CELL, NX, NZ };
