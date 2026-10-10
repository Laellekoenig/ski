import * as THREE from "three";
import type { Character, Print, RiderId } from "./characters";
import { fuzzGeometry, gearMaterial, gearMesh, printedMaterial } from "./gear";
import { mulberry32 } from "./noise";

/** Registers a material as belonging to one rider, so it is disposed with it. */
export type Own = <T extends THREE.Material>(material: T) => T;
type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export const css = (color: number, k = 1) => `#${new THREE.Color(color).multiplyScalar(k).getHexString()}`;

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

function star(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? inner : outer;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill();
}

/** Jacket prints. The torso wraps u around the body with the front at u = 0.5, the hem at the bottom of the canvas. */
const prints: Record<Print, (c: Character) => Paint> = {
  flames: (c) => (ctx, w, h) => {
    // Hot-rod flames lick up from the hem and the cuffs: red outside, then orange, yellow in the core.
    ctx.fillStyle = css(c.jacket); ctx.fillRect(0, 0, w, h);
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
    ctx.fillStyle = "#8b8f96"; ctx.fillRect(w / 2 - 1.5, 0, 3, h);
  },
  quilted: (c) => (ctx, w, h) => {
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
    ctx.fillStyle = css(c.jacket, 0.55); ctx.fillRect(w / 2 - 1.5, 0, 3, h);
  },
  memphis: (c) => (ctx, w, h) => {
    // Eighties Memphis confetti: squiggles, triangles and dots on white, a hot yoke and a teal hem.
    ctx.fillStyle = css(c.jacket); ctx.fillRect(0, 0, w, h);
    const random = mulberry32(5);
    for (let i = 0; i < 44; i++) {
      const x = random() * w, y = h * 0.2 + random() * h * 0.62, kind = i % 4;
      wrapped(w, x, (at) => {
        if (kind === 0) {
          ctx.strokeStyle = css(c.trim); ctx.lineWidth = 4; ctx.beginPath();
          for (let k = 0; k <= 8; k++) ctx.lineTo(at - 18 + k * 4.5, y + (k % 2 ? -5 : 5));
          ctx.stroke();
        } else if (kind === 1) {
          ctx.fillStyle = css(c.accent); ctx.beginPath();
          ctx.moveTo(at, y - 9); ctx.lineTo(at + 9, y + 7); ctx.lineTo(at - 9, y + 7); ctx.fill();
        } else if (kind === 2) {
          ctx.fillStyle = css(c.gloves); ctx.beginPath(); ctx.arc(at, y, 6, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = "#16161a"; ctx.save(); ctx.translate(at, y); ctx.rotate(random() * 3); ctx.fillRect(-7, -2, 14, 4); ctx.restore();
        }
      });
    }
    ctx.fillStyle = css(c.accent); ctx.fillRect(0, 0, w, h * 0.17);
    ctx.fillStyle = "#16161a"; ctx.fillRect(0, h * 0.17, w, h * 0.02);
    ctx.fillStyle = css(c.trim); ctx.fillRect(0, h * 0.86, w, h * 0.14);
    ctx.fillStyle = css(c.gloves); ctx.fillRect(0, h * 0.84, w, h * 0.02);
    ctx.fillStyle = "#16161a"; ctx.fillRect(w / 2 - 1.5, 0, 3, h);
  },
  lightning: (c) => (ctx, w, h) => {
    // A speed suit with white bolts cracking down the chest and red side panels.
    ctx.fillStyle = css(c.jacket); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = css(c.accent);
    for (const u of [0.25, 0.75]) ctx.fillRect(u * w - 9, 0, 18, h);
    const bolt = (x: number, y: number, s: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + 26 * s, y); ctx.lineTo(x + 12 * s, y + 34 * s); ctx.lineTo(x + 28 * s, y + 34 * s);
      ctx.lineTo(x - 4 * s, y + 86 * s); ctx.lineTo(x + 6 * s, y + 48 * s); ctx.lineTo(x - 10 * s, y + 48 * s);
      ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = css(c.trim);
    bolt(w * 0.55, h * 0.06, 1.5);
    bolt(w * 0.05, h * 0.3, 1.1);
    bolt(w * 0.88, h * 0.3, 1.1);
    ctx.fillRect(0, h * 0.93, w, h * 0.07);
  },
  holo: (c) => (ctx, w, h) => {
    // Holographic foil: hues that slide around the body, a mirror streak, and puffer baffles over it.
    const foil = ctx.createLinearGradient(0, 0, w, h * 0.4);
    ["#f2c6ff", "#bff6ec", "#d8d6ff", "#ffd7ec", "#c9f0ff", "#f2c6ff"].forEach((color, i, all) => foil.addColorStop(i / (all.length - 1), color));
    ctx.fillStyle = foil; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    for (const x of [0.18, 0.6]) {
      ctx.beginPath(); ctx.moveTo(w * x, 0); ctx.lineTo(w * x + 30, 0); ctx.lineTo(w * x - 30, h); ctx.lineTo(w * x - 50, h); ctx.fill();
    }
    const rows = 8;
    for (let i = 0; i < rows; i++) {
      const top = (i / rows) * h, size = h / rows;
      const shade = ctx.createLinearGradient(0, top, 0, top + size);
      shade.addColorStop(0, "rgba(90,70,140,0.35)"); shade.addColorStop(0.45, "rgba(255,255,255,0.12)"); shade.addColorStop(1, "rgba(90,70,140,0.3)");
      ctx.fillStyle = shade; ctx.fillRect(0, top, w, size);
    }
    ctx.fillStyle = css(c.accent); ctx.fillRect(w / 2 - 2, 0, 4, h);
  },
  tiedye: (c) => (ctx, w, h) => {
    // A spiral tie-dye hoodie, twisted from the belly, with a kangaroo pocket.
    const colors = [c.jacket, c.accent, 0xe8337c, c.trim].map((color) => new THREE.Color(color));
    const pixels = ctx.createImageData(w, h);
    const mix = new THREE.Color();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let dx = x - w / 2; if (dx > w / 2) dx -= w; if (dx < -w / 2) dx += w;
        const dy = y - h * 0.6;
        const turn = (Math.atan2(dy, dx * 0.8) / (Math.PI * 2) + Math.hypot(dx, dy) * 0.012 + Math.sin(x * 0.11 + y * 0.07) * 0.03) * 4;
        const band = ((turn % 4) + 4) % 4, i = Math.floor(band), f = band - i;
        mix.copy(colors[i]).lerp(colors[(i + 1) % 4], THREE.MathUtils.smoothstep(f, 0.55, 1));
        const k = (y * w + x) * 4;
        pixels.data[k] = mix.r * 255; pixels.data[k + 1] = mix.g * 255; pixels.data[k + 2] = mix.b * 255; pixels.data[k + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    ctx.strokeStyle = "rgba(40,20,60,0.55)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.36, h * 0.88); ctx.lineTo(w * 0.4, h * 0.6); ctx.lineTo(w * 0.6, h * 0.6); ctx.lineTo(w * 0.64, h * 0.88); ctx.stroke();
    ctx.fillStyle = "rgba(40,20,60,0.55)"; ctx.fillRect(0, h * 0.92, w, h * 0.08);
  },
  shark: (c) => (ctx, w, h) => {
    // A shark onesie: slate back, white belly, gill slits behind the arms.
    ctx.fillStyle = css(c.jacket); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = css(c.jacket, 0.82); ctx.fillRect(0, 0, w * 0.12, h); ctx.fillRect(w * 0.88, 0, w * 0.12, h);
    ctx.fillStyle = css(c.trim);
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.62, w * 0.17, h * 0.46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(c.jacket, 0.55); ctx.lineWidth = 3; ctx.lineCap = "round";
    for (const u of [0.28, 0.72]) {
      for (let k = 0; k < 3; k++) {
        const x = w * u + (u < 0.5 ? -k : k) * 7;
        ctx.beginPath(); ctx.moveTo(x, h * 0.2); ctx.quadraticCurveTo(x + (u < 0.5 ? -4 : 4), h * 0.28, x, h * 0.36); ctx.stroke();
      }
    }
    ctx.fillStyle = css(c.gloves); ctx.fillRect(w / 2 - 1.5, 0, 3, h * 0.55);
  },
};

/** Jacket and sleeve fabric. */
export function jacketMaterial(c: Character, own: Own) {
  return own(printedMaterial(prints[c.print](c)));
}

/** Trousers with stripes down the outer and inner seams (u = 0.25 and 0.75 on the lathed legs). */
function seamStripes(base: number, stripes: [color: number, offset: number, width: number][]): Paint {
  return (ctx, w, h) => {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, w, h);
    for (const u of [0.25, 0.75]) for (const [color, offset, width] of stripes) {
      ctx.fillStyle = css(color); ctx.fillRect(u * w + offset - width / 2, 0, width, h);
    }
  };
}

export function pantsMaterial(c: Character, own: Own) {
  const stripes: Partial<Record<Print, [number, number, number][]>> = {
    quilted: [[c.jacket, 0, 8]],
    lightning: [[c.trim, 0, 5], [c.accent, 7, 5]],
    holo: [[c.trim, -4, 5], [c.accent, 4, 5]],
  };
  const seams = stripes[c.print];
  return seams ? own(printedMaterial(seamStripes(c.pants, seams), 64, 64)) : gearMaterial(c.pants);
}

function liner(ctx: CanvasRenderingContext2D, cx: number, width: number) {
  ctx.strokeStyle = "#1a0f12"; ctx.lineWidth = width; ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    const ex = cx + side * 13;
    ctx.beginPath(); ctx.moveTo(ex - side * 5, 60.5); ctx.quadraticCurveTo(ex, 58.5, ex + side * 6, 61); ctx.lineTo(ex + side * 10, 57.5); ctx.stroke();
  }
}

/** Facial hair, make-up and freckles painted over the finished face. */
const faceDetails: Partial<Record<RiderId, (ctx: CanvasRenderingContext2D, c: Character, cx: number) => void>> = {
  beni(ctx, c, cx) {
    // Goatee, moustache and soul patch.
    ctx.fillStyle = css(c.hair);
    ctx.beginPath();
    ctx.moveTo(cx - 11, 86); ctx.quadraticCurveTo(cx - 12, 83, cx - 6, 83.5); ctx.lineTo(cx + 6, 83.5);
    ctx.quadraticCurveTo(cx + 12, 83, cx + 11, 86); ctx.lineTo(cx + 9, 102); ctx.quadraticCurveTo(cx, 108, cx - 9, 102);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(c.skin, 0.75);
    ctx.beginPath(); ctx.ellipse(cx, 89.5, 6.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  },
  rex(ctx, c, cx) {
    // A proper horseshoe moustache.
    ctx.fillStyle = css(c.hair, 0.8);
    ctx.beginPath(); ctx.roundRect(cx - 14, 81.5, 28, 5.5, 2.5); ctx.fill();
    ctx.fillRect(cx - 14, 84, 4, 13); ctx.fillRect(cx + 10, 84, 4, 13);
  },
  zoe(ctx, c, cx) {
    // Winged liner, lilac shadow and glitter stars on the cheekbones.
    liner(ctx, cx, 1.6);
    ctx.fillStyle = "rgba(200,140,255,0.45)";
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + side * 13, 58.5, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
    for (const [x, y, r, color] of [[-26, 72, 3.2, "#ffffff"], [-21, 77, 2, css(c.accent)], [24, 73, 3.2, "#ffffff"], [29, 69, 2, css(c.lens)]] as const) {
      ctx.fillStyle = color; star(ctx, cx + x, y, r, r * 0.3, 4);
    }
  },
  dex(ctx, c, cx) {
    // A thin moustache and a chin tuft.
    ctx.fillStyle = css(c.hair);
    ctx.beginPath(); ctx.ellipse(cx, 97, 3.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - 9, 82.5, 18, 2.2);
  },
  pip(ctx, c, cx) {
    const random = mulberry32(19);
    ctx.fillStyle = css(c.hair, 0.75);
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1, x = cx + side * (6 + random() * 24), y = 69 + random() * 11;
      ctx.beginPath(); ctx.arc(x, y, 0.9 + random() * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  },
};

/**
 * The face is painted, PS2-style: brows, eyes, lips and a hairline onto a sphere unwrapped
 * with the nose at the centre of the canvas (u = 0.5) and the crown along the top edge.
 */
export function faceMaterial(c: Character, own: Own) {
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
  ctx.fillStyle = css(c.hair);
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
  const brow = css(c.hair, 0.38);
  for (const side of [-1, 1]) {
    const ex = cx + side * 13;
    ctx.strokeStyle = brow; ctx.lineWidth = female ? 2 : 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(ex - side * 6, 56); ctx.quadraticCurveTo(ex, 52, ex + side * 7, 56); ctx.stroke();
    ctx.fillStyle = "#f4f1ea";
    ctx.beginPath(); ctx.ellipse(ex, 63, 5.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.eyes !== undefined ? css(c.eyes) : "#4a2f1e";
    ctx.beginPath(); ctx.arc(ex, 63, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex, 63, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(ex + 0.5, 61, 1, 1);
    ctx.strokeStyle = "#20130e"; ctx.lineWidth = female ? 1.8 : 1.2;
    ctx.beginPath(); ctx.ellipse(ex, 63, 5.8, 3.2, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  }
  // Nostril shadow and a grin.
  ctx.fillStyle = "rgba(90,40,30,0.35)";
  ctx.fillRect(cx - 4, 79, 8, 2);
  ctx.strokeStyle = c.lips !== undefined ? css(c.lips) : css(c.skin, 0.62);
  ctx.lineWidth = female ? 3 : 2.2;
  ctx.beginPath(); ctx.moveTo(cx - 8, 88); ctx.quadraticCurveTo(cx, 93, cx + 8, 87); ctx.stroke();
  faceDetails[c.id]?.(ctx, c, cx);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return own(new THREE.MeshStandardMaterial({ map, roughness: 0.62 }));
}

/** A race number on a white plate with stripes in the accent colour. */
function bibMaterial(c: Character, own: Own, number: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f6f6f2"; ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = css(c.accent); ctx.fillRect(0, 0, 64, 7); ctx.fillRect(0, 41, 64, 7);
  ctx.fillStyle = "#121214"; ctx.font = "bold 30px Arial"; ctx.textAlign = "center"; ctx.fillText(number, 32, 36);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return own(new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
}

function rolledCollar(torso: THREE.Object3D, color: number, y: number, radius = 0.074, tube = 0.03) {
  const collar = gearMesh(new THREE.TorusGeometry(radius, tube, 8, 16), color);
  collar.rotation.x = Math.PI / 2; collar.position.y = y; torso.add(collar);
}

/** Whatever closes the neckline, and anything else worn on the body. */
const necklines: Record<Print, (torso: THREE.Object3D, c: Character, own: Own, y: number) => void> = {
  flames: (torso, c, _own, y) => rolledCollar(torso, c.jacket, y),
  memphis: (torso, c, _own, y) => rolledCollar(torso, c.jacket, y),
  holo: (torso, c, _own, y) => rolledCollar(torso, c.trim, y, 0.08, 0.034),
  quilted(torso, _c, _own, y) {
    // A fluffy faux-fur collar.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const tuft = gearMesh(fuzzGeometry(0.042, i, 1), 0xf7f4f6);
      tuft.position.set(Math.sin(a) * 0.1, y - 0.025, Math.cos(a) * 0.09 - 0.01);
      torso.add(tuft);
    }
  },
  lightning(torso, c, own, y) {
    // A high race collar, and a start number on the chest and back.
    const collar = gearMesh(new THREE.CylinderGeometry(0.062, 0.078, 0.09, 14), c.jacket);
    collar.position.y = y + 0.02; torso.add(collar);
    const plate = bibMaterial(c, own, "07");
    for (const side of [1, -1]) {
      const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.12), plate);
      bib.position.set(0, 0.24, side > 0 ? 0.124 : -0.108);
      bib.rotation.set(side * 0.16, side > 0 ? 0 : Math.PI, 0);
      torso.add(bib);
    }
  },
  tiedye(torso, c, _own, y) {
    // The hood lies bunched up behind the neck, drawstrings dangling.
    const hood = gearMesh(new THREE.TorusGeometry(0.085, 0.04, 8, 16), c.trim);
    hood.rotation.x = Math.PI / 2; hood.position.y = y - 0.005; torso.add(hood);
    const bulk = gearMesh(new THREE.SphereGeometry(0.085, 12, 8), c.trim);
    bulk.scale.set(1.25, 0.75, 0.7); bulk.position.set(0, y + 0.01, -0.1); torso.add(bulk);
    for (const side of [-1, 1]) {
      const string = gearMesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 4), 0xf2f0ea);
      string.position.set(side * 0.032, y - 0.08, 0.118); string.rotation.x = -0.12; torso.add(string);
    }
  },
  shark(torso, c) {
    // No collar under the hood, but a tail fin on the lower back.
    const tail = new THREE.Shape();
    tail.moveTo(0, 0); tail.quadraticCurveTo(0.06, 0.02, 0.13, 0.11); tail.quadraticCurveTo(0.1, 0.02, 0.12, -0.02);
    tail.quadraticCurveTo(0.1, -0.05, 0.12, -0.09); tail.quadraticCurveTo(0.06, -0.03, 0, -0.04); tail.closePath();
    const fin = gearMesh(new THREE.ExtrudeGeometry(tail, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }).translate(0, 0, -0.01), c.jacket);
    fin.rotation.y = Math.PI / 2; fin.position.set(0, -0.02, -0.11); torso.add(fin);
  },
};

/** The neck, and whatever closes the neckline: a collar, a hood, fur, or nothing at all. */
export function dressNeck(torso: THREE.Object3D, c: Character, own: Own, y: number) {
  const neck = gearMesh(new THREE.CylinderGeometry(0.045, 0.052, 0.13, 10), c.skin, "skin");
  neck.position.y = y + 0.035; torso.add(neck);
  necklines[c.print](torso, c, own, y);
}
