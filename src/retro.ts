import * as THREE from "three";

/** Lines of vertical resolution to aim for: chunky enough to read as pixels, fine enough to stay readable (à la A Short Hike). */
const TARGET_LINES = 360;

/** Renders the scene into a small, unsmoothed buffer, then blows it up with chunky pixels. */
export class RetroFilter {
  /** size of the low-resolution scene buffer, in its own pixels */
  readonly size = new THREE.Vector2();
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private drawSize = new THREE.Vector2();

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
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D scene; uniform vec2 lowRes; uniform float pixel;

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

          // soft darkening at the corners
          vec2 v = uv - 0.5;
          col *= 1.0 - dot(v, v) * 0.25;
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

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quad, this.camera);
  }
}
