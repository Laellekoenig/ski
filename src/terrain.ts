import * as THREE from "three";
import { createNoise2D, fbm, ridged, clamp, lerp, smoothstep } from "./noise";
import { CHALETS, CHURCH, KICKERS, LAKES, LIFTS, PISTES, landscapeAt, type V2 } from "./layout";
import { snowNormalMap } from "./materials";

// High-res playable grid
const X0 = -1380;
const Z0 = -1380;
const CELL = 4;
const NX = 691;
const NZ = 691;
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
  const r = Math.hypot(x, z);
  const radial = Math.max(0, r - 18);
  // A broad, genuinely central summit, falling away on all eight faces.
  let h = 640 * Math.pow(Math.max(0, 1 - radial / 1510), 1.4);
  const shoulder = smoothstep(70, 240, r) * (1 - smoothstep(1100, 1500, r));
  const angle = Math.atan2(z, x);
  h += shoulder * (Math.sin(angle * 8 + r * 0.002) * 12 + fbm(noiseA, x * 0.003, z * 0.003, 2) * 14);
  const rocky = smoothstep(0, 210, -x) * smoothstep(0, 210, -z) * shoulder;
  // Granite ribs and deep gullies, with softer groomed crossings.
  h += rocky * (Math.sin(angle * 22 + r * 0.004) * 23 + ridged(noiseC, x * 0.009, z * 0.009, 2) * 24) * (1 - groom * 0.45);
  const powder = smoothstep(0, 180, -x) * smoothstep(0, 180, z) * shoulder;
  const small = fbm(noiseB, x * 0.035, z * 0.035, 2);
  h += shoulder * small * (1.2 + powder * 3.2) * (1 - groom * 0.9);
  // Distant massifs encircle the ski area beyond an open valley.
  const far = smoothstep(1600, 2400, r);
  h += far * (140 + ridged(noiseA, x * 0.00045, z * 0.00045, 2) * 680 + fbm(noiseB, x * 0.0006, z * 0.0006, 2) * 100);
  const mx = x - 600, mz = z - 3600;
  const peak = Math.max(0, 1 - Math.hypot(mx, mz) / 900);
  h += 1600 * Math.pow(peak, 1.7);
  return h;
}

export type Surface = "snow" | "piste" | "ice" | "powder" | "rock";

export class Terrain {
  readonly heights = new Float32Array(NX * NZ);
  /** Distance from the nearest piste edge, offset by 20; honours each trail width. */
  readonly pisteDist = new Float32Array(NX * NZ);
  readonly lakeHeights: number[];
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
        const groom = 1 - smoothstep(17, 25, this.pisteDist[k]);
        this.heights[k] = baseHeight(x, z, groom);
      }
    }

    this.groomRoutes();

    // flatten pads for lift stations, village & lake
    const pads: { x: number; z: number; r: number; blend: number; y: number }[] = [];
    for (const l of LIFTS) {
      for (const p of [l.bottom, l.top]) pads.push({ x: p.x, z: p.z, r: 15, blend: 18, y: this.heightAt(p.x, p.z) });
    }
    for (const c of CHALETS) pads.push({ x: c.x, z: c.z, r: 7 * c.size, blend: 8, y: this.heightAt(c.x, c.z) });
    pads.push({ x: CHURCH.x, z: CHURCH.z, r: 10, blend: 8, y: this.heightAt(CHURCH.x, CHURCH.z) });
    pads.push({ x: 0, z: 0, r: 14, blend: 16, y: 640 });
    this.lakeHeights = LAKES.map((lake) => this.heightAt(lake.x, lake.z) - 2);
    LAKES.forEach((lake, i) => pads.push({ x: lake.x, z: lake.z, r: lake.radius, blend: 62, y: this.lakeHeights[i] }));

    for (const pad of pads) {
      this.forCells(pad.x, pad.z, pad.r + pad.blend, (k, x, z) => {
        const d = Math.hypot(x - pad.x, z - pad.z);
        const w = 1 - smoothstep(pad.r, pad.r + pad.blend, d);
        this.heights[k] = lerp(this.heights[k], pad.y, w);
      });
    }

    // Sculpt real takeoffs, gaps and landings into the collision heightfield.
    for (const jump of KICKERS) {
      const dx = Math.sin(jump.heading), dz = Math.cos(jump.heading);
      this.forCells(jump.x, jump.z, jump.length + 48, (k, x, z) => {
        const rx = x - jump.x, rz = z - jump.z;
        let u = rx * dx + rz * dz;
        const across = -rx * dz + rz * dx;
        if (jump.kind === "hip") u += across * 0.32;
        const side = 1 - smoothstep(jump.width - 3, jump.width + 4, Math.abs(across));
        if (!side) return;
        let profile = 0;
        if (u >= -jump.length && u <= 0) profile = jump.height * Math.pow((u + jump.length) / jump.length, 1.7);
        if (u > 0) {
          if (jump.kind === "roller") profile = jump.height * (1 - smoothstep(0, 18, u));
          else if (jump.kind === "tabletop") profile = jump.height * (1 - smoothstep(12, 38, u));
          else {
            profile = jump.height * (1 - smoothstep(0, 5, u));
            if (jump.kind === "gap") {
              profile -= 4 * smoothstep(3, 10, u) * (1 - smoothstep(18, 46, u));
              profile += 1.5 * smoothstep(30, 38, u) * (1 - smoothstep(38, 62, u));
            }
          }
        }
        this.heights[k] += profile * side;
      });
    }

    this.mesh = this.buildMesh();
    this.farMesh = this.buildFarMesh();
  }

  /** Cut traverses through the ribs at a steady downhill grade. */
  private groomRoutes() {
    const target = new Float32Array(NX * NZ);
    const weight = new Float32Array(NX * NZ);
    const blend = new Float32Array(NX * NZ);
    this.pistePaths.forEach((path, pi) => {
      const piste = PISTES[pi];
      const half = piste.width / 2;
      const reach = half + 16;
      const distances = [0];
      for (let i = 1; i < path.length; i++) distances.push(distances[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
      const start = baseHeight(path[0].x, path[0].z, 1);
      const end = baseHeight(path[path.length - 1].x, path[path.length - 1].z, 1);
      const ys = path.map((p, i) => piste.connector ? lerp(start, end, distances[i] / distances[distances.length - 1]) : baseHeight(p.x, p.z, 1));
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const length2 = dx * dx + dz * dz;
        this.forCells((a.x + b.x) / 2, (a.z + b.z) / 2, Math.sqrt(length2) / 2 + reach, (k, x, z) => {
          const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1);
          const distance = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
          const w = 1 - smoothstep(half - 4, reach, distance);
          if (!w) return;
          target[k] += lerp(ys[i - 1], ys[i], u) * w;
          weight[k] += w;
          blend[k] = Math.max(blend[k], w);
        });
      }
    });
    for (let k = 0; k < this.heights.length; k++) {
      if (weight[k] > 0) this.heights[k] = lerp(this.heights[k], target[k] / weight[k], blend[k]);
    }
  }

  private computePisteDistance() {
    this.pisteDist.fill(60);
    const reach = 40;
    for (const [pi, path] of this.pistePaths.entries()) {
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
            const edgeDistance = d + 20 - PISTES[pi].width / 2;
            if (edgeDistance < this.pisteDist[k]) this.pisteDist[k] = edgeDistance;
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
    if (LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < lake.radius - 2)) return "ice";
    if (this.pisteDistanceAt(x, z) < 20) return "piste";
    const region = landscapeAt(x, z);
    if (region === "powder") return "powder";
    if (region === "rock") return "rock";
    return "snow";
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
        const onPiste = 1 - smoothstep(17, 22, pd);
        c.lerp(piste, onPiste * 0.85);
        // faint piste edge line
        const edge = Math.exp(-Math.pow((pd - 20.5) / 0.9, 2));
        c.lerp(tmp.set(0xd2dcf3), edge * 0.5);

        const steep = smoothstep(0.74, 0.55, n.y + noiseA(x * 0.03, z * 0.03) * 0.08);
        if (steep > 0) {
          tmp.copy(rock).lerp(rockB, noiseB(x * 0.05, z * 0.05) * 0.5 + 0.5);
          c.lerp(tmp, steep);
        }
        const region = landscapeAt(x, z);
        if (region === "rock" && pd > 24) {
          c.lerp(tmp.set(0x8d899b), smoothstep(0.97, 0.8, n.y) * 0.78);
        }
        if (region === "powder") c.lerp(tmp.set(0xd6eaf2), (1 - onPiste) * 0.25);
        for (const lake of LAKES) {
          const lakeD = Math.hypot(x - lake.x, z - lake.z);
          if (lakeD < lake.radius + 2) c.lerp(lakeBed, 1 - smoothstep(lake.radius - 6, lake.radius + 2, lakeD));
        }

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
        if (Math.hypot(x, z) > 1550) c.lerp(forest, forestMask * 0.85);
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
