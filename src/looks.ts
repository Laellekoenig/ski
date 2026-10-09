import * as THREE from "three";
import type { Character } from "./characters";
import { fuzzGeometry, gearMaterial, gearMesh, limbGeometry, printedMaterial } from "./gear";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./noise";

type Own = <T extends THREE.Material>(material: T) => T;

const DARK = 0x181d23;
const css = (color: number, k = 1) => `#${new THREE.Color(color).multiplyScalar(k).getHexString()}`;

/** Head size before scaling; the face is painted onto a stretched sphere like a console-era model. */
export const HEAD = 0.108;

/** A curved, single-piece goggle lens; +z is the covered face. */
export function visorGeometry(radius: number, height: number, spread = 2.15) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i <= 12; i++) {
      const angle = (i / 12 - 0.5) * spread;
      positions.push(Math.sin(angle) * radius, (row - 0.5) * height, Math.cos(angle) * radius);
      uv.push(i / 12, row);
      if (!row && i < 12) indices.push(i, i + 1, i + 13, i + 1, i + 14, i + 13);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Mirrored lens with a bright streak across it. */
export function lensMaterial(color: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 16, 64);
  gradient.addColorStop(0, css(color, 0.35));
  gradient.addColorStop(0.4, css(color));
  gradient.addColorStop(0.54, "#e4eef2");
  gradient.addColorStop(0.59, css(color, 0.65));
  gradient.addColorStop(1, css(color, 0.3));
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "rgba(245,250,255,0.55)";
  ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(34, 0); ctx.lineTo(69, 64); ctx.lineTo(63, 64); ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, metalness: 0.5, roughness: 0.15, side: THREE.DoubleSide });
}

/** Draws on both sides of the wrap-around seam. */
function wrapped(width: number, x: number, draw: (x: number) => void) {
  draw(x);
  if (x < width * 0.2) draw(x + width);
  if (x > width * 0.8) draw(x - width);
}

function flame(ctx: CanvasRenderingContext2D, x: number, base: number, width: number, height: number, lean: number) {
  ctx.beginPath();
  ctx.moveTo(x - width / 2, base);
  ctx.bezierCurveTo(x - width * 0.6, base - height * 0.45, x + lean * 0.2, base - height * 0.55, x + lean, base - height);
  ctx.bezierCurveTo(x + width * 0.15 + lean * 0.3, base - height * 0.5, x + width * 0.7, base - height * 0.4, x + width / 2, base);
  ctx.fill();
}

/** Jacket and sleeve fabric. The torso wraps u around the body with the front at u = 0.5, v = 0 at the hem. */
export function jacketMaterial(c: Character, own: Own) {
  return own(printedMaterial((ctx, w, h) => {
    ctx.fillStyle = css(c.jacket); ctx.fillRect(0, 0, w, h);
    if (c.print === "flames") {
      // Hot-rod flames lick up from the hem and the cuffs: red outside, then orange, yellow in the core.
      for (const [color, scale] of [[c.trim, 1], [0xff7a14, 0.8], [c.accent, 0.55]] as const) {
        ctx.fillStyle = css(color);
        const tongues = mulberry32(11);
        for (let i = 0; i < 11; i++) {
          const x = (i + 0.5) * w / 11 + (tongues() - 0.5) * 8;
          const height = (0.3 + tongues() * 0.32) * h * scale;
          const width = (w / 11) * 1.5 * scale;
          const lean = (tongues() - 0.3) * 18;
          wrapped(w, x, (at) => flame(ctx, at, h + 2, width, height, lean));
        }
      }
    } else if (c.print === "quilted") {
      // Puffer baffles: each tube is lit in the middle and stitched down at its edges.
      const rows = 9;
      for (let i = 0; i < rows; i++) {
        const top = (i / rows) * h, size = h / rows;
        const gradient = ctx.createLinearGradient(0, top, 0, top + size);
        gradient.addColorStop(0, css(c.trim));
        gradient.addColorStop(0.45, css(c.jacket, 1.08));
        gradient.addColorStop(1, css(c.trim, 0.85));
        ctx.fillStyle = gradient; ctx.fillRect(0, top, w, size);
      }
    } else if (c.print === "camo") {
      // Oversized tall tee anorak: chest stripes and a kangaroo pocket.
      ctx.fillStyle = css(c.trim); ctx.fillRect(0, h * 0.24, w, h * 0.07);
      ctx.fillStyle = "#f2f2ec"; ctx.fillRect(0, h * 0.32, w, h * 0.035);
      ctx.fillStyle = css(c.accent); ctx.fillRect(0, h * 0.36, w, h * 0.02);
      ctx.strokeStyle = css(c.jacket, 0.62); ctx.lineWidth = 3;
      ctx.strokeRect(w * 0.39, h * 0.62, w * 0.22, h * 0.2);
      ctx.fillStyle = css(c.jacket, 0.82); ctx.fillRect(0, h * 0.94, w, h * 0.06);
    } else {
      // Colour-blocked one-piece: a purple diagonal across the chest with a zigzag seam, dark hips.
      ctx.fillStyle = css(c.trim);
      ctx.beginPath(); ctx.moveTo(0, h * 0.62); ctx.lineTo(w, h * 0.32); ctx.lineTo(w, h * 0.52); ctx.lineTo(0, h * 0.82); ctx.fill();
      ctx.fillRect(0, h * 0.82, w, h);
      ctx.strokeStyle = css(c.gloves); ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) ctx.lineTo((i / 16) * w, h * (0.6 - (i / 16) * 0.3) + (i % 2 ? -7 : 7));
      ctx.stroke();
      ctx.fillStyle = css(c.accent); ctx.fillRect(0, h * 0.13, w, h * 0.025);
    }
    // Centre front zip; the tall tee only has a short one at the neck.
    ctx.fillStyle = c.print === "flames" ? "#8b8f96" : c.print === "colorblock" ? "#f2f2f2" : css(c.jacket, 0.55);
    if (c.print === "camo") ctx.fillRect(w / 2 - 1.5, 0, 3, h * 0.3);
    else ctx.fillRect(w / 2 - 1.5, 0, 3, h);
  }));
}

/** Trousers. Lathed legs wrap u around with u = 0.25 and 0.75 on the outer and inner seams. */
export function pantsMaterial(c: Character, own: Own) {
  if (c.print === "camo") {
    return own(printedMaterial((ctx, w, h) => {
      ctx.fillStyle = css(c.pants); ctx.fillRect(0, 0, w, h);
      const random = mulberry32(7);
      for (const color of [0x8f8458, 0x4c4a2e, 0x2c2a20, 0x7a6544]) {
        ctx.fillStyle = css(color);
        for (let i = 0; i < 9; i++) {
          const x = random() * w, y = random() * h, rx = 10 + random() * 18, ry = 6 + random() * 12, a = random() * Math.PI;
          wrapped(w, x, (at) => { ctx.beginPath(); ctx.ellipse(at, y, rx, ry, a, 0, Math.PI * 2); ctx.fill(); });
        }
      }
    }, 128, 128));
  }
  if (c.print === "quilted") {
    return own(printedMaterial((ctx, w, h) => {
      ctx.fillStyle = css(c.pants); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = css(c.jacket);
      for (const u of [0.25, 0.75]) ctx.fillRect(u * w - 4, 0, 8, h);
    }, 64, 64));
  }
  return gearMaterial(c.pants);
}

/** Red bandana with a white print. */
function bandanaMaterial(own: Own) {
  return own(printedMaterial((ctx, w, h) => {
    ctx.fillStyle = "#c81e28"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f6efe6";
    const random = mulberry32(3);
    for (let i = 0; i < 40; i++) {
      ctx.beginPath(); ctx.arc(random() * w, random() * h, 1.5 + random() * 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }, 64, 64));
}

/**
 * The face is painted, PS2-style: brows, eyes, lips and a hairline onto a sphere unwrapped
 * with the nose at the centre of the canvas (u = 0.5) and the crown along the top edge.
 */
function faceMaterial(c: Character, own: Own) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const female = c.gender === "female";
  const cx = 128;
  ctx.fillStyle = css(c.skin); ctx.fillRect(0, 0, 256, 128);
  // Shade under the jaw and around the sides.
  const jaw = ctx.createLinearGradient(0, 96, 0, 128);
  jaw.addColorStop(0, "rgba(90,40,30,0)"); jaw.addColorStop(1, "rgba(90,40,30,0.35)");
  ctx.fillStyle = jaw; ctx.fillRect(0, 96, 256, 32);
  // Painted hair covers the crown and the back of the head, with sideburns in front of the ears.
  // Frosted spikes and tips grow out of dark roots.
  const frosted = c.headwear === "backwards-cap";
  ctx.fillStyle = css(c.hair, frosted ? 0.3 : 1);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(256, 0); ctx.lineTo(256, 86);
  ctx.lineTo(cx + 66, 86); ctx.lineTo(cx + 58, 60); ctx.lineTo(cx + 44, 52);
  ctx.quadraticCurveTo(cx + 26, 36, cx, female ? 34 : 38);
  ctx.quadraticCurveTo(cx - 26, 36, cx - 44, 52);
  ctx.lineTo(cx - 58, 60); ctx.lineTo(cx - 66, 86); ctx.lineTo(0, 86);
  ctx.fill();
  // Cheeks.
  for (const side of [-1, 1]) {
    const blush = ctx.createRadialGradient(cx + side * 24, 78, 0, cx + side * 24, 78, 12);
    blush.addColorStop(0, female ? "rgba(235,90,110,0.35)" : "rgba(200,80,70,0.18)");
    blush.addColorStop(1, "rgba(235,90,110,0)");
    ctx.fillStyle = blush; ctx.fillRect(cx + side * 24 - 12, 66, 24, 24);
  }
  // Brows, eyes and lashes.
  const brow = css(c.hair, c.headwear === "mohawk-helmet" ? 1 : 0.38);
  for (const side of [-1, 1]) {
    const ex = cx + side * 13;
    ctx.strokeStyle = brow; ctx.lineWidth = female ? 2 : 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(ex - side * 6, 56); ctx.quadraticCurveTo(ex, 52, ex + side * 7, 56); ctx.stroke();
    ctx.fillStyle = "#f4f1ea";
    ctx.beginPath(); ctx.ellipse(ex, 63, 5.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.id === "mila" ? "#3f78b4" : c.id === "fynn" ? "#5d7a3a" : "#4a2f1e";
    ctx.beginPath(); ctx.arc(ex, 63, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex, 63, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(ex + 0.5, 61, 1, 1);
    ctx.strokeStyle = "#20130e"; ctx.lineWidth = female ? 1.8 : 1.2;
    ctx.beginPath(); ctx.ellipse(ex, 63, 5.8, 3.2, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  }
  // Nostril shadow and a grin.
  ctx.fillStyle = "rgba(90,40,30,0.35)";
  ctx.fillRect(cx - 4, 79, 8, 2);
  const lips = c.id === "mila" ? "#e0458f" : css(c.skin, 0.62);
  ctx.strokeStyle = lips; ctx.lineWidth = female ? 3 : 2.2;
  ctx.beginPath(); ctx.moveTo(cx - 8, 88); ctx.quadraticCurveTo(cx, 93, cx + 8, 87); ctx.stroke();
  if (c.headwear === "hairy-beanie") {
    // Goatee, moustache and soul patch.
    ctx.fillStyle = css(c.hair);
    ctx.beginPath();
    ctx.moveTo(cx - 11, 86); ctx.quadraticCurveTo(cx - 12, 83, cx - 6, 83.5); ctx.lineTo(cx + 6, 83.5);
    ctx.quadraticCurveTo(cx + 12, 83, cx + 11, 86); ctx.lineTo(cx + 9, 102); ctx.quadraticCurveTo(cx, 108, cx - 9, 102);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(c.skin, 0.75);
    ctx.beginPath(); ctx.ellipse(cx, 89.5, 6.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return own(new THREE.MeshStandardMaterial({ map, roughness: 0.62 }));
}

/** Rounder skull, narrower jaw, longer back of the head. */
function headGeometry() {
  const geometry = new THREE.SphereGeometry(HEAD, 22, 16, -Math.PI / 2);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const below = Math.max(0, -y / HEAD);
    x *= 0.9 * (1 - below * 0.28);
    if (z < 0) z *= 1.08 - below * 0.3;
    else z *= 1 - below * 0.08;
    y *= y < 0 ? 1.12 : 1.06;
    position.setXYZ(i, x, y, z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A dome over the head, tilted back by `tilt` so it sits on the brow at the front and low at the back. */
function cap(parent: THREE.Object3D, material: THREE.Material, radius: number, cover: number, tilt: number, y = 0.012) {
  const group = new THREE.Group();
  group.position.y = y; group.rotation.x = -tilt;
  const dome = gearMesh(new THREE.SphereGeometry(radius, 20, 10, 0, Math.PI * 2, 0, Math.PI * cover), material);
  dome.scale.set(0.93, 1.1, 1.03);
  group.add(dome);
  parent.add(group);
  return group;
}

/** Cones sprouting outward from a dome, for fake hair and frosted tips, merged into one mesh. */
function spikes(parent: THREE.Object3D, color: number, count: number, seed: number, place: (random: () => number) => { at: THREE.Vector3; dir: THREE.Vector3; length: number; radius: number }, finish: "hair" | "fabric" = "hair") {
  const random = mulberry32(seed);
  const cones: THREE.BufferGeometry[] = [];
  const turn = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const { at, dir, length, radius } = place(random);
    const cone = new THREE.ConeGeometry(radius, length, 4);
    cone.translate(0, length / 2, 0);
    turn.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    cones.push(cone.applyQuaternion(turn).translate(at.x, at.y, at.z));
  }
  parent.add(gearMesh(mergeGeometries(cones), color, finish));
  for (const cone of cones) cone.dispose();
}

/** Heathered charcoal knit, speckled like marled wool. */
function knitMaterial(own: Own) {
  return own(printedMaterial((ctx, w, h) => {
    ctx.fillStyle = "#46474b"; ctx.fillRect(0, 0, w, h);
    const random = mulberry32(21);
    for (let i = 0; i < 1800; i++) {
      const v = random();
      ctx.fillStyle = v < 0.4 ? "#232427" : v < 0.75 ? "#6a6c71" : "#9a9ca1";
      ctx.fillRect(random() * w, random() * h, 2, 2);
    }
  }, 128, 128));
}

/** A small woven label stitched onto the knit. */
function patchMaterial(own: Own, draw: (ctx: CanvasRenderingContext2D) => void, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext("2d")!);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return own(new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
}

/**
 * The novelty ski beanie: marled knit with earflaps, woven patches, and a wild shock
 * of fake hair bursting out of the whole crown, wider than the hat itself.
 */
function hairyBeanie(head: THREE.Object3D, c: Character, own: Own) {
  const knit = knitMaterial(own);
  const beanie = cap(head, knit, 0.124, 0.5, 0.12, 0.014);
  beanie.scale.y = 1.06;
  for (const side of [-1, 1]) {
    const flap = gearMesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), knit);
    flap.scale.set(0.42, 1.15, 0.95); flap.position.set(side * 0.096, -0.002, -0.012); head.add(flap);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.016), patchMaterial(own, (ctx) => {
      ctx.fillStyle = "#121315"; ctx.fillRect(0, 0, 64, 20);
      ctx.fillStyle = "#f2f2f2"; ctx.font = "italic bold 15px Arial"; ctx.fillText("SHRED", 6, 15);
    }, 64, 20));
    label.position.set(side * 0.114, 0.035, -0.004); label.rotation.y = side * Math.PI / 2;
    beanie.add(label);
  }
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), patchMaterial(own, (ctx) => {
    ctx.fillStyle = "#f4f4f2"; ctx.fillRect(0, 0, 32, 32);
    ctx.strokeStyle = css(c.trim); ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(8, 22); ctx.lineTo(25, 12); ctx.moveTo(10, 10); ctx.lineTo(22, 26);
    ctx.moveTo(16, 6); ctx.lineTo(17, 27); ctx.moveTo(6, 16); ctx.lineTo(27, 20);
    ctx.stroke();
  }, 32, 32));
  badge.position.set(0, 0.04, 0.125); badge.rotation.x = -0.32; beanie.add(badge);

  // The hair is rooted all over the crown; the outer ring splays sideways, the middle stands up.
  const shock = new THREE.Group();
  shock.position.y = 0.08; beanie.add(shock);
  const mass = gearMesh(fuzzGeometry(0.11, 7, 2), c.trim);
  mass.scale.set(1.08, 0.5, 1.08); mass.position.y = 0.015; shock.add(mass);
  const strand = (reach: number, rise: number, length: number, radius: number, rim = 0) => (random: () => number) => {
    const around = random() * Math.PI * 2, out = rim + (1 - rim) * Math.sqrt(random());
    const at = new THREE.Vector3(Math.sin(around) * out * 0.105, 0.015 + (1 - out) * 0.04, Math.cos(around) * out * 0.11);
    const dir = new THREE.Vector3(Math.sin(around) * out * reach + (random() - 0.5) * 0.6, rise + random() * 0.4, Math.cos(around) * out * reach + (random() - 0.5) * 0.6);
    return { at, dir, length: length * (0.7 + random() * 0.6), radius: radius * (0.7 + random() * 0.6) };
  };
  // Faux fur is matte: the fabric finish keeps it from reading as glass needles.
  const deep = new THREE.Color(c.trim).multiplyScalar(0.62).getHex();
  spikes(shock, deep, 60, 8, strand(1.2, 0.7, 0.06, 0.02), "fabric");
  spikes(shock, c.trim, 50, 10, strand(2.2, 0.35, 0.06, 0.018, 0.75), "fabric");
  spikes(shock, c.trim, 80, 9, strand(1.2, 0.95, 0.08, 0.013), "fabric");
}

function shades(head: THREE.Object3D, c: Character, own: Own, back: boolean) {
  const group = new THREE.Group();
  if (back) group.rotation.y = Math.PI;
  const frame = gearMesh(visorGeometry(0.128, 0.05, 1.9), DARK, "plastic");
  const lens = new THREE.Mesh(visorGeometry(0.131, 0.038, 1.7), own(lensMaterial(c.lens)));
  frame.position.y = lens.position.y = 0.012;
  group.add(frame, lens);
  head.add(group);
}

/** Head, painted face, hair and whatever is worn on it. */
export function dressHead(head: THREE.Object3D, c: Character, own: Own) {
  const skin = gearMaterial(c.skin, "skin");
  head.add(gearMesh(headGeometry(), faceMaterial(c, own)));
  const nose = gearMesh(new THREE.SphereGeometry(0.019, 8, 6), skin);
  nose.scale.set(0.8, 1.25, 1); nose.position.set(0, -0.01, 0.104); head.add(nose);
  for (const side of [-1, 1]) {
    const ear = gearMesh(new THREE.SphereGeometry(0.028, 8, 6), skin);
    ear.scale.set(0.45, 1, 0.7); ear.position.set(side * 0.094, -0.004, -0.008); head.add(ear);
  }
  const hair = gearMaterial(c.hair, "hair");

  if (c.headwear === "hairy-beanie") {
    // The fake-hair beanie, with shades worn on the back of the head.
    hairyBeanie(head, c, own);
    shades(head, c, own, true);
    const goatee = gearMesh(fuzzGeometry(0.02, 3, 1), c.hair, "hair");
    goatee.scale.set(1, 1.2, 0.7); goatee.position.set(0, -0.102, 0.078); head.add(goatee);
  } else if (c.headwear === "earmuffs") {
    // Glossy blonde hair up in a scrunchie, a fluffy pair of earmuffs and huge white sunglasses.
    cap(head, hair, 0.114, 0.6, 0.55, 0.004);
    const bangs = gearMesh(new THREE.SphereGeometry(0.06, 10, 6), hair);
    bangs.scale.set(1.25, 0.42, 0.55); bangs.position.set(0.022, 0.068, 0.078); bangs.rotation.set(0.5, 0, -0.35); head.add(bangs);
    const tail = new THREE.Group();
    tail.position.set(0, 0.085, -0.1); tail.rotation.x = 0.55; head.add(tail);
    const pony = gearMesh(limbGeometry(0.2, [0.012, 0.032, 0.044, 0.038, 0.024]), hair);
    pony.position.y = -0.11; tail.add(pony);
    const scrunchie = gearMesh(new THREE.TorusGeometry(0.026, 0.011, 6, 12), c.accent);
    scrunchie.rotation.x = Math.PI / 2; tail.add(scrunchie);
    const band = gearMesh(new THREE.TorusGeometry(0.122, 0.011, 6, 24, Math.PI), c.accent, "plastic");
    band.scale.set(1, 1.1, 1); band.position.z = -0.012; head.add(band);
    for (const side of [-1, 1]) {
      const muff = gearMesh(fuzzGeometry(0.052, side + 4), 0xf7f4f6);
      muff.scale.set(0.62, 1, 1); muff.position.set(side * 0.112, -0.004, -0.01); head.add(muff);
      const rim = gearMesh(new THREE.TorusGeometry(0.036, 0.008, 6, 16), 0xf6f6f6, "plastic");
      rim.position.set(side * 0.043, 0.006, 0.108); rim.rotation.y = side * 0.32; head.add(rim);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), own(lensMaterial(c.lens)));
      lens.position.copy(rim.position); lens.position.z += 0.002; lens.rotation.y = rim.rotation.y; head.add(lens);
      const arm = gearMesh(new THREE.BoxGeometry(0.008, 0.01, 0.1), 0xf6f6f6, "plastic");
      arm.position.set(side * 0.09, 0.008, 0.058); head.add(arm);
    }
  } else if (c.headwear === "backwards-cap") {
    // Flat-brim cap worn backwards over frosted tips, sticker still on the brim.
    const crown = cap(head, gearMaterial(c.accent), 0.117, 0.5, 0.12, 0.022);
    const brim = gearMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20, 1, false, Math.PI / 2, Math.PI), c.trim, "plastic");
    brim.scale.set(0.64, 1, 1); brim.position.y = 0.004; crown.add(brim);
    const sticker = gearMesh(new THREE.CircleGeometry(0.02, 12), 0xd8d4c8, "metal");
    sticker.rotation.x = -Math.PI / 2; sticker.position.set(0.035, 0.011, -0.165); crown.add(sticker);
    const button = gearMesh(new THREE.SphereGeometry(0.012, 6, 4), c.accent);
    button.position.y = 0.128; crown.add(button);
    // The snapback opening now sits on the forehead, hair showing through above the strap.
    const gap = gearMesh(new THREE.CircleGeometry(0.036, 12, 0, Math.PI), new THREE.Color(c.hair).multiplyScalar(0.3).getHex(), "hair");
    gap.position.set(0, 0.002, 0.123); gap.rotation.x = -0.15; crown.add(gap);
    const snap = gearMesh(new THREE.BoxGeometry(0.08, 0.012, 0.01), c.trim, "plastic");
    snap.position.set(0, 0.008, 0.126); crown.add(snap);
    spikes(head, c.hair, 9, 9, (random) => {
      const x = (random() - 0.5) * 0.15;
      return {
        at: new THREE.Vector3(x, 0.05 + random() * 0.015, 0.098 - Math.abs(x) * 0.4),
        dir: new THREE.Vector3(x * 4, -0.5 - random() * 0.5, 1),
        length: 0.045 + random() * 0.03, radius: 0.017,
      };
    });
  } else {
    // A white lid with a hot pink faux-fur crest, a chrome mirror lens, and two braids.
    const lid = cap(head, gearMaterial(0xf4f6f8, "plastic"), 0.126, 0.56, 0.12, 0.016);
    lid.scale.set(1.02, 1, 1.04);
    for (let i = 0; i < 9; i++) {
      const a = -0.95 + (i / 8) * 2.25;
      const tuft = gearMesh(fuzzGeometry(0.042, i, 1), c.accent);
      tuft.scale.set(0.36, 1.3, 0.85);
      tuft.position.set(0, Math.cos(a) * 0.15, -Math.sin(a) * 0.15);
      tuft.rotation.x = -a;
      lid.add(tuft);
    }
    const strap = gearMesh(new THREE.TorusGeometry(0.118, 0.012, 4, 24), c.trim, "rubber");
    strap.rotation.x = Math.PI / 2; strap.scale.set(0.95, 1.06, 1); strap.position.y = 0.012; head.add(strap);
    const frame = gearMesh(visorGeometry(0.128, 0.072), c.gloves, "plastic");
    frame.position.set(0, 0.016, 0.004); head.add(frame);
    const lens = new THREE.Mesh(visorGeometry(0.132, 0.056), own(lensMaterial(c.lens)));
    lens.position.set(0, 0.018, 0.006); head.add(lens);
    for (const side of [-1, 1]) {
      const braid = new THREE.Group();
      braid.position.set(side * 0.075, -0.035, -0.06); braid.rotation.set(0.2, 0, side * 0.12);
      for (let i = 0; i < 6; i++) {
        const plait = gearMesh(new THREE.SphereGeometry(0.024 - i * 0.002, 8, 6), hair);
        plait.scale.set(1, 1.3, 1); plait.position.y = -i * 0.04; braid.add(plait);
      }
      const tie = gearMesh(new THREE.SphereGeometry(0.014, 6, 4), c.accent, "plastic");
      tie.position.y = -0.235; braid.add(tie);
      head.add(braid);
    }
  }
}

/** Whatever closes the neckline: a fur collar, a bandana, or a plain rolled collar. */
export function dressNeck(torso: THREE.Object3D, c: Character, own: Own, y: number) {
  const neck = gearMesh(new THREE.CylinderGeometry(0.045, 0.052, 0.13, 10), c.skin, "skin");
  neck.position.y = y + 0.035; torso.add(neck);
  if (c.print === "quilted") {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const tuft = gearMesh(fuzzGeometry(0.042, i, 1), 0xf7f4f6);
      tuft.position.set(Math.sin(a) * 0.1, y - 0.025, Math.cos(a) * 0.09 - 0.01);
      torso.add(tuft);
    }
  } else if (c.print === "camo") {
    const bandana = bandanaMaterial(own);
    const wrap = gearMesh(new THREE.CylinderGeometry(0.066, 0.1, 0.08, 14), bandana);
    wrap.position.y = y + 0.01; torso.add(wrap);
    const knot = gearMesh(new THREE.ConeGeometry(0.075, 0.12, 3), bandana);
    knot.rotation.set(Math.PI + 0.25, Math.PI / 3, 0); knot.scale.z = 0.4;
    knot.position.set(0, y - 0.05, 0.095); torso.add(knot);
  } else if (c.print === "colorblock") {
    const collar = gearMesh(new THREE.CylinderGeometry(0.068, 0.085, 0.1, 14), c.jacket);
    collar.position.y = y + 0.02; torso.add(collar);
  } else {
    const collar = gearMesh(new THREE.TorusGeometry(0.074, 0.03, 8, 16), c.jacket);
    collar.rotation.x = Math.PI / 2; collar.position.y = y; torso.add(collar);
  }
}
