import * as THREE from "three";
import { clay } from "./materials";

export interface EmitOpts {
  life?: number;
  size?: number;
  /** size multiplier reached at end of life */
  grow?: number;
  color?: THREE.ColorRepresentation;
  gravity?: number;
  drag?: number;
}

const MAX = 900;

/** Pool of little clay puffs: snow spray, chimney smoke, crash poofs. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private gravity = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private next = 0;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), clay(0xffffff, { roughness: 0.9, bump: 0.3 }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: EmitOpts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.life[i] = this.maxLife[i] = o.life ?? 0.8;
    this.size[i] = o.size ?? 0.15;
    this.grow[i] = o.grow ?? 1;
    this.gravity[i] = o.gravity ?? 1;
    this.drag[i] = o.drag ?? 1.5;
    this.mesh.setColorAt(i, this.c.set(o.color ?? 0xffffff));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - 9.8 * this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      // pop in quickly, shrink out at the end
      const env = Math.min(1, t * 8) * (1 - Math.pow(t, 3));
      const s = this.size[i] * (1 + (this.grow[i] - 1) * t) * env;
      this.m.makeScale(s, s, s).setPosition(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
