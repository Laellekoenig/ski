import * as THREE from "three";
import { mulberry32 } from "./noise";
import { SUN_DIR } from "./world";

const COUNT = 850;
/** side of the box of air that follows the camera, in metres */
const RANGE = 40;

/** Sparse diamond dust, visible as small, brief reflections in cold sunshine. */
export class Weather {
  readonly sparkles: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const random = mulberry32(419);
    const seeds = new Float32Array(COUNT * 3);
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random() * RANGE;
    for (let i = 0; i < COUNT; i++) phases[i] = random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        focus: { value: new THREE.Vector3() },
        sunDir: { value: SUN_DIR },
        viewHeight: { value: 720 },
        pixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float phase;
        uniform float time; uniform vec3 focus; uniform vec3 sunDir; uniform float viewHeight; uniform float pixelRatio;
        varying float vGlow;
        const float RANGE = ${RANGE.toFixed(1)};
        void main() {
          // a light breeze carries the crystals slowly down the valley as they settle
          vec3 drift = vec3(0.16, -0.06 - phase * 0.08, 0.08) * time + 0.12 * sin(time * 0.35 + phase * 6.283 + vec3(0.0, 1.7, 3.1));
          vec3 world = focus + mod(position + drift - focus, RANGE) - 0.5 * RANGE;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          float dist = -mv.z;
          // each crystal catches the sun for a moment, brightest when looking towards the sun
          float glint = pow(max(sin(time * (0.6 + phase * 1.2) + phase * 40.0), 0.0), 48.0);
          float toSun = max(dot(normalize(world - cameraPosition), sunDir), 0.0);
          float fade = (1.0 - smoothstep(0.3 * RANGE, 0.5 * RANGE, dist)) * smoothstep(1.0, 3.0, dist);
          vGlow = fade * (0.008 + glint * (0.16 + 0.32 * pow(toSun, 4.0)));
          // Millimetre-scale reflections; cap their apparent size on high-DPI screens.
          float diameter = 0.004 + phase * 0.004;
          gl_PointSize = clamp(diameter * projectionMatrix[1][1] * viewHeight * 0.5 / max(dist, 0.1), 0.75 * pixelRatio, 2.0 * pixelRatio);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float core = exp(-dot(c, c) * 18.0);
          float a = core * (1.0 - smoothstep(0.3, 0.5, length(c))) * vGlow;
          if (a < 0.004) discard;
          gl_FragColor = vec4(0.94, 0.97, 1.0, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sparkles = new THREE.Points(geometry, this.material);
    this.sparkles.frustumCulled = false;
    scene.add(this.sparkles);
  }

  /** `viewHeight` is the height of the buffer the scene is drawn into, in its own pixels. */
  update(dt: number, camera: THREE.Camera, viewHeight: number) {
    const u = this.material.uniforms;
    u.time.value += dt;
    u.focus.value.copy(camera.position);
    u.viewHeight.value = viewHeight;
  }
}
