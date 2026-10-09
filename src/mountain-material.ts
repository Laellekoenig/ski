import * as THREE from "three";

/** Broken slate ridges with snow in their gullies, on the surveyed far mesh. */
export function mountainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rockDark = { value: new THREE.Color(0x353a40) };
    shader.uniforms.rockLight = { value: new THREE.Color(0x6a6864) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", /* glsl */ `
        #include <common>
        attribute float rockExposure;
        varying float vRockExposure;
        varying vec3 vMountainPosition;
      `)
      .replace("#include <begin_vertex>", /* glsl */ `
        #include <begin_vertex>
        vRockExposure = rockExposure;
        vMountainPosition = position;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", /* glsl */ `
        #include <common>
        uniform vec3 rockDark;
        uniform vec3 rockLight;
        varying float vRockExposure;
        varying vec3 vMountainPosition;

        float mountainHash(vec2 p) {
          vec3 q = fract(vec3(p.xyx) * 0.1031);
          q += dot(q, q.yzx + 33.33);
          return fract((q.x + q.y) * q.z);
        }
        float mountainNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mountainHash(i), mountainHash(i + vec2(1.0, 0.0)), f.x),
            mix(mountainHash(i + vec2(0.0, 1.0)), mountainHash(i + 1.0), f.x), f.y);
        }
      `)
      .replace("#include <color_fragment>", /* glsl */ `
        #include <color_fragment>
        vec3 p = vMountainPosition;
        // Stretched, slanted fractures break the snow edge into narrow ribbons.
        vec2 strata = p.xz * 0.012 + vec2(p.y * 0.003, -p.y * 0.002);
        float broad = mountainNoise(strata);
        float detail = mountainNoise(strata * 3.1);
        float grain = mountainNoise(p.xz * 0.085);
        float exposure = vRockExposure + (broad - 0.5) * 0.3 + (detail - 0.5) * 0.16;
        float edge = max(0.025, fwidth(exposure) * 0.7);
        float bare = smoothstep(0.48 - edge, 0.48 + edge, exposure);
        vec3 stone = mix(rockDark, rockLight, broad * 0.65 + detail * 0.35);
        stone *= 0.88 + grain * 0.24;
        diffuseColor.rgb = mix(diffuseColor.rgb, stone, bare);
      `);
  };
  material.customProgramCacheKey = () => "winter-mountain-rock-v1";
  return material;
}
