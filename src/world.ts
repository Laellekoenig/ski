import * as THREE from "three";
import { Terrain } from "./terrain";
import { SUMMIT } from "./layout";

export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
export const SKY_TOP = new THREE.Color(0x4f8fe0);
export const SKY_HORIZON = new THREE.Color(0xcfe4f7);

/** A clear day above the Engadine. All scenery beyond the shoulder is distant. */
export class World {
  readonly scene = new THREE.Scene();
  readonly terrain: Terrain;
  readonly sun: THREE.DirectionalLight;
  readonly summit: THREE.Vector3;

  constructor(renderer: THREE.WebGLRenderer) {
    const scene = this.scene;
    scene.background = SKY_HORIZON.clone();
    scene.fog = new THREE.Fog(0xd6e8f8, 6000, 38000);
    scene.add(this.makeSky());
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

    pmrem.dispose();
    this.terrain = new Terrain();
    scene.add(this.terrain.mesh, this.terrain.farMesh);
    this.summit = new THREE.Vector3(SUMMIT.x, this.terrain.heightAt(SUMMIT.x, SUMMIT.z), SUMMIT.z);
  }

  private makeSky() {
    const geo = new THREE.SphereGeometry(55000, 32, 16);
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

  update(focus: THREE.Vector3) {
    // Snap the following shadow camera to texels to avoid shimmering.
    const texel = 110 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 300);
  }
}
