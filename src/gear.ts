import * as THREE from "three";
import { mulberry32 } from "./noise";

type Finish = "fabric" | "plastic" | "rubber" | "metal" | "skin" | "hair";
const materials = new Map<string, THREE.MeshStandardMaterial>();
let fabricMap: THREE.CanvasTexture | undefined;

/** Small baked weave and folds, like the painted textures on console-era models. */
function fabricTexture() {
  if (fabricMap) return fabricMap;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const random = mulberry32(42);
  const pixels = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const fold = Math.sin(y * 0.1 + Math.sin(x * 0.05) * 2) * 5;
      const weave = (x % 2 === y % 2 ? 3 : -3) + random() * 5;
      const value = 235 + fold + weave;
      const i = (y * 128 + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  fabricMap = new THREE.CanvasTexture(canvas);
  fabricMap.colorSpace = THREE.SRGBColorSpace;
  fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping;
  fabricMap.anisotropy = 4;
  return fabricMap;
}

/** Clothing has a matte finish; hard equipment gets its own specular response. */
export function gearMaterial(color: number, finish: Finish = "fabric") {
  const key = `${color}:${finish}`;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      map: finish === "fabric" ? fabricTexture() : null,
      roughness: { fabric: 0.91, plastic: 0.36, rubber: 0.95, metal: 0.28, skin: 0.62, hair: 0.55 }[finish],
      metalness: finish === "metal" ? 0.75 : 0,
    });
    materials.set(key, material);
  }
  return material;
}

/** Printed fabric: a pattern painted onto a canvas, with the shared weave pressed into it. */
export function printedMaterial(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, width = 256, height = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, width, height);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = ctx.createPattern(fabricTexture().image as HTMLCanvasElement, "repeat")!;
  ctx.fillRect(0, 0, width, height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.88 });
}

export function gearMesh(geometry: THREE.BufferGeometry, color: number | THREE.Material, finish: Finish = "fabric") {
  const part = new THREE.Mesh(geometry, typeof color === "number" ? gearMaterial(color, finish) : color);
  part.castShadow = part.receiveShadow = true;
  return part;
}

export function box(parent: THREE.Object3D, color: number, size: [number, number, number], at: [number, number, number], finish: Finish = "fabric") {
  const part = gearMesh(new THREE.BoxGeometry(...size), color, finish);
  part.position.set(...at);
  parent.add(part);
  return part;
}

/** Smooth, slightly squared sections, like a lathed console-era body. +z (u = 0.5) is the front. */
export function loftGeometry(rings: { y: number; width: number; depth: number; z?: number }[], segments = 18, squareness = 2.6) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const bottom = rings[0].y, top = rings[rings.length - 1].y;
  const row = segments + 1;
  const curve = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / squareness);
  rings.forEach((ring, r) => {
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments - 0.5) * Math.PI * 2;
      positions.push(curve(Math.sin(angle)) * ring.width / 2, ring.y, (ring.z ?? 0) + curve(Math.cos(angle)) * ring.depth / 2);
      uv.push(i / segments, (ring.y - bottom) / (top - bottom));
      if (r < rings.length - 1 && i < segments) {
        const a = r * row + i, b = a + row;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  // A flat cap closes the hem; a shallow dome closes the neck.
  for (const [r, cap] of [[0, -1], [rings.length - 1, 1]] as const) {
    const ring = rings[r];
    const pole = positions.length / 3;
    positions.push(0, ring.y + Math.max(0, cap) * Math.min(ring.width, ring.depth) * 0.12, ring.z ?? 0);
    uv.push(0.5, cap > 0 ? 1 : 0);
    for (let i = 0; i < segments; i++) {
      const a = r * row + i;
      if (cap > 0) indices.push(a, a + 1, pole);
      else indices.push(a + 1, a, pole);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The texture seam runs down the back; blend its normals so it does not crease.
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  for (let r = 0; r < rings.length; r++) {
    const a = r * row, b = a + segments;
    const n = new THREE.Vector3().fromBufferAttribute(normal, a).add(new THREE.Vector3().fromBufferAttribute(normal, b)).normalize();
    normal.setXYZ(a, n.x, n.y, n.z); normal.setXYZ(b, n.x, n.y, n.z);
  }
  return geometry;
}

/**
 * A tapered, rounded limb along y, centred on its joints, with `radii` spaced evenly from the lower joint
 * to the upper one. Rounded ends overlap the neighbouring joints; an open hem flares over a boot or glove.
 */
export function limbGeometry(length: number, radii: number[], { hem = 0, segments = 12 } = {}) {
  const points: THREE.Vector2[] = [];
  const low = radii[0], high = radii[radii.length - 1];
  if (hem) {
    points.push(new THREE.Vector2(0, -length / 2 - hem + 0.01), new THREE.Vector2(low * 0.92, -length / 2 - hem + 0.005), new THREE.Vector2(low, -length / 2 - hem));
  } else {
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * Math.PI / 2;
      points.push(new THREE.Vector2(Math.cos(a) * low, -length / 2 + Math.sin(a) * low));
    }
  }
  radii.forEach((r, i) => points.push(new THREE.Vector2(r, -length / 2 + (i / (radii.length - 1)) * length)));
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * Math.PI / 2;
    points.push(new THREE.Vector2(Math.max(Math.cos(a) * high, 0), length / 2 + Math.sin(a) * high));
  }
  return new THREE.LatheGeometry(points, segments);
}

/** A lumpy ball of fleece or faux fur; displacement is keyed on position so shared corners stay closed. */
export function fuzzGeometry(radius: number, seed = 1, detail = 2) {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const h = Math.sin(p.x * 431.7 + p.y * 911.3 + p.z * 263.9 + seed * 17.1) * 43758.5453;
    p.multiplyScalar(0.86 + (h - Math.floor(h)) * 0.3);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
