import * as THREE from "three";
import { CHARACTERS, type Character } from "./characters";
import { Skier, type PoseInput } from "./skier";
import { clay } from "./materials";
import { damp, lerp } from "./noise";

const IDLE: PoseInput = { speed: 0, turn: 0, tuck: false, brake: false, air: false, skate: 0, seated: false, crashed: false, squash: 0 };

/** One small renderer for all five live portraits, using the actual playable rig. */
export class CharacterSelect {
  private track = document.getElementById("roster-track")!;
  private announcement = document.getElementById("character-announcement")!;
  private startButton = document.getElementById("start-button") as HTMLButtonElement;
  private renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  private camera = new THREE.PerspectiveCamera(31, 1, 0.1, 30);
  private portraits: { scene: THREE.Scene; skier: Skier; button: HTMLButtonElement; stage: HTMLElement; pedestal: THREE.Mesh; x: number; y: number; width: number; height: number }[] = [];
  private observer: ResizeObserver;
  private selectedIndex = 0;
  private time = 0;
  private disposed = false;

  constructor(private onSelect: (character: Character) => void, onStart: () => void) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "roster-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.autoClear = false;
    this.camera.position.set(2.4, 2, 6.8);
    this.camera.lookAt(0, 1, 0);

    CHARACTERS.forEach((character, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "character-option";
      button.style.setProperty("--character-color", character.color);
      button.setAttribute("aria-label", `${index + 1}. ${character.name}, ${character.species}`);
      button.setAttribute("aria-keyshortcuts", String(index + 1));
      button.innerHTML = `<span class="character-number">${index + 1}</span><span class="ready-label">Ready!</span><span class="character-model" aria-hidden="true"></span><span class="character-name">${character.name}</span><span class="character-species">${character.species}</span>`;
      button.addEventListener("click", () => this.select(index));
      this.track.appendChild(button);

      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xe2eeff, 0xc3a99c, 2.6));
      const key = new THREE.DirectionalLight(0xffefd7, 3.5);
      key.position.set(-3, 5, 6);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xe2f4ff, 2.5);
      rim.position.set(3, 3, -4);
      scene.add(rim);

      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.83, 0.79, 0.085, 48), clay(character.jacket, { bump: 0.15 }));
      pedestal.position.y = -0.055;
      scene.add(pedestal);
      const snow = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.83, 0.075, 48), clay(0xf9fcff, { bump: 0.25 }));
      snow.position.y = -0.003;
      scene.add(snow);
      // Soft contact shadow, shared by the feet and poles.
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0x94a3b4, transparent: true, opacity: 0.14, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.036, 0);
      shadow.scale.set(0.8, 1.15, 1);
      scene.add(shadow);
      const skier = new Skier(character);
      skier.root.position.y = 0.044;
      for (let frame = 0; frame < 60; frame++) skier.update(1 / 60, IDLE);
      scene.add(skier.root);
      this.portraits.push({ scene, skier, button, stage: button.querySelector<HTMLElement>(".character-model")!, pedestal, x: 0, y: 0, width: 0, height: 0 });
    });
    this.track.appendChild(this.renderer.domElement);
    this.startButton.addEventListener("click", onStart);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.track);
    this.select(0);
    this.resize();
  }

  select(index: number) {
    if (this.disposed || index < 0 || index >= CHARACTERS.length) return;
    this.selectedIndex = index;
    const character = CHARACTERS[index];
    for (const [i, portrait] of this.portraits.entries()) {
      portrait.button.setAttribute("aria-pressed", String(i === index));
    }
    const roster = this.track.parentElement!;
    const selected = this.portraits[index].button;
    // Keep Enter on the current choice after mixing mouse and number keys.
    if (this.track.contains(document.activeElement)) selected.focus({ preventScroll: true });
    if (roster.scrollWidth > roster.clientWidth) {
      roster.scrollTo({ left: selected.offsetLeft - (roster.clientWidth - selected.offsetWidth) / 2, behavior: "smooth" });
    }
    document.getElementById("title")!.style.setProperty("--selected-color", character.color);
    this.announcement.innerHTML = `<strong>${character.name} says…</strong> “${character.motto}”`;
    this.startButton.innerHTML = `Let’s ski, ${character.name}! <span aria-hidden="true">↗</span>`;
    this.onSelect(character);
  }

  step(direction: number) {
    this.select((this.selectedIndex + direction + CHARACTERS.length) % CHARACTERS.length);
  }

  private resize() {
    const rect = this.track.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    for (const portrait of this.portraits) {
      const stage = portrait.stage.getBoundingClientRect();
      portrait.x = stage.left - rect.left;
      portrait.y = rect.bottom - stage.bottom;
      portrait.width = stage.width;
      portrait.height = stage.height;
    }
  }

  update(dt: number) {
    if (this.disposed) return;
    this.time += dt;
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    this.portraits.forEach((portrait, index) => {
      const { skier, x, y, width, height } = portrait;
      if (!width || !height) return;
      const selected = index === this.selectedIndex;
      skier.update(dt, IDLE);
      skier.root.rotation.y = lerp(skier.root.rotation.y, selected ? Math.sin(this.time * 1.4) * 0.12 : -0.12, damp(7, dt));
      const size = lerp(skier.root.scale.x, selected ? 1.07 : 0.95, damp(8, dt));
      skier.root.scale.setScalar(size);
      portrait.pedestal.scale.setScalar(lerp(portrait.pedestal.scale.x, selected ? 1.045 : 1, damp(8, dt)));
      this.camera.aspect = width / height;
      // Keep horns, ears, and ski tips in view at every card aspect ratio.
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(1.25, 0.95 / this.camera.aspect) / 7.2));
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(x, y, width, height);
      this.renderer.setScissor(x, y, width, height);
      this.renderer.render(portrait.scene, this.camera);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    for (const { scene } of this.portraits) {
      scene.traverse((part) => {
        if (part instanceof THREE.Mesh) {
          part.geometry.dispose();
          if (part.material instanceof THREE.MeshBasicMaterial) part.material.dispose();
        }
      });
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
