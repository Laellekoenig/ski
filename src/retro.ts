import * as THREE from "three";

/** Lines of vertical resolution to aim for, like a late-90s console on a TV. */
const TARGET_LINES = 240;
/** Colour levels per channel after the ordered dither: 4 bits, so gradients break into visible patterns. */
const LEVELS = 15;

/**
 * Renders the scene into a small, unsmoothed buffer, then blows it up with chunky pixels,
 * a little film grain and a 4×4 ordered dither into a reduced palette.
 */
export class RetroFilter {
  /** size of the low-resolution scene buffer, in its own pixels */
  readonly size = new THREE.Vector2();
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private drawSize = new THREE.Vector2();
  private time = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    // Keep the scene linear and unclipped; tone mapping happens in the final pass.
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        scene: { value: this.target.texture },
        lowRes: { value: new THREE.Vector2(1, 1) },
        pixel: { value: 1 },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D scene; uniform vec2 lowRes; uniform float pixel; uniform float time;
        const float LEVELS = ${LEVELS.toFixed(1)};

        float bayer4(vec2 p) {
          vec2 q = mod(p, 4.0);
          float a = mod(q.x, 2.0), b = mod(q.y, 2.0);
          float c = step(2.0, q.x), d = step(2.0, q.y);
          // classic 4×4 Bayer matrix, built from two nested 2×2 ones
          float inner = 2.0 * a + 3.0 * b - 4.0 * a * b;
          float outer = 2.0 * c + 3.0 * d - 4.0 * c * d;
          return (4.0 * inner + outer + 0.5) / 16.0;
        }

        float hash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vec2 cell = floor(gl_FragCoord.xy / pixel);
          vec2 uv = (cell + 0.5) / lowRes;
          gl_FragColor = vec4(texture2D(scene, uv).rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          vec3 col = gl_FragColor.rgb;

          // a touch more punch, the way cheap CRTs and early LCDs crushed things
          float luma = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(luma), col, 1.12);
          col = (col - 0.5) * 1.06 + 0.5;

          // gritty grain that crawls a few times a second rather than every frame
          float tick = floor(time * 12.0);
          col += (hash(cell + tick * vec2(37.0, 17.0)) - 0.5) * 0.03;

          // soft darkening at the corners
          vec2 v = uv - 0.5;
          col *= 1.0 - dot(v, v) * 0.25;

          // ordered dither into a reduced palette
          col = floor(col * LEVELS + bayer4(cell)) / LEVELS;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    });
    // one triangle that covers the screen
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.resize();
  }

  /** Match the low-res buffer to the canvas, keeping every chunky pixel the same whole number of screen pixels. */
  resize() {
    const draw = this.renderer.getDrawingBufferSize(this.drawSize);
    const pixel = Math.max(2, Math.round(draw.y / TARGET_LINES));
    this.size.set(Math.ceil(draw.x / pixel), Math.ceil(draw.y / pixel));
    this.target.setSize(this.size.x, this.size.y);
    this.material.uniforms.lowRes.value.copy(this.size);
    this.material.uniforms.pixel.value = pixel;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt = 0) {
    this.time += dt;
    this.material.uniforms.time.value = this.time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quad, this.camera);
  }
}
