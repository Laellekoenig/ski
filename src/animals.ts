import * as THREE from "three";
import { clay } from "./materials";
import type { Character } from "./characters";

type XYZ = [number, number, number];
const DARK = 0x352d38;

function oval(parent: THREE.Object3D, color: number, pos: XYZ, scale: XYZ) {
  const part = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), clay(color, { bump: 0.22 }));
  part.position.set(...pos);
  part.scale.set(...scale);
  part.castShadow = true;
  parent.add(part);
  return part;
}

/** Soft tapered horns, with hand-pressed rings on the ibex. */
function horn(head: THREE.Group, side: number, ibex: boolean) {
  const points: XYZ[] = ibex
    ? [[side * 0.22, 0.23, -0.03], [side * 0.29, 0.48, -0.06], [side * 0.32, 0.69, -0.22], [side * 0.31, 0.68, -0.43], [side * 0.28, 0.51, -0.49]]
    : [[side * 0.19, 0.24, -0.02], [side * 0.22, 0.49, -0.04], [side * 0.24, 0.67, -0.09], [side * 0.24, 0.68, -0.19], [side * 0.23, 0.59, -0.22]];
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const radius = ibex ? 0.071 : 0.038;
  const geometry = new THREE.TubeGeometry(curve, 32, radius, 10, false);
  const positions = geometry.attributes.position;
  for (let i = 0; i <= 32; i++) {
    const center = curve.getPointAt(i / 32);
    const taper = 1 - (i / 32) * 0.94;
    for (let j = 0; j <= 10; j++) {
      const index = i * 11 + j;
      positions.setXYZ(index,
        center.x + (positions.getX(index) - center.x) * taper,
        center.y + (positions.getY(index) - center.y) * taper,
        center.z + (positions.getZ(index) - center.z) * taper);
    }
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, clay(ibex ? 0x705244 : DARK, { bump: 0.35 }));
  mesh.castShadow = true;
  head.add(mesh);
  if (ibex) {
    for (let i = 1; i <= 7; i++) {
      const t = i * 0.085;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (1 - t * 0.94), 0.009, 6, 12), clay(0x9a7860));
      ring.position.copy(curve.getPointAt(t));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(t));
      ring.castShadow = true;
      head.add(ring);
    }
  }
}

export function sculptAnimal(head: THREE.Group, torso: THREE.Group, character: Character) {
  const { id, fur, cream } = character;
  const eyes: THREE.Group[] = [];
  const ears: THREE.Group[] = [];
  const round = id === "marmot";
  const fox = id === "fox";
  oval(head, fur, [0, 0, 0], [round ? 0.36 : 0.32, round ? 0.29 : 0.31, 0.29]);

  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    if (id === "hare") {
      ear.position.set(side * 0.19, 0.2, -0.02);
      ear.rotation.z = -side * 0.16;
      oval(ear, fur, [0, 0.28, 0], [0.091, 0.32, 0.07]);
      oval(ear, 0xf3b6c3, [0, 0.29, 0.056], [0.048, 0.23, 0.022]);
    } else if (fox) {
      ear.position.set(side * 0.235, 0.21, -0.01);
      ear.rotation.z = -side * 0.2;
      // Bevelled triangular ears keep the fox silhouette distinct from the hare.
      const triangle = new THREE.Shape();
      triangle.moveTo(-0.115, 0);
      triangle.lineTo(0, 0.28);
      triangle.lineTo(0.115, 0);
      triangle.closePath();
      const earMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(triangle, { depth: 0.05, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.035, bevelThickness: 0.04 }), clay(fur));
      earMesh.castShadow = true;
      ear.add(earMesh);
      const inner = earMesh.clone();
      inner.geometry = earMesh.geometry.clone();
      inner.material = clay(0x684633);
      inner.scale.set(0.57, 0.73, 0.45);
      inner.position.set(0, 0.023, 0.067);
      ear.add(inner);
      oval(ear, cream, [0, 0.076, 0.11], [0.048, 0.07, 0.016]);
    } else if (round) {
      ear.position.set(side * 0.3, 0.19, -0.01);
      oval(ear, fur, [0, 0, 0], [0.105, 0.115, 0.069]);
      oval(ear, 0xe8ae87, [0, 0, 0.056], [0.058, 0.068, 0.019]);
    } else {
      ear.position.set(side * 0.31, 0.095, -0.02);
      ear.rotation.z = -side * 0.7;
      oval(ear, fur, [0, 0.055, 0], [0.085, 0.145, 0.065]);
      oval(ear, cream, [0, 0.06, 0.05], [0.042, 0.09, 0.024]);
      horn(head, side, id === "ibex");
    }
    head.add(ear);
    ears.push(ear);

    // Cream cheeks, a pronounced snout, and little inset shiny eyes.
    const cheek = oval(head, cream, [side * (fox ? 0.17 : 0.11), -0.115, fox ? 0.236 : 0.261], [fox ? 0.16 : 0.122, fox ? 0.105 : 0.102, 0.092]);
    cheek.rotation.z = side * (fox ? 0.4 : 0.08);
    if (id === "chamois") {
      const blaze = oval(head, cream, [side * 0.11, 0.018, 0.267], [0.109, 0.2, 0.053]);
      blaze.rotation.z = side * -0.2;
      const stripe = oval(head, DARK, [side * 0.15, -0.007, 0.296], [0.046, 0.14, 0.035]);
      stripe.rotation.z = side * -0.32;
    }
    const eye = new THREE.Group();
    eye.position.set(side * 0.12, 0.018, id === "chamois" ? 0.331 : 0.272);
    eye.rotation.y = side * 0.15;
    oval(eye, DARK, [0, 0, 0], [0.034, 0.047, 0.025]);
    oval(eye, 0xffffff, [-0.009, 0.015, 0.021], [0.011, 0.013, 0.007]);
    head.add(eye);
    eyes.push(eye);
    oval(head, id === "hare" ? 0xf5b1c5 : 0xe9a48d, [side * 0.21, -0.066, 0.258], [0.046, 0.024, 0.012]);
  }
  oval(head, cream, [0, -0.088, 0.29], [fox ? 0.106 : 0.13, 0.08, fox ? 0.13 : 0.096]);
  oval(head, id === "hare" ? 0xdf8fa8 : DARK, [0, -0.072, fox ? 0.409 : 0.378], [0.045, 0.029, 0.026]);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 16, Math.PI), clay(DARK, { bump: 0 }));
  smile.rotation.z = Math.PI;
  smile.position.set(0, -0.142, 0.351);
  head.add(smile);
  if (round) {
    for (const side of [-1, 1]) {
      const tooth = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.021, 3, 8), clay(0xfffdf2));
      tooth.position.set(side * 0.019, -0.162, 0.354);
      tooth.scale.z = 0.45;
      head.add(tooth);
    }
    torso.scale.set(1.14, 0.97, 1.06);
  }
  if (id === "ibex") {
    oval(head, fur, [0, -0.29, 0.12], [0.089, 0.105, 0.075]);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.05, -0.17);
  torso.add(tail);
  if (fox) {
    const fluff = oval(tail, fur, [0.12, 0.04, -0.26], [0.17, 0.2, 0.34]);
    fluff.rotation.x = -0.5;
    fluff.rotation.y = -0.3;
    const tip = oval(tail, cream, [0.2, 0.23, -0.49], [0.138, 0.19, 0.16]);
    tip.rotation.x = -0.45;
  } else if (id === "hare") {
    oval(tail, 0xffffff, [0, -0.01, -0.12], [0.115, 0.12, 0.11]);
  } else {
    oval(tail, fur, [0, -0.04, -0.12], [0.075, round ? 0.1 : 0.06, round ? 0.22 : 0.12]);
  }
  return { eyes, ears, tail };
}
