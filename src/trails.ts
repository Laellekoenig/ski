import * as THREE from "three";
import type { Terrain } from "./terrain";

const SEGMENTS = 3000;
const STEP = 0.6;
const HALF_W = 0.07;

/** Ski tracks carved into the snow, as a ring buffer of quads. */
export class Trails {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private next = 0;
  private last: [THREE.Vector3, THREE.Vector3] | null = null;
  private lastCenter = new THREE.Vector3();
  private terrain: Terrain;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.pos = new Float32Array(SEGMENTS * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const nor = new Float32Array(SEGMENTS * 6 * 3);
    for (let i = 0; i < SEGMENTS * 6; i++) nor[i * 3 + 1] = 1;
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0xb9c8e6,
        roughness: 1,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        side: THREE.DoubleSide,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  /** Call every frame while grounded; `side` is the skier's horizontal right vector. */
  add(center: THREE.Vector3, side: THREE.Vector3, gap: number) {
    if (this.last && center.distanceToSquared(this.lastCenter) < STEP * STEP) return;
    const l = center.clone().addScaledVector(side, -gap);
    const r = center.clone().addScaledVector(side, gap);
    if (this.last) {
      this.quad(this.last[0], l, side);
      this.quad(this.last[1], r, side);
    }
    this.last = [l, r];
    this.lastCenter.copy(center);
  }

  break() {
    this.last = null;
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3) {
    if (a.distanceToSquared(b) > 9) return; // teleported
    const t = this.terrain;
    const pts = [
      [a.x - side.x * HALF_W, a.z - side.z * HALF_W],
      [a.x + side.x * HALF_W, a.z + side.z * HALF_W],
      [b.x - side.x * HALF_W, b.z - side.z * HALF_W],
      [b.x + side.x * HALF_W, b.z + side.z * HALF_W],
    ].map(([x, z]) => [x, t.heightAt(x, z) + 0.03, z]);
    const order = [0, 2, 1, 1, 2, 3];
    const o = this.next * 18;
    order.forEach((idx, k) => {
      this.pos[o + k * 3] = pts[idx][0];
      this.pos[o + k * 3 + 1] = pts[idx][1];
      this.pos[o + k * 3 + 2] = pts[idx][2];
    });
    this.next = (this.next + 1) % SEGMENTS;
    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}
