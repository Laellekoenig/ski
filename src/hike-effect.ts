import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Low-resolution world rendering with a soft, illustrated pixel-art finish. */
export class HikeEffect {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });

  private readonly material = new THREE.ShaderMaterial({
    name: "HikeEffect",
    depthTest: false,
    depthWrite: false,
    uniforms: {
      sceneColor: { value: this.target.texture },
      sceneDepth: { value: this.target.depthTexture },
      resolution: { value: new THREE.Vector2(1, 1) },
      cameraNear: { value: 0.3 },
      cameraFar: { value: 12000 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D sceneColor;
      uniform sampler2D sceneDepth;
      uniform vec2 resolution;
      uniform float cameraNear;
      uniform float cameraFar;
      varying vec2 vUv;

      #include <packing>

      float viewDepth(vec2 uv) {
        return -perspectiveDepthToViewZ(texture2D(sceneDepth, uv).r, cameraNear, cameraFar);
      }

      // A fixed Bayer pattern at the world-pixel scale: no animated grain or shimmer.
      float bayer4(vec2 pixel) {
        vec2 low = mod(pixel, 2.0);
        vec2 high = mod(floor(pixel * 0.5), 2.0);
        return (4.0 * mod(2.0 * low.x + 3.0 * low.y, 4.0)
          + mod(2.0 * high.x + 3.0 * high.y, 4.0) + 0.5) / 16.0 - 0.5;
      }

      void main() {
        vec2 pixel = floor(vUv * resolution);
        vec2 uv = (pixel + 0.5) / resolution;
        vec2 texel = 1.0 / resolution;
        gl_FragColor = texture2D(sceneColor, uv);

        // The offscreen target is linear HDR. Map and encode exactly once here,
        // before grading and quantizing the visible palette.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>

        vec3 color = gl_FragColor.rgb;
        float light = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float highlight = smoothstep(0.35, 0.9, light);
        color = mix(vec3(light), color, 1.08);
        color += mix(vec3(0.018, -0.008, 0.025), vec3(0.035, 0.012, -0.035), highlight);
        color = mix(color, vec3(0.97, 0.93, 0.86), 0.035);

        // Outline only the near side of depth breaks; avoid drawing lines across
        // continuous snow slopes, and let distant scenery recede into the fog.
        float depth = viewDepth(uv);
        float farther = max(
          max(viewDepth(uv + vec2(texel.x, 0.0)), viewDepth(uv - vec2(texel.x, 0.0))),
          max(viewDepth(uv + vec2(0.0, texel.y)), viewDepth(uv - vec2(0.0, texel.y)))
        );
        float edge = smoothstep(0.035, 0.10, (farther - depth) / max(depth, 0.001));
        edge *= 1.0 - smoothstep(80.0, 320.0, depth);
        color = mix(color, color * vec3(0.66, 0.63, 0.76), edge * 0.48);

        // Gentle palette steps with ordered dithering, preserving snow detail.
        color = floor(clamp(color, 0.0, 1.0) * 47.0 + 0.5 + bayer4(pixel) * 0.4) / 47.0;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  private readonly quad = new FullScreenQuad(this.material);

  constructor(private readonly renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.setSize(width, height);
  }

  setSize(width: number, height: number) {
    // Size in CSS pixels so retina displays keep the same chunky look. Keep the
    // world near 270 lines, with at least two screen pixels per rendered pixel.
    const pixelSize = Math.max(2, Math.round(height / 270));
    const w = Math.max(1, Math.ceil(width / pixelSize));
    const h = Math.max(1, Math.ceil(height / pixelSize));
    this.target.setSize(w, h);
    this.material.uniforms.resolution.value.set(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.material.uniforms.cameraNear.value = camera.near;
    this.material.uniforms.cameraFar.value = camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.quad.render(this.renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
