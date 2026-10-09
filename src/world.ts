import * as THREE from "three";
import { Terrain } from "./terrain";
import { BOUNDS, CHALETS, CHURCH, KICKERS, LAKES, LIFTS, PISTES, landscapeAt, polar } from "./layout";
import { Weather } from "./weather";
import { Lift } from "./lifts";
import { clay, clayVC } from "./materials";
import { createNoise2D, fbm, mulberry32, smoothstep } from "./noise";
import { CHIMNEY_OFFSET, GeoBuilder, chaletGeometry, churchGeometry, markerGeometry, pineGeometry, rockGeometry, summitCrossGeometry } from "./props";
import type { Particles } from "./particles";

export interface Collider {
  x: number;
  z: number;
  r: number;
  /** world-space height of the obstacle top; you can jump over it */
  top: number;
}

export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
export const SKY_TOP = new THREE.Color(0x4f8fe0);
export const SKY_HORIZON = new THREE.Color(0xcfe4f7);

const forestNoise = createNoise2D(57);

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax;
  const abz = bz - az;
  const t = THREE.MathUtils.clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

export class World {
  readonly scene = new THREE.Scene();
  readonly terrain: Terrain;
  readonly lifts: Lift[];
  readonly sun: THREE.DirectionalLight;
  readonly summit: THREE.Vector3;
  readonly weather: Weather;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** tree positions, for the minimap */
  readonly trees: { x: number; z: number }[] = [];
  private grid = new Map<number, Collider[]>();
  private clouds: THREE.Group[] = [];
  private chimneys: THREE.Vector3[] = [];
  private smokeTimer = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    const scene = this.scene;
    scene.background = SKY_HORIZON.clone();
    scene.fog = new THREE.Fog(SKY_HORIZON.clone().lerp(new THREE.Color(0xffffff), 0.15), 350, 5200);

    // Sky dome
    const sky = this.sky = this.makeSky();
    scene.add(sky);

    // Image based lighting from the sky for soft clay shading
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.makeSky());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(5000, 16), new THREE.MeshBasicMaterial({ color: 0xe8eef8 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -50;
    envScene.add(ground);
    scene.environment = pmrem.fromScene(envScene, 0.04, 1, 20000).texture;
    scene.environmentIntensity = 0.55;

    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0xf7ede2, 0.65));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 55;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Terrain
    this.terrain = new Terrain();
    scene.add(this.terrain.mesh, this.terrain.farMesh);

    // Lifts
    this.lifts = LIFTS.map((def) => new Lift(def, this.terrain));
    for (const l of this.lifts) {
      scene.add(l.group);
      for (const c of l.colliders) this.addCollider(c);
    }

    this.summit = new THREE.Vector3(0, this.terrain.heightAt(0, 0), 0);
    const cross = new THREE.Mesh(summitCrossGeometry(), clayVC());
    cross.position.set(-18, this.terrain.heightAt(-18, -5) - 0.3, -5);
    cross.rotation.y = 0.4;
    cross.castShadow = true;
    scene.add(cross);
    this.addCollider({ x: -18, z: -5, r: 1.4, top: cross.position.y + 5 });
    this.weather = new Weather(scene);

    this.placeVillage();
    this.placeLake();
    this.placeForest();
    this.placeRocks();
    this.placeMarkers();
    this.placeKickerFlags();
    this.placeClouds();
    this.placeSigns();
  }

  /** Orange flags either side of each jump lip so you can spot them from above. */
  private placeKickerFlags() {
    const b = new GeoBuilder();
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), 0xffffff, { pos: [0, 1.2, 0] });
    const flag = new THREE.Shape();
    flag.moveTo(0, 0);
    flag.lineTo(0.9, -0.3);
    flag.lineTo(0, -0.6);
    flag.closePath();
    b.add(new THREE.ExtrudeGeometry(flag, { depth: 0.04, bevelEnabled: false }), 0xff7a1a, { pos: [0.05, 2.4, 0] });
    const geo = b.build();
    for (const k of KICKERS) {
      const c = k;
      const dx = Math.sin(k.heading);
      const dz = Math.cos(k.heading);
      for (const side of [-1, 1]) {
        const x = c.x - dz * (k.width + 3) * side;
        const z = c.z + dx * (k.width + 3) * side;
        const m = new THREE.Mesh(geo, clayVC());
        m.position.set(x, this.terrain.heightAt(x, z) - 0.1, z);
        m.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
        m.castShadow = true;
        this.scene.add(m);
      }
    }
  }

  private makeSky() {
    const geo = new THREE.SphereGeometry(9000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: SKY_TOP },
        horizon: { value: SKY_HORIZON },
        sunDir: { value: SUN_DIR },
        storm: { value: 0 },
        stormColor: { value: new THREE.Color(0xa8bdce) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float storm; uniform vec3 stormColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.55));
          col = mix(col, horizon * 1.04, smoothstep(0.0, -0.2, d.y));
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 8.0) * 0.25 + pow(s, 900.0) * 3.0);
          col = mix(col, stormColor, storm);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -1;
    return m;
  }

  addCollider(c: Collider) {
    const x0 = Math.floor((c.x - c.r) / 10);
    const x1 = Math.floor((c.x + c.r) / 10);
    const z0 = Math.floor((c.z - c.r) / 10);
    const z1 = Math.floor((c.z + c.r) / 10);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const key = (i + 1000) * 4096 + (j + 1000);
        let arr = this.grid.get(key);
        if (!arr) this.grid.set(key, (arr = []));
        arr.push(c);
      }
    }
  }

  collidersNear(x: number, z: number): Collider[] {
    return this.grid.get((Math.floor(x / 10) + 1000) * 4096 + (Math.floor(z / 10) + 1000)) ?? [];
  }

  private blocked(x: number, z: number, margin: number) {
    for (const l of this.lifts) {
      if (distToSegment(x, z, l.bottom.x, l.bottom.z, l.top.x, l.top.z) < 9 + margin) return true;
      if (Math.hypot(x - l.bottom.x, z - l.bottom.z) < 30 + margin) return true;
      if (Math.hypot(x - l.top.x, z - l.top.z) < 30 + margin) return true;
    }
    for (const c of CHALETS) if (Math.hypot(x - c.x, z - c.z) < 11 + margin) return true;
    if (Math.hypot(x - CHURCH.x, z - CHURCH.z) < 16 + margin) return true;
    for (const lake of LAKES) if (Math.hypot(x - lake.x, z - lake.z) < lake.radius + 10 + margin) return true;
    for (const jump of KICKERS) {
      const dx = x - jump.x, dz = z - jump.z;
      const along = dx * Math.sin(jump.heading) + dz * Math.cos(jump.heading);
      const across = dx * Math.cos(jump.heading) - dz * Math.sin(jump.heading);
      if (along > -jump.length - 14 && along < 65 && Math.abs(across) < jump.width + 12 + margin) return true;
    }
    if (Math.hypot(x - this.summit.x, z - this.summit.z) < 95) return true;
    return false;
  }

  private placeForest() {
    const rand = mulberry32(2024);
    const geos = [pineGeometry(true), pineGeometry(false)];
    const mats = clayVC();
    // bucket instances into tiles so camera + shadow frustum culling can skip most of the forest
    const TILE = 200;
    const tiles = new Map<string, THREE.Matrix4[]>();
    const q = new THREE.Quaternion();
    const n = new THREE.Vector3();
    const t = this.terrain;
    for (let tries = 0; tries < 68000; tries++) {
      const x = BOUNDS.minX + rand() * (BOUNDS.maxX - BOUNDS.minX);
      const z = BOUNDS.minZ + rand() * (BOUNDS.maxZ - BOUNDS.minZ);
      const y = t.heightAt(x, z);
      const region = landscapeAt(x, z);
      if (region === "rock" || region === "storm") continue;
      const treeline = 460 + forestNoise(x * 0.01, z * 0.01) * 35;
      if (y > treeline) continue;
      const density = fbm(forestNoise, x * 0.006, z * 0.006, 3) * 0.8 + 0.25 + (1 - smoothstep(treeline - 60, treeline, y)) * 0.25;
      if (rand() > density) continue;
      const pd = t.pisteDistanceAt(x, z);
      if (pd < 22 + rand() * 6) continue;
      if (this.blocked(x, z, 0)) continue;
      t.normalAt(x, z, n);
      if (n.y < 0.72) continue;
      const s = 0.75 + rand() * 0.7 + (pd > 50 ? 0.25 : 0);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.2, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s));
      const variant = y > 120 || rand() < 0.6 ? 0 : 1;
      const key = `${variant}|${Math.floor(x / TILE)}|${Math.floor(z / TILE)}`;
      let list = tiles.get(key);
      if (!list) tiles.set(key, (list = []));
      list.push(m);
      this.trees.push({ x, z });
      this.addCollider({ x, z, r: 0.9 * s, top: y + 6 * s });
    }
    for (const [key, list] of tiles) {
      const im = new THREE.InstancedMesh(geos[Number(key[0])], mats, list.length);
      list.forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    }
  }

  private placeRocks() {
    const rand = mulberry32(77);
    const variants = [rockGeometry(1), rockGeometry(5), rockGeometry(9)];
    const lists: THREE.Matrix4[][] = [[], [], []];
    const t = this.terrain;
    const n = new THREE.Vector3();
    for (let tries = 0; tries < 14000; tries++) {
      const x = BOUNDS.minX + rand() * (BOUNDS.maxX - BOUNDS.minX);
      const z = BOUNDS.minZ + rand() * (BOUNDS.maxZ - BOUNDS.minZ);
      const y = t.heightAt(x, z);
      const rocky = landscapeAt(x, z) === "rock";
      if (!rocky && rand() > 0.2) continue;
      if (t.pisteDistanceAt(x, z) < 24) continue;
      if (this.blocked(x, z, 2)) continue;
      t.normalAt(x, z, n);
      if (rand() > (rocky ? 0.5 : 0.1) + (1 - n.y) * 1.5) continue;
      const s = rocky ? 1.8 + Math.pow(rand(), 2) * 9 : 0.8 + rand() * 2.5;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.3, rand() * 6.28, rand() * 0.3));
      const k = Math.floor(rand() * 3);
      lists[k].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.25 * s, z), q, new THREE.Vector3(s, s, s)));
      this.addCollider({ x, z, r: 1.1 * s, top: y + 0.55 * s });
    }
    variants.forEach((g, i) => {
      const im = new THREE.InstancedMesh(g, clayVC(), lists[i].length);
      lists[i].forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    });
  }

  private placeMarkers() {
    const pts: { x: number; z: number; c: THREE.Color }[] = [];
    this.terrain.pistePaths.forEach((path, pi) => {
      const color = new THREE.Color(PISTES[pi].color);
      const half = PISTES[pi].width / 2 + 0.5;
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        acc += seg;
        if (acc < 32) continue;
        acc = 0;
        const dx = (b.x - a.x) / seg;
        const dz = (b.z - a.z) / seg;
        for (const s of [-1, 1]) {
          const x = b.x - dz * half * s;
          const z = b.z + dx * half * s;
          if (this.blocked(x, z, -6)) continue;
          pts.push({ x, z, c: color });
        }
      }
    });
    const geo = markerGeometry();
    const im = new THREE.InstancedMesh(geo, clay(0xffffff, { bump: 0.2 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.makeTranslation(p.x, this.terrain.heightAt(p.x, p.z) - 0.1, p.z);
      im.setMatrixAt(i, m);
      im.setColorAt(i, p.c);
    });
    im.castShadow = true;
    im.computeBoundingSphere();
    this.scene.add(im);
    // orange tips
    const tip = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.85, 0), clay(0xff7a1a, { bump: 0.2 }), pts.length);
    pts.forEach((p, i) => {
      m.makeTranslation(p.x, this.terrain.heightAt(p.x, p.z) - 0.1, p.z);
      tip.setMatrixAt(i, m);
    });
    tip.computeBoundingSphere();
    this.scene.add(tip);
  }

  private placeVillage() {
    const geo = chaletGeometry();
    const mat = clayVC();
    for (const c of CHALETS) {
      const m = new THREE.Mesh(geo, mat);
      const y = this.terrain.heightAt(c.x, c.z);
      m.position.set(c.x, y - 0.3, c.z);
      m.rotation.y = c.rot;
      m.scale.setScalar(c.size);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      this.addCollider({ x: c.x, z: c.z, r: 4.6 * c.size, top: y + 7 * c.size });
      this.chimneys.push(CHIMNEY_OFFSET.clone().multiplyScalar(c.size).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.rot).add(m.position));
    }
    const church = new THREE.Mesh(churchGeometry(), mat);
    const y = this.terrain.heightAt(CHURCH.x, CHURCH.z);
    church.position.set(CHURCH.x, y - 0.3, CHURCH.z);
    church.rotation.y = CHURCH.rot;
    church.castShadow = church.receiveShadow = true;
    this.scene.add(church);
    this.addCollider({ x: CHURCH.x, z: CHURCH.z, r: 6, top: y + 10 });
    const tower = new THREE.Vector3(0, 0, 7).applyAxisAngle(new THREE.Vector3(0, 1, 0), CHURCH.rot).add(church.position);
    this.addCollider({ x: tower.x, z: tower.z, r: 2.4, top: y + 18 });
  }

  private placeLake() {
    LAKES.forEach((lake, index) => {
    const ice = new THREE.Mesh(
      new THREE.CircleGeometry(lake.radius - 0.5, 96),
      new THREE.MeshStandardMaterial({
        color: 0x8ed8e9,
        roughness: 0.12,
        metalness: 0.0,
        transparent: true,
        opacity: 0.72,
        envMapIntensity: 1.4,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(lake.x, this.terrain.lakeHeights[index] + 0.05, lake.z);
    ice.receiveShadow = true;
    this.scene.add(ice);
    // Fixed hairline fractures make the frozen surface legible from a distance.
    const random = mulberry32(940 + index);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 18; i++) {
      const a = random() * Math.PI * 2;
      const r = random() * lake.radius * 0.65;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const length = 8 + random() * 22;
      points.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x + Math.cos(a + 0.7) * length, 0, z + Math.sin(a + 0.7) * length));
    }
    const cracks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xe3fbff, transparent: true, opacity: 0.65 }));
    cracks.position.set(lake.x, this.terrain.lakeHeights[index] + 0.09, lake.z);
    this.scene.add(cracks);
    });
  }

  private placeSigns() {
    for (let i = 0; i < 8; i++) {
      for (const radius of [115, 300, 560]) {
        const point = polar(radius, i * 45 + 5);
        const canvas = document.createElement("canvas");
        canvas.width = 512; canvas.height = 160;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = radius === 115 ? "#283c51" : "#287776";
        ctx.fillRect(0, 0, 512, 160);
        ctx.strokeStyle = "#e8f2f0"; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 496, 144);
        ctx.fillStyle = "white"; ctx.textAlign = "center";
        ctx.font = "600 34px sans-serif";
        ctx.fillText(PISTES[i].name, 256, 63);
        ctx.font = "24px sans-serif";
        ctx.fillText(radius === 115 ? "↓  valley route" : "↙  traverse    ·    valley  ↓", 256, 114);
        const y = this.terrain.heightAt(point.x, point.z);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide, roughness: 0.85 }));
        board.position.set(point.x, y + 3.8, point.z);
        board.rotation.y = Math.atan2(-point.x, -point.z);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 4.4, 6), clay(0x8e6b51));
        post.position.set(point.x, y + 2.2, point.z);
        post.castShadow = true;
        this.scene.add(board, post);
        this.addCollider({ x: point.x, z: point.z, r: 0.3, top: y + 4.5 });
      }
    }
  }

  private placeClouds() {
    const rand = mulberry32(5);
    const mat = clay(0xffffff, { roughness: 0.95, bump: 0.3, emissive: 0xdde8ff, emissiveIntensity: 0.35 });
    const puff = new THREE.IcosahedronGeometry(1, 3);
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(rand() * 5);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(puff, mat);
        const r = 18 + rand() * 22;
        m.scale.set(r, r * 0.75, r);
        m.position.set((k - n / 2) * 22 + rand() * 10, rand() * 10 + (k % 2) * 8, rand() * 18 - 9);
        g.add(m);
      }
      const a = rand() * Math.PI * 2;
      const d = 1700 + rand() * 2600;
      g.position.set(Math.cos(a) * d, 760 + rand() * 450, Math.sin(a) * d);
      g.rotation.y = rand() * Math.PI;
      g.userData.speed = 2 + rand() * 4;
      this.clouds.push(g);
      this.scene.add(g);
    }
  }

  update(dt: number, time: number, focus: THREE.Vector3, particles: Particles) {
    this.weather.update(dt, time, focus, this.scene, this.sun);
    this.sky.material.uniforms.storm.value = this.weather.intensity;
    for (const l of this.lifts) l.update(dt, time);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 4000) c.position.x = -4000;
    }
    // chimney smoke
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.35;
      for (const p of this.chimneys) {
        if (p.distanceToSquared(focus) > 400 * 400) continue;
        particles.emit(p, new THREE.Vector3(0.4 + Math.random() * 0.3, 1.4, Math.random() * 0.4 - 0.2), {
          life: 5,
          size: 0.6,
          grow: 1.6,
          color: 0xe9e4e1,
          gravity: -0.05,
          drag: 0.2,
        });
      }
    }
    // shadow camera follows the player, snapped to texels to avoid shimmering
    const texel = (2 * 55) / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 300);
  }
}
