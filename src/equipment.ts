import * as THREE from "three";
import { box, gearMaterial, gearMesh } from "./gear";

const DARK = 0x181d23;
const skiTextures = new Map<string, THREE.CanvasTexture>();
const skiMaterials = new Map<string, THREE.MeshStandardMaterial>();

function topsheet(color: number, accent: number, style: string) {
  const key = `${color}:${accent}:${style}`;
  const cached = skiTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  ctx.fillStyle = hex(color); ctx.fillRect(0, 0, 64, 512);
  ctx.fillStyle = "#171d23"; ctx.fillRect(0, 175, 64, 220);
  ctx.fillStyle = hex(accent);
  if (style === "race") {
    ctx.fillRect(12, 0, 8, 512); ctx.fillRect(45, 0, 3, 512);
  } else {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 65 + i * 29); ctx.lineTo(64, 24 + i * 29);
      ctx.lineTo(64, 39 + i * 29); ctx.lineTo(0, 80 + i * 29);
      ctx.fill();
    }
    ctx.fillRect(8, 392, 48, 3);
  }
  ctx.save(); ctx.translate(32, 150); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#e4e7e4"; ctx.font = "bold 15px Arial";
  ctx.fillText("AS / 04", 0, 5); ctx.restore();
  ctx.fillStyle = "#c1c7c7"; ctx.font = "10px Arial";
  ctx.fillText("184", 22, 457);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  skiTextures.set(key, texture);
  return texture;
}

/** Continuous sidecut, rounded shovel, camber and steel edges. Points +z. */
export function makeSki(color: number, accent = 0xd6dad8, style = "freeride") {
  const ski = new THREE.Group();
  const twin = style === "park";
  const sections = [
    [-0.88, 0.032, twin ? 0.075 : 0.038], [-0.84, 0.063, twin ? 0.052 : 0.023],
    [-0.66, 0.065, 0.015], [-0.34, 0.052, 0.021], [0, 0.047, 0.027],
    [0.34, 0.056, 0.023], [0.66, 0.071, 0.026], [0.84, 0.075, 0.068],
    [0.94, 0.057, 0.116], [0.98, 0.021, 0.145],
  ];
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  sections.forEach(([z, width, y]) => {
    positions.push(-width, y, z, width, y, z, -width, y - 0.018, z, width, y - 0.018, z);
    const v = (z + 0.88) / 1.86;
    uvs.push(0, v, 1, v, 0, v, 1, v);
  });
  const geometry = new THREE.BufferGeometry();
  const strip = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, b, d, c);
  for (let i = 0; i < sections.length - 1; i++) strip(i * 4, i * 4 + 4, i * 4 + 1, i * 4 + 5);
  geometry.addGroup(0, indices.length, 0);
  const edgeStart = indices.length;
  for (let i = 0; i < sections.length - 1; i++) {
    const a = i * 4, b = a + 4;
    strip(a + 2, a + 3, b + 2, b + 3);
    strip(a, a + 2, b, b + 2);
    strip(a + 1, b + 1, a + 3, b + 3);
  }
  strip(0, 1, 2, 3);
  const end = (sections.length - 1) * 4;
  strip(end, end + 2, end + 1, end + 3);
  geometry.addGroup(edgeStart, indices.length - edgeStart, 1);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const materialKey = `${color}:${accent}:${style}`;
  let material = skiMaterials.get(materialKey);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ map: topsheet(color, accent, style), roughness: 0.35, metalness: 0.12 });
    skiMaterials.set(materialKey, material);
  }
  const board = new THREE.Mesh(geometry, [material, gearMaterial(0x79838a, "metal")]);
  board.castShadow = board.receiveShadow = true;
  ski.add(board);
  // Binding stays on the ski when the rider steps out of it.
  box(ski, DARK, [0.075, 0.022, 0.39], [0, 0.043, -0.02], "plastic");
  box(ski, 0x636c70, [0.095, 0.052, 0.085], [0, 0.069, 0.14], "metal");
  box(ski, DARK, [0.09, 0.09, 0.095], [0, 0.089, -0.175], "plastic");
  box(ski, accent, [0.052, 0.018, 0.05], [0, 0.14, -0.175], "plastic");
  for (const side of [-1, 1]) box(ski, 0xa0a6a6, [0.012, 0.018, 0.24], [side * 0.065, 0.032, -0.17], "metal");
  return ski;
}

/** Moulded shell, overlapping cuff, sole and four visible buckles. */
export function makeBoot(accent: number) {
  const boot = new THREE.Group();
  box(boot, 0x161b21, [0.145, 0.045, 0.31], [0, 0.068, 0.027], "rubber");
  const foot = gearMesh(new THREE.CylinderGeometry(0.088, 0.09, 0.26, 8), 0x30363f, "plastic");
  foot.rotation.x = Math.PI / 2;
  foot.scale.z = 0.75;
  foot.position.set(0, 0.125, 0.035);
  boot.add(foot);
  const cuff = gearMesh(new THREE.CylinderGeometry(0.076, 0.088, 0.19, 8), accent, "plastic");
  cuff.position.set(0, 0.215, -0.055); cuff.rotation.x = -0.12;
  boot.add(cuff);
  box(boot, DARK, [0.143, 0.033, 0.123], [0, 0.289, -0.06], "rubber");
  for (const y of [0.175, 0.238]) box(boot, 0xadb3b5, [0.126, 0.014, 0.022], [0, y, 0.031], "metal");
  for (const z of [0.07, 0.13]) box(boot, 0xadb3b5, [0.12, 0.018, 0.014], [0, 0.175, z], "metal");
  return boot;
}
