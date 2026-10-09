import * as THREE from "three";
import { mulberry32 } from "./noise";

type Finish = "fabric" | "plastic" | "rubber" | "metal";
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
      roughness: { fabric: 0.91, plastic: 0.36, rubber: 0.95, metal: 0.28 }[finish],
      metalness: finish === "metal" ? 0.75 : 0,
    });
    materials.set(key, material);
  }
  return material;
}

export function gearMesh(geometry: THREE.BufferGeometry, color: number, finish: Finish = "fabric") {
  const part = new THREE.Mesh(geometry, gearMaterial(color, finish));
  part.castShadow = part.receiveShadow = true;
  return part;
}

export function box(parent: THREE.Object3D, color: number, size: [number, number, number], at: [number, number, number], finish: Finish = "fabric") {
  const part = gearMesh(new THREE.BoxGeometry(...size), color, finish);
  part.position.set(...at);
  parent.add(part);
  return part;
}

/** Octagonal sections create shoulders, a waist and a hem instead of a pill-shaped body. */
export function shellGeometry(rings: { y: number; width: number; depth: number }[]) {
  const section = [[-0.72, 1], [0.72, 1], [1, 0.55], [1, -0.55], [0.72, -1], [-0.72, -1], [-1, -0.55], [-1, 0.55]];
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  rings.forEach((ring, r) => {
    for (let i = 0; i <= 8; i++) {
      const [x, z] = section[i % 8];
      positions.push(x * ring.width / 2, ring.y, z * ring.depth / 2);
      uv.push(i / 8, r / (rings.length - 1));
      if (r < rings.length - 1 && i < 8) {
        const a = r * 9 + i, b = a + 9;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  for (let i = 1; i < 7; i++) {
    indices.push(0, i + 1, i);
    const top = (rings.length - 1) * 9;
    indices.push(top, top + i, top + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
