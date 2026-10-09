import * as THREE from "three";
import { createNoise2D, fbm, clamp, lerp, smoothstep, mulberry32 } from "./noise";
import { snowNormalMap } from "./materials";
import { ENGADINE, geographicHeight } from "./engadine";

const X0 = -1760, Z0 = -400, CELL = 8;
const NX = 441, NZ = 321;
const X1 = X0 + (NX - 1) * CELL;
const Z1 = Z0 + (NZ - 1) * CELL;
const noiseA = createNoise2D(7);
const noiseC = createNoise2D(29);

// Seeded overlapping rolls: random shapes, repeatable runs for tuning mechanics.
// Long downhill wavelengths keep the bumps from turning into uphill barriers.
const randomHill = mulberry32(4817);
const hillRolls = [
  { height: 6.5, length: 800, width: 420 },
  { height: 4, length: 500, width: 270 },
  { height: 2.4, length: 350, width: 190 },
  { height: 1.2, length: 260, width: 130 },
  { height: 0.6, length: 170, width: 90 },
  { height: 0.3, length: 100, width: 65 },
].map(roll => ({ ...roll, phase: randomHill() * Math.PI * 2, direction: randomHill() < 0.5 ? -1 : 1 }));

function hillRelief(x: number, z: number): number {
  const envelope = smoothstep(40, 280, z) * (1 - smoothstep(800, 1080, z));
  // A shallow convex shoulder makes this one broad hill, with rolling sides.
  let height = 9 * (Math.cos(clamp(x / 850, -1, 1) * Math.PI / 2) - 1);
  for (const roll of hillRolls) {
    height += roll.height * Math.sin(Math.PI * 2 * (x / roll.width + roll.direction * z / roll.length) + roll.phase);
  }
  return height * envelope;
}

/** Smooth only the practice snowfield, blending back into surveyed terrain
 * beyond its playable bounds. Distant peaks retain their geographic positions.
 */
export function baseHeight(x: number, z: number): number {
  // A steady underlying grade with rolling snow; flat start and runout.
  const downhill = Math.max(0, z - 20);
  let slope = 680 - 0.285 * downhill * smoothstep(0, 90, downhill);
  if (z > 1100) {
    // Hermite runout preserves a downhill grade until it becomes flat.
    const u = clamp((z - 1100) / 180, 0, 1);
    slope = (2 * u ** 3 - 3 * u ** 2 + 1) * 372.2
      + (u ** 3 - 2 * u ** 2 + u) * 180 * -0.285
      + (-2 * u ** 3 + 3 * u ** 2) * 340;
  }
  slope += hillRelief(x, z);
  const side = smoothstep(760, 1600, Math.abs(x));
  const uphill = 1 - smoothstep(-360, -60, z);
  const downhillBlend = smoothstep(1380, 2080, z);
  const surveyed = Math.max(side, uphill, downhillBlend);
  return lerp(slope, geographicHeight(x, z), surveyed);
}

export type Surface = "snow";

export class Terrain {
  readonly heights = new Float32Array(NX * NZ);
  readonly mesh: THREE.Mesh;
  readonly farMesh: THREE.Mesh;

  constructor() {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      this.heights[j * NX + i] = baseHeight(X0 + i * CELL, Z0 + j * CELL);
    }
    this.mesh = this.buildMesh();
    this.farMesh = this.buildFarMesh();
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

  surfaceAt(_x: number, _z: number): Surface { return "snow"; }

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
    const c = new THREE.Color();

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
    const { x0, z0, cell: S, nx: N, nz } = ENGADINE.grid;
    if (N !== nz) throw new Error("Far terrain requires a square grid");
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const snow = new THREE.Color(0xf1f5ff);
    const snowShade = new THREE.Color(0xc9d6f0);
    const rock = new THREE.Color(0x6a6272);
    const c = new THREE.Color();
    const hs = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = x0 + i * S;
        const z = z0 + j * S;
        const y = baseHeight(x, z);
        hs[j * N + i] = y;
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = x0 + i * S;
        const z = z0 + j * S;
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
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const x = x0 + i * S;
        const z = z0 + j * S;
        // Both grids meet on exact 80 m boundaries, without overlapping surfaces.
        if (x >= X0 && x + S <= X1 && z >= Z0 && z + S <= Z1) continue;
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
