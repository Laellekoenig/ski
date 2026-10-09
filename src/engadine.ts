import terrainUrl from "./data/engadine.bin?url";
import metadata from "./data/engadine.json";
import { clamp, lerp } from "./noise";

export const ENGADINE = metadata;
let heights: Uint16Array | undefined;
let elevationOffset = 0;

/** Load the bundled bake, never a live third-party map service. */
export async function loadEngadine() {
  const response = await fetch(terrainUrl);
  if (!response.ok) throw new Error(`Terrain download failed (${response.status})`);
  const buffer = await response.arrayBuffer();
  const { nx, nz } = ENGADINE.grid;
  if (buffer.byteLength !== nx * nz * 2) throw new Error("Incomplete Engadine terrain asset");
  const view = new DataView(buffer);
  heights = new Uint16Array(nx * nz);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getUint16(i * 2, true);
  // Keep the physics origin unchanged, preserving all source height differences.
  elevationOffset = sampleElevation(0, 0) - 680;
}

/** Source elevation in metres, bilinearly sampled from the 80 m bake. */
export function sampleElevation(x: number, z: number): number {
  if (!heights) throw new Error("Engadine terrain must load before creating the world");
  const { x0, z0, cell, nx, nz } = ENGADINE.grid;
  const gx = clamp((x - x0) / cell, 0, nx - 1);
  const gz = clamp((z - z0) / cell, 0, nz - 1);
  const i = Math.min(nx - 2, Math.floor(gx));
  const j = Math.min(nz - 2, Math.floor(gz));
  const fx = gx - i, fz = gz - j;
  const k = j * nx + i;
  return lerp(lerp(heights[k], heights[k + 1], fx), lerp(heights[k + nx], heights[k + nx + 1], fx), fz) * ENGADINE.heightScale;
}

export function geographicHeight(x: number, z: number): number {
  return sampleElevation(x, z) - elevationOffset;
}
