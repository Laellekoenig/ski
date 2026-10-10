import * as THREE from "three";
import type { Character, Headwear } from "./characters";
import { fuzzGeometry, gearMaterial, gearMesh, limbGeometry, printedMaterial } from "./gear";
import { css, faceMaterial, type Own } from "./looks";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./noise";

const DARK = 0x181d23;
const GOLD = 0xd9b04a;
const SILVER = 0xc9d0d6;
const FRONT = new THREE.Vector3(0, 0, 1);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Head size before scaling; the face is painted onto a stretched sphere like a console-era model. */
const HEAD = 0.108;

/** A curved, single-piece goggle lens; +z is the covered face. */
function visorGeometry(radius: number, height: number, spread = 2.15) {
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
function lensMaterial(color: number) {
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

/** Cones sprouting outward from a dome, for fake hair, frosted tips and teeth, merged into one mesh. */
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

/** A horizontal ring segment of `arc` radians, centred on the front of the head. */
function frontArc(radius: number, tube: number, arc: number) {
  return new THREE.TorusGeometry(radius, tube, 6, 20, arc).rotateX(Math.PI / 2).rotateY(arc / 2 - Math.PI / 2);
}

/** Points `object`'s +z along `dir`, for things pinned flat against the head. */
function facing<T extends THREE.Object3D>(object: T, dir: THREE.Vector3) {
  object.quaternion.setFromUnitVectors(FRONT, dir.clone().normalize());
  return object;
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

/** A small woven label stitched onto fabric. */
function patchMaterial(own: Own, draw: (ctx: CanvasRenderingContext2D) => void, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext("2d")!);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return own(new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
}

/** Wrap-around shades, worn on the face or pushed round to the back of the head. */
function shades(head: THREE.Object3D, c: Character, own: Own, back: boolean) {
  const group = new THREE.Group();
  if (back) group.rotation.y = Math.PI;
  const frame = gearMesh(visorGeometry(0.128, 0.05, 1.9), DARK, "plastic");
  const lens = new THREE.Mesh(visorGeometry(0.131, 0.038, 1.7), own(lensMaterial(c.lens)));
  frame.position.y = lens.position.y = 0.012;
  group.add(frame, lens);
  head.add(group);
}

/** Two lenses with frames, a bridge and arms; `lens` and `rim` make the geometry for each side. */
function glasses(head: THREE.Object3D, c: Character, own: Own, lens: () => THREE.BufferGeometry, rim: () => THREE.BufferGeometry, frame: number, spread = 0.042) {
  const glass = own(lensMaterial(c.lens));
  for (const side of [-1, 1]) {
    const pane = new THREE.Mesh(lens(), glass);
    pane.position.set(side * spread, 0.006, 0.112); pane.rotation.y = side * 0.32; head.add(pane);
    const edge = gearMesh(rim(), frame, "metal");
    edge.position.set(side * spread, 0.006, 0.109); edge.rotation.y = side * 0.32; head.add(edge);
    const arm = gearMesh(new THREE.BoxGeometry(0.006, 0.008, 0.1), frame, "metal");
    arm.position.set(side * 0.092, 0.01, 0.058); head.add(arm);
  }
  const bridge = gearMesh(new THREE.BoxGeometry(spread * 0.7, 0.005, 0.005), frame, "metal");
  bridge.position.set(0, 0.016, 0.118); head.add(bridge);
}

/** Hair, hats and everything else worn on the head. The head faces +z. */
const headwear: Record<Headwear, (head: THREE.Object3D, c: Character, own: Own) => void> = {
  "hairy-beanie"(head, c, own) {
    // The novelty ski beanie: marled knit with earflaps, woven patches, and a wild shock of fake hair
    // bursting out of the whole crown, wider than the hat itself. Shades sit on the back of the head.
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

    shades(head, c, own, true);
    const goatee = gearMesh(fuzzGeometry(0.02, 3, 1), c.hair, "hair");
    goatee.scale.set(1, 1.2, 0.7); goatee.position.set(0, -0.102, 0.078); head.add(goatee);
  },
  earmuffs(head, c, own) {
    // Glossy blonde hair up in a scrunchie, a fluffy pair of earmuffs and huge white sunglasses.
    const hair = gearMaterial(c.hair, "hair");
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
  },
  mullet(head, c, own) {
    // Business up front, party in the back, under a neon sweatband and gold aviators.
    const hair = gearMaterial(c.hair, "hair");
    cap(head, hair, 0.116, 0.55, 0.3, 0.008);
    spikes(head, c.hair, 16, 31, (random) => {
      const x = (random() - 0.5) * 0.17;
      return { at: V(x, 0.082 + random() * 0.015, 0.025 - Math.abs(x) * 0.3 + random() * 0.03), dir: V(x * 4, 1, 0.4 + random() * 0.3), length: 0.05 + random() * 0.025, radius: 0.024 };
    });
    const party = new THREE.Group();
    party.position.set(0, 0.01, -0.07); party.rotation.x = 0.16; head.add(party);
    const mane = gearMesh(limbGeometry(0.17, [0.07, 0.085, 0.09, 0.08]), hair);
    mane.scale.set(1.2, 1, 0.55); mane.position.y = -0.085; party.add(mane);
    spikes(party, c.hair, 16, 32, (random) => {
      const x = (random() - 0.5) * 0.17;
      return { at: V(x, -0.15, random() * 0.02), dir: V(x * 3, -1, -0.3 - random() * 0.3), length: 0.04 + random() * 0.03, radius: 0.017 };
    });
    const band = gearMesh(new THREE.TorusGeometry(0.11, 0.018, 6, 24), c.accent);
    band.rotation.x = Math.PI / 2 + 0.12; band.scale.set(0.92, 1.08, 1); band.position.y = 0.048; head.add(band);
    glasses(head, c, own, () => new THREE.CircleGeometry(0.03, 16).scale(1.15, 0.9, 1), () => new THREE.TorusGeometry(0.031, 0.0035, 4, 16).scale(1.15, 0.9, 1), GOLD);
  },
  "race-helmet"(head, c, own) {
    // A full-face race lid: white shell, team stripes, gold mirror visor and a little spoiler.
    const shell = gearMaterial(0xf4f6f8, "plastic");
    const lid = cap(head, shell, 0.134, 0.64, 0.05, 0.004);
    for (const [x, color] of [[-0.026, c.jacket], [0.026, c.jacket], [0, c.accent]] as const) {
      const stripe = gearMesh(new THREE.TorusGeometry(0.1355, 0.009, 4, 24, Math.PI * 0.72), color, "plastic");
      stripe.rotation.set(0, Math.PI / 2, 0.08); stripe.scale.set(1.03, 1.1, 1); stripe.position.x = x;
      lid.add(stripe);
    }
    const chin = gearMesh(frontArc(0.108, 0.034, 2.6), shell);
    chin.scale.set(0.95, 1.25, 1.02); chin.position.y = -0.075; head.add(chin);
    const vent = gearMesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), DARK, "plastic");
    vent.position.set(0, -0.07, 0.142); head.add(vent);
    const frame = gearMesh(visorGeometry(0.136, 0.086, 2.4), DARK, "plastic");
    frame.position.y = 0.006; head.add(frame);
    const visor = new THREE.Mesh(visorGeometry(0.14, 0.07, 2.3), own(lensMaterial(c.lens)));
    visor.position.y = 0.008; head.add(visor);
    const spoiler = gearMesh(new THREE.BoxGeometry(0.1, 0.014, 0.05), c.accent, "plastic");
    spoiler.position.set(0, 0.035, -0.145); spoiler.rotation.x = -0.45; head.add(spoiler);
  },
  "space-buns"(head, c, own) {
    // Two space buns with scrunchies, face-framing strands, butterfly clips and tiny tinted ovals.
    const hair = gearMaterial(c.hair, "hair");
    cap(head, hair, 0.115, 0.58, 0.4, 0.006);
    const part = gearMesh(new THREE.BoxGeometry(0.004, 0.003, 0.05), c.skin, "skin");
    part.position.set(0, 0.123, 0.03); part.rotation.x = 0.4; head.add(part);
    for (const side of [-1, 1]) {
      const dir = V(side * 0.62, 0.78, -0.1).normalize();
      const bun = gearMesh(new THREE.SphereGeometry(0.047, 12, 10), hair);
      bun.position.copy(dir).multiplyScalar(0.135); head.add(bun);
      const scrunchie = facing(gearMesh(new THREE.TorusGeometry(0.036, 0.011, 6, 14), side < 0 ? c.accent : c.trim), dir);
      scrunchie.position.copy(dir).multiplyScalar(0.11); head.add(scrunchie);
      const strand = gearMesh(limbGeometry(0.13, [0.008, 0.013, 0.015, 0.014]), hair);
      strand.position.set(side * 0.082, -0.03, 0.062); strand.rotation.z = side * 0.06; head.add(strand);
    }
    spikes(head, c.hair, 10, 41, (random) => {
      const x = (random() - 0.5) * 0.12;
      return { at: V(x, 0.07, 0.08 - Math.abs(x) * 0.3), dir: V(x * 2, -1, 0.7), length: 0.04 + random() * 0.015, radius: 0.016 };
    });
    for (const [at, color] of [[V(-0.06, 0.068, 0.076), c.accent], [V(0.064, 0.058, 0.08), c.lens], [V(0.025, 0.098, 0.058), c.trim]] as const) {
      const wing = own(new THREE.MeshStandardMaterial({ color, roughness: 0.45, side: THREE.DoubleSide }));
      const butterfly = facing(new THREE.Group(), at);
      butterfly.position.copy(at).multiplyScalar(1.12);
      for (const side of [-1, 1]) {
        const upper = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), wing);
        upper.scale.set(1, 1.3, 1); upper.position.set(side * 0.012, 0.006, 0); upper.rotation.z = side * -0.6; butterfly.add(upper);
        const lower = new THREE.Mesh(new THREE.CircleGeometry(0.009, 8), wing);
        lower.position.set(side * 0.009, -0.009, 0); butterfly.add(lower);
      }
      const body = gearMesh(new THREE.CylinderGeometry(0.003, 0.003, 0.026, 4), DARK, "plastic");
      body.position.z = 0.002; butterfly.add(body);
      head.add(butterfly);
    }
    glasses(head, c, own, () => new THREE.CircleGeometry(0.022, 16).scale(1.25, 0.7, 1), () => new THREE.TorusGeometry(0.0225, 0.003, 4, 16).scale(1.25, 0.7, 1), SILVER, 0.038);
  },
  "bucket-hat"(head, c, own) {
    // A floppy bucket hat with a smiley patch, locs falling out underneath, little round shades.
    const hat = new THREE.Group();
    hat.position.y = 0.038; hat.rotation.x = -0.1; head.add(hat);
    const crown = gearMesh(new THREE.CylinderGeometry(0.098, 0.122, 0.085, 20), c.accent);
    crown.scale.set(0.95, 1, 1.05); crown.position.y = 0.04; hat.add(crown);
    const top = gearMesh(new THREE.SphereGeometry(0.098, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), c.accent);
    top.scale.set(0.95, 0.25, 1.05); top.position.y = 0.0825; hat.add(top);
    const profile = [[0.118, 0.006], [0.2, -0.04], [0.198, -0.05], [0.116, -0.006], [0.118, 0.006]].map(([x, y]) => new THREE.Vector2(x, y));
    const brim = gearMesh(new THREE.LatheGeometry(profile, 24), c.accent);
    brim.scale.set(0.95, 1, 1.05); hat.add(brim);
    const smiley = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), patchMaterial(own, (ctx) => {
      ctx.fillStyle = css(c.trim); ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = "#ffd91a"; ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#151515"; ctx.fillRect(10, 9, 3, 7); ctx.fillRect(19, 9, 3, 7);
      ctx.strokeStyle = "#151515"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(16, 16, 8, 0.4, Math.PI - 0.4); ctx.stroke();
    }, 32, 32));
    smiley.position.set(0, 0.04, 0.122); smiley.rotation.x = -0.27; hat.add(smiley);
    // Locs hang from under the brim all round the sides and back, splaying out a little.
    const random = mulberry32(23);
    for (let i = 0; i < 17; i++) {
      const a = 0.9 + (i / 16) * (Math.PI * 2 - 1.8) + (random() - 0.5) * 0.15;
      const length = 0.2 + random() * 0.09;
      const loc = new THREE.Group();
      loc.rotation.order = "YXZ";
      loc.position.set(Math.sin(a) * 0.09, 0.03, Math.cos(a) * 0.095);
      loc.rotation.set(-0.3 - random() * 0.15, a, 0);
      const strand = gearMesh(limbGeometry(length, [0.012, 0.015, 0.016, 0.015], { segments: 6 }), c.hair, "hair");
      strand.position.y = -length / 2; loc.add(strand);
      if (i % 3 === 1) {
        const bead = gearMesh(new THREE.TorusGeometry(0.016, 0.006, 4, 8), i % 2 ? GOLD : c.trim, "metal");
        bead.rotation.x = Math.PI / 2; bead.position.y = -length * 0.62; loc.add(bead);
      }
      head.add(loc);
    }
    glasses(head, c, own, () => new THREE.CircleGeometry(0.022, 16), () => new THREE.TorusGeometry(0.023, 0.003, 4, 16), GOLD, 0.037);
  },
  "shark-hood"(head, c, own) {
    // A shark onesie hood: the face peeks out of the jaws, eyes on the sides, a fin on top.
    const W = 1.85, r = 0.136;
    const skin = gearMaterial(c.jacket);
    const hood = new THREE.Group();
    hood.scale.set(0.95, 1.06, 1.02); hood.position.y = 0.005; head.add(hood);
    const shell = (radius: number) => new THREE.SphereGeometry(radius, 24, 16, Math.PI / 2 + W / 2, Math.PI * 2 - W, Math.PI * 0.26, Math.PI * 0.56);
    hood.add(gearMesh(shell(r), skin));
    hood.add(gearMesh(new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.27), skin));
    // The inside of the hood is the shark's red mouth.
    hood.add(new THREE.Mesh(shell(r * 0.985), own(new THREE.MeshStandardMaterial({ color: 0xc8303a, roughness: 0.8, side: THREE.BackSide }))));
    const rim = (phi: number, theta: number) => V(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) edge.push(rim(Math.PI / 2 - W / 2 + (i / 6) * W, Math.PI * 0.28));
    for (let i = 1; i <= 5; i++) for (const side of [-1, 1]) edge.push(rim(Math.PI / 2 + side * W / 2 * 0.97, Math.PI * (0.28 + i * 0.09)));
    let tooth = 0;
    spikes(hood, 0xf6f4ee, edge.length, 3, () => {
      const at = edge[tooth++];
      return { at, dir: V(0, -0.01, r * 0.7).sub(at).add(V(0, 0, 0.06)), length: 0.026, radius: 0.011 };
    });
    for (const side of [-1, 1]) {
      const eye = gearMesh(new THREE.SphereGeometry(0.017, 10, 8), 0x0d0f12, "plastic");
      eye.position.set(side * 0.12, 0.04, 0.062); hood.add(eye);
      const shine = gearMesh(new THREE.SphereGeometry(0.005, 6, 4), 0xffffff, "plastic");
      shine.position.set(side * 0.127, 0.048, 0.072); hood.add(shine);
    }
    const fin = new THREE.Shape();
    fin.moveTo(-0.07, 0); fin.quadraticCurveTo(-0.03, 0.07, 0.05, 0.13); fin.quadraticCurveTo(0.035, 0.05, 0.075, 0); fin.closePath();
    const dorsal = gearMesh(new THREE.ExtrudeGeometry(fin, { depth: 0.018, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 2 }).translate(0, 0, -0.009), skin);
    dorsal.rotation.y = Math.PI / 2; dorsal.position.set(0, 0.12, -0.03); hood.add(dorsal);
    // A ginger fringe pokes out under the hood.
    spikes(head, c.hair, 9, 44, (random) => {
      const x = (random() - 0.5) * 0.12;
      return { at: V(x, 0.065, 0.075 - Math.abs(x) * 0.3), dir: V(x * 3, -1, 0.75), length: 0.035 + random() * 0.015, radius: 0.016 };
    });
  },
};

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
  headwear[c.headwear](head, c, own);
}
