import * as THREE from "three";
import type { LiftDef } from "./layout";
import type { Terrain } from "./terrain";
import { clay, clayVC } from "./materials";
import { chairGeometry, stationGeometry, swissFlagMaterial, towerGeometry } from "./props";
import type { Collider } from "./world";

const CABLE_OFFSET = 2.2;
const CHAIR_SPACING = 26;
const CHAIR_SPEED = 5; // ambient chair speed, m/s
export const RIDE_SPEED = 16; // the player's chair is faster so rides aren't a chore

class Polyline {
  readonly pts: THREE.Vector3[];
  readonly cum: number[] = [0];
  readonly length: number;
  constructor(pts: THREE.Vector3[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  at(s: number, out: THREE.Vector3) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1);
    return out.lerpVectors(this.pts[i - 1], this.pts[i], t);
  }
}

export class Lift {
  readonly def: LiftDef;
  readonly group = new THREE.Group();
  readonly bottom: THREE.Vector3;
  readonly top: THREE.Vector3;
  /** horizontal unit vector from bottom to top */
  readonly dir: THREE.Vector3;
  /** horizontal unit vector to the right when facing uphill */
  readonly right: THREE.Vector3;
  readonly up: Polyline;
  readonly down: Polyline;
  readonly colliders: Collider[] = [];
  private chairs: THREE.InstancedMesh;
  private chairCount: number;
  private phase = 0;
  readonly rideChair: THREE.Mesh;
  private flags: THREE.Mesh[] = [];

  constructor(def: LiftDef, terrain: Terrain) {
    this.def = def;
    this.bottom = new THREE.Vector3(def.bottom.x, terrain.heightAt(def.bottom.x, def.bottom.z), def.bottom.z);
    this.top = new THREE.Vector3(def.top.x, terrain.heightAt(def.top.x, def.top.z), def.top.z);
    this.dir = new THREE.Vector3(this.top.x - this.bottom.x, 0, this.top.z - this.bottom.z).normalize();
    this.right = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    const yaw = Math.atan2(this.dir.x, this.dir.z);

    // stations
    for (const [p, isTop] of [
      [this.bottom, false],
      [this.top, true],
    ] as const) {
      const st = new THREE.Mesh(stationGeometry(def.color, isTop), clayVC());
      st.position.copy(p);
      st.rotation.y = yaw;
      st.castShadow = st.receiveShadow = true;
      this.group.add(st);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1, 8, 4), swissFlagMaterial());
      flag.geometry.translate(0.8, 0, 0);
      const fp = new THREE.Vector3(-3.8, 6.7, isTop ? -4.5 : 4.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(p);
      flag.position.copy(fp);
      flag.userData.base = (flag.geometry.getAttribute("position") as THREE.BufferAttribute).array.slice();
      this.flags.push(flag);
      this.group.add(flag);
      // bullwheel housing pillar
      const pillar = new THREE.Vector3(0, 0, isTop ? 2.5 : -2.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(p);
      this.colliders.push({ x: pillar.x, z: pillar.z, r: 1.2, top: p.y + 6 });
      const hut = new THREE.Vector3(3.4, 0, isTop ? -3.5 : 3.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(p);
      this.colliders.push({ x: hut.x, z: hut.z, r: 1.9, top: p.y + 3.5 });
    }

    // towers along the line
    const horiz = Math.hypot(this.top.x - this.bottom.x, this.top.z - this.bottom.z);
    const n = Math.max(1, Math.round(horiz / 70));
    const centre: THREE.Vector3[] = [new THREE.Vector3().copy(this.bottom).setY(this.bottom.y + 6.4)];
    const towerMat = clayVC();
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = THREE.MathUtils.lerp(this.bottom.x, this.top.x, t);
      const z = THREE.MathUtils.lerp(this.bottom.z, this.top.z, t);
      const g = terrain.heightAt(x, z);
      // keep the cable clear of the terrain around the tower
      let maxG = g;
      for (let k = -4; k <= 4; k++) {
        const tt = THREE.MathUtils.clamp(t + (k / 4) * (35 / horiz), 0, 1);
        maxG = Math.max(maxG, terrain.heightAt(THREE.MathUtils.lerp(this.bottom.x, this.top.x, tt), THREE.MathUtils.lerp(this.bottom.z, this.top.z, tt)));
      }
      const h = Math.max(10, maxG - g + 9);
      const tower = new THREE.Mesh(towerGeometry(h), towerMat);
      tower.position.set(x, g - 0.3, z);
      tower.rotation.y = yaw;
      tower.castShadow = true;
      this.group.add(tower);
      centre.push(new THREE.Vector3(x, g - 0.3 + h - 0.1, z));
      this.colliders.push({ x, z, r: 0.9, top: g + h });
    }
    centre.push(new THREE.Vector3().copy(this.top).setY(this.top.y + 6.4));

    this.up = new Polyline(centre.map((p) => p.clone().addScaledVector(this.right, CABLE_OFFSET)));
    this.down = new Polyline(centre.map((p) => p.clone().addScaledVector(this.right, -CABLE_OFFSET)));

    // cables
    const cableMat = clay(0x2b2f36, { bump: 0 });
    for (const line of [this.up, this.down]) {
      const curve = new THREE.CatmullRomCurve3(line.pts, false, "catmullrom", 0);
      const tube = new THREE.TubeGeometry(curve, line.pts.length * 8, 0.06, 4, false);
      this.group.add(new THREE.Mesh(tube, cableMat));
    }

    // chairs
    const loop = this.up.length + this.down.length;
    this.chairCount = Math.floor(loop / CHAIR_SPACING);
    const chairGeo = chairGeometry(def.color);
    this.chairs = new THREE.InstancedMesh(chairGeo, clayVC(), this.chairCount);
    this.chairs.castShadow = true;
    this.chairs.frustumCulled = false;
    this.group.add(this.chairs);
    this.rideChair = new THREE.Mesh(chairGeo, clayVC());
    this.rideChair.castShadow = true;
    this.rideChair.visible = false;
    this.group.add(this.rideChair);
    this.update(0, 0);
  }

  private tmpP = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);
  private yAxis = new THREE.Vector3(0, 1, 0);

  /** Position on the up-cable at arc length s (cable grip). */
  ridePoint(s: number, out: THREE.Vector3) {
    return this.up.at(s, out);
  }

  get rideLength() {
    return this.up.length;
  }

  update(dt: number, time: number) {
    this.phase += dt * CHAIR_SPEED;
    const L1 = this.up.length;
    const loop = L1 + this.down.length;
    const yawUp = Math.atan2(this.dir.x, this.dir.z);
    for (let i = 0; i < this.chairCount; i++) {
      const s = (this.phase + i * (loop / this.chairCount)) % loop;
      let yaw: number;
      if (s < L1) {
        this.up.at(s, this.tmpP);
        yaw = yawUp;
      } else {
        this.down.at(loop - s, this.tmpP);
        yaw = yawUp + Math.PI;
      }
      this.tmpQ.setFromAxisAngle(this.yAxis, yaw);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.one);
      this.chairs.setMatrixAt(i, this.tmpM);
    }
    this.chairs.instanceMatrix.needsUpdate = true;

    // flags flutter
    for (const f of this.flags) {
      const pos = f.geometry.getAttribute("position") as THREE.BufferAttribute;
      const base = f.userData.base as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        pos.setZ(i, Math.sin(x * 3 - time * 6 + y) * 0.15 * x);
      }
      pos.needsUpdate = true;
      f.geometry.computeVertexNormals();
    }
  }
}
