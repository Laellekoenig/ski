import * as THREE from "three";
import { mulberry32 } from "./noise";

// Procedural "thumb-pressed clay" normal maps and a soft clay material with a gentle rim light.

function heightToNormalTexture(hgt: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Tileable height built from many soft dents and smudges. */
function blobHeight(size: number, seed: number, count: number, rMin: number, rMax: number, smudge: number) {
  const rand = mulberry32(seed);
  const h = new Float32Array(size * size);
  for (let n = 0; n < count; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = rMin + rand() * (rMax - rMin);
    const sign = rand() < 0.65 ? -1 : 1;
    // elongated smudge
    const ang = rand() * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const stretch = 1 + rand() * smudge;
    const R = Math.ceil(r * stretch);
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        const u = (ox * ca + oy * sa) / stretch;
        const v = -ox * sa + oy * ca;
        const d2 = (u * u + v * v) / (r * r);
        if (d2 >= 1) continue;
        const f = (1 - d2) * (1 - d2);
        const px = (Math.floor(cx) + ox + size) % size;
        const py = (Math.floor(cy) + oy + size) % size;
        h[py * size + px] += sign * f;
      }
    }
  }
  return h;
}

let _clayNormal: THREE.Texture | null = null;
export function clayNormalMap() {
  if (!_clayNormal) _clayNormal = heightToNormalTexture(blobHeight(256, 3, 420, 4, 16, 1.5), 256, 1.4);
  return _clayNormal;
}

let _snowNormal: THREE.Texture | null = null;
export function snowNormalMap() {
  if (!_snowNormal) _snowNormal = heightToNormalTexture(blobHeight(256, 11, 260, 8, 28, 0.6), 256, 0.9);
  return _snowNormal;
}

const RIM_CHUNK = /* glsl */ `
  {
    float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
    rimF = pow(rimF, 2.6);
    outgoingLight += rimF * (0.22 * diffuseColor.rgb + vec3(0.05, 0.06, 0.08));
  }
  #include <opaque_fragment>
`;

function addRim(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", RIM_CHUNK);
  };
  return mat;
}

const GLINT_CHUNK = /* glsl */ `
  {
    // Sunlit snow crystals: a sparse scatter of points that flash as the eye moves past them.
    vec2 gp = vGlintPos.xz * 7.0;
    vec2 cell = floor(gp);
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 eye = normalize(cameraPosition - vGlintPos);
    float glint = pow(max(sin(h * 6.283 + dot(eye, vec3(7.1, 4.7, 9.3))), 0.0), 80.0);
    float px = length(fwidth(gp));
    float r = max(0.035, 0.55 * px);
    vec2 center = 0.5 + (vec2(h, fract(h * 13.7)) - 0.5) * 0.6;
    vec2 offset = fract(gp) - center;
    // Keep the reflected energy constant when antialiasing a subpixel crystal.
    float dotShape = exp(-dot(offset, offset) / (r * r)) * pow(0.035 / r, 2.0);
    // fade out before crystals shrink below a pixel and turn into noise
    float fade = (1.0 - smoothstep(8.0, 24.0, length(cameraPosition - vGlintPos))) * (1.0 - smoothstep(0.3, 0.8, px));
    float sunLit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3, 0.6, 0.1)) * 1.4, 0.0, 1.0);
    float sparse = step(0.82, fract(h * 21.7));
    outgoingLight += vec3(1.0, 0.985, 0.955) * 0.55 * sparse * glint * dotShape * fade * sunLit;
  }
`;

/** Lets sunlit snow glitter. */
export function addSnowGlints(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 vGlintPos;\n" + shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n  vGlintPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
    shader.fragmentShader = "varying vec3 vGlintPos;\n" + shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      GLINT_CHUNK + "#include <opaque_fragment>",
    );
  };
  return mat;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

export interface ClayOpts {
  roughness?: number;
  bump?: number;
  emissive?: number;
  emissiveIntensity?: number;
}

/** Soft, slightly lumpy clay material. */
export function clay(color: THREE.ColorRepresentation, opts: ClayOpts = {}): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${opts.roughness ?? ""}|${opts.bump ?? ""}|${opts.emissive ?? ""}|${opts.emissiveIntensity ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    const bump = opts.bump ?? 0.55;
    m = addRim(
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: opts.roughness ?? 0.72,
        metalness: 0,
        normalMap: clayNormalMap(),
        normalScale: new THREE.Vector2(bump, bump),
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 1,
      }),
    );
    cache.set(key, m);
  }
  return m;
}

let _vc: THREE.MeshStandardMaterial | null = null;
/** Clay material driven by vertex colours, for merged/instanced props. */
export function clayVC() {
  if (!_vc) {
    _vc = addRim(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.75,
        metalness: 0,
        normalMap: clayNormalMap(),
        normalScale: new THREE.Vector2(0.5, 0.5),
      }),
    );
  }
  return _vc;
}
