import * as THREE from "three";
import { damp, lerp, mulberry32, smoothstep } from "./noise";

/** A permanent weather pocket on the northeast face, with a gradual boundary. */
export function stormAt(x: number, z: number) {
  return smoothstep(190, 450, Math.hypot(x, z)) * smoothstep(-100, 150, x) * smoothstep(-60, 220, -z);
}

export class Weather {
  readonly snow: THREE.Points;
  intensity = 0;
  private seeds = new Float32Array(1600 * 3);
  private positions = new Float32Array(1600 * 3);
  private material: THREE.PointsMaterial;
  private clearColor = new THREE.Color(0xd6e8f8);
  private stormColor = new THREE.Color(0xa8bdce);

  constructor(scene: THREE.Scene) {
    const random = mulberry32(419);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, "white");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    this.material = new THREE.PointsMaterial({ color: 0xffffff, map: new THREE.CanvasTexture(canvas), size: 0.35,
      transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.snow = new THREE.Points(geometry, this.material);
    this.snow.frustumCulled = false;
    scene.add(this.snow);
  }

  update(dt: number, time: number, focus: THREE.Vector3, scene: THREE.Scene, sun: THREE.DirectionalLight) {
    this.intensity = lerp(this.intensity, stormAt(focus.x, focus.z), damp(1.4, dt));
    this.snow.visible = this.intensity > 0.01;
    this.material.opacity = this.intensity * 0.88;
    if (this.snow.visible) {
      for (let i = 0; i < this.seeds.length; i += 3) {
        this.positions[i] = focus.x + ((this.seeds[i] * 100 + time * 14) % 100) - 50;
        this.positions[i + 1] = focus.y + ((this.seeds[i + 1] * 50 - time * 8) % 50 + 50) % 50 - 12;
        this.positions[i + 2] = focus.z + ((this.seeds[i + 2] * 100 + time * 4) % 100) - 50;
      }
      this.snow.geometry.getAttribute("position").needsUpdate = true;
    }
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(this.clearColor).lerp(this.stormColor, this.intensity);
    fog.near = lerp(350, 8, this.intensity);
    fog.far = lerp(5200, 135, Math.sqrt(this.intensity));
    sun.intensity = lerp(2.6, 0.65, this.intensity);
    scene.environmentIntensity = lerp(0.55, 0.8, this.intensity);
  }
}
