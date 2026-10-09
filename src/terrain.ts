import * as THREE from "three";
import { createNoise2D, fbm, clamp, lerp, smoothstep, mulberry32 } from "./noise";
import { addSnowGlints, snowNormalMap } from "./materials";
import { mountainMaterial } from "./mountain-material";
import { ENGADINE, geographicHeight, sampleElevation } from "./engadine";

const X0 = -1760, Z0 = -400, CELL = 8;
const NX = 441, NZ = 321;
const X1 = X0 + (NX - 1) * CELL;
const Z1 = Z0 + (NZ - 1) * CELL;
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
  return lerp(slope, geographicHeight(x, z), 1 - practiceField(x, z));
}

/** 1 on the shaped practice snowfield, fading to 0 where the surveyed terrain takes over. */
function practiceField(x: number, z: number): number {
  const side = smoothstep(760, 1600, Math.abs(x));
  const uphill = 1 - smoothstep(-360, -60, z);
  const downhillBlend = smoothstep(1380, 2080, z);
  return 1 - Math.max(side, uphill, downhillBlend);
}

/** Plain white snow hides its rolls, so the practice field is shaded as if they were this much deeper. */
const RELIEF_SHADING = 3.5;
/** Rolls are measured against the terrain averaged over this many cells either way. */
const RELIEF_RADIUS = 10;

/** Separable box blur of a height grid, clamped at the edges. */
function blurHeights(h: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(h.length);
  const out = new Float32Array(h.length);
  const n = 2 * r + 1;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    let sum = 0;
    for (let o = -r; o <= r; o++) sum += h[j * NX + clamp(i + o, 0, NX - 1)];
    tmp[j * NX + i] = sum / n;
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    let sum = 0;
    for (let o = -r; o <= r; o++) sum += tmp[clamp(j + o, 0, NZ - 1) * NX + i];
    out[j * NX + i] = sum / n;
  }
  return out;
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
    const broad = blurHeights(h, RELIEF_RADIUS);
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
        const dx = (ir - il) * CELL;
        const dz = (ju - jd) * CELL;
        const gx = (h[j * NX + ir] - h[j * NX + il]) / dx;
        const gz = (h[ju * NX + i] - h[jd * NX + i]) / dz;
        const bx = (broad[j * NX + ir] - broad[j * NX + il]) / dx;
        const bz = (broad[ju * NX + i] - broad[jd * NX + i]) / dz;
        // exaggerate how far each roll tilts away from the underlying grade
        const relief = lerp(1, RELIEF_SHADING, practiceField(x, z));
        n.set(-(bx + (gx - bx) * relief), 1, -(bz + (gz - bz) * relief)).normalize();
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

    const mat = addSnowGlints(new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      normalMap: snowNormalMap(),
      normalScale: new THREE.Vector2(0.35, 0.35),
    }));
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
    const exposure = new Float32Array(N * N);
    const snow = new THREE.Color(0xf1f5ff);
    const snowShade = new THREE.Color(0xc9d6f0);
    const c = new THREE.Color();
    const elevationOffset = sampleElevation(0, 0) - baseHeight(0, 0);
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

        // Wind-scoured crests expose rock even when the sampled summit is flat.
        // Concave gullies and gentle snow basins retain their winter cover.
        const r = 3;
        const shoulders = (hs[j * N + Math.max(0, i - r)]
          + hs[j * N + Math.min(N - 1, i + r)]
          + hs[Math.max(0, j - r) * N + i]
          + hs[Math.min(N - 1, j + r) * N + i]) * 0.25;
        const ridge = smoothstep(4, 42, y - shoulders);
        const steep = smoothstep(0.1, 0.34, 1 - ny);
        const alpine = smoothstep(2350, 2800, y + elevationOffset);
        // Fade back to snow before the far mesh meets the playable grid.
        const outside = Math.max(X0 - x, x - X1, Z0 - z, z - Z1);
        exposure[k] = alpine * (steep * 0.85 + ridge * 0.7)
          * smoothstep(0, 320, outside);
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
    geo.setAttribute("rockExposure", new THREE.BufferAttribute(exposure, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = mountainMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    return mesh;
  }
}

export const GRID = { X0, Z0, X1, Z1, CELL, NX, NZ };
