import * as THREE from "three";
import { Terrain } from "./terrain";
import { SUMMIT } from "./layout";

export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
export const SKY_TOP = new THREE.Color(0x487cad);
export const SKY_HORIZON = new THREE.Color(0xc0d4e7);

/** A clear winter day above the Engadine, with thin, wind-sheared clouds. All scenery beyond the shoulder is distant. */
export class World {
  readonly scene = new THREE.Scene();
  readonly terrain: Terrain;
  readonly sun: THREE.DirectionalLight;
  readonly summit: THREE.Vector3;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(renderer: THREE.WebGLRenderer) {
    const scene = this.scene;
    scene.background = SKY_HORIZON.clone();
    scene.fog = new THREE.Fog(0xc0d4e7, 6000, 38000);
    this.sky = this.makeSky(true);
    scene.add(this.sky);
    // Image based lighting from the sky for soft clay shading
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.makeSky(false));
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

  private makeSky(clouds: boolean) {
    const geo = new THREE.SphereGeometry(55000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: clouds ? { CLOUDS: "" } : {},
      uniforms: {
        top: { value: SKY_TOP },
        horizon: { value: SKY_HORIZON },
        sunDir: { value: SUN_DIR },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float time;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int o = 0; o < 5; o++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
          return s;
        }
        // Continuous density with wind-stretched detail and feathered edges.
        float cloud(vec2 p) {
          vec2 warp = vec2(vnoise(p * 0.55 + 11.3), vnoise(p * 0.55 - 19.1));
          vec2 q = p * vec2(0.75, 1.65) + (warp - 0.5) * 1.2;
          float density = fbm(q);
          float erosion = (1.0 - vnoise(q * 12.0 + warp)) * 0.08;
          return smoothstep(0.49, 0.71, density - erosion);
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.55));
          // a pale band of winter haze just above the peaks
          col = mix(col, horizon * 1.03, exp(-h * 22.0) * 0.25);
          col = mix(col, horizon * 1.03, 1.0 - smoothstep(-0.2, 0.0, d.y));
          float s = max(dot(d, sunDir), 0.0);
          vec3 sunTint = vec3(1.0, 0.97, 0.91);
          // A small solar disc and restrained atmospheric scattering.
          float sunDisc = smoothstep(0.999976, 0.999990, s);
          col += sunTint * (pow(s, 18.0) * 0.07 + pow(s, 1400.0) * 0.25 + sunDisc * 6.0);
          #ifdef CLOUDS
          if (d.y > 0.0) {
            vec2 p = d.xz * (2.2 / (d.y + 0.22)) + vec2(0.0025, 0.0008) * time;
            float c = cloud(p);
            if (c > 0.0) {
              vec2 toSun = normalize(sunDir.xz) * 0.12;
              float lit = clamp(0.65 + (c - cloud(p + toSun)) * 0.7, 0.0, 1.0);
              vec3 cloudCol = mix(vec3(0.64, 0.72, 0.82), vec3(1.05, 1.08, 1.12), lit);
              cloudCol += sunTint * pow(s, 32.0) * 0.12;
              // sink softly into the haze along the horizon
              float fade = smoothstep(0.015, 0.13, d.y);
              col = mix(col, cloudCol, c * fade * 0.78);
            }
          }
          #endif
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

  update(focus: THREE.Vector3, dt: number) {
    this.sky.material.uniforms.time.value += dt;
    // Snap the following shadow camera to texels to avoid shimmering.
    const texel = 110 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 300);
  }
}
