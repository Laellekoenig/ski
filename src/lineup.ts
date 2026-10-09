import * as THREE from "three";
import { CHARACTERS, type Character } from "./characters";
import { Skier, SKI_GAP, makeSki, type PoseInput } from "./skier";
import type { World } from "./world";
import type { Particles } from "./particles";
import { START_HEADING } from "./player";
import { SUMMIT } from "./layout";
import { damp, lerp } from "./noise";

/** Sideways distance between friends in the line. */
const SPACING = 1.75;
/** How far behind its ski bindings each friend waits, and where it stands once stepped up to the tails. */
const REST = 1.8;
const READY = 1.2;
const STEP_TIME = 0.55;
const CROUCH_TIME = 0.2;
const HOP_TIME = 0.5;
const HOP_HEIGHT = 0.6;
/** Boots sit on top of the ski; without skis the skier stands this much lower. */
const SKI_THICKNESS = 0.035;

const ease = (u: number) => u * u * (3 - 2 * u);

interface Slot {
  character: Character;
  skier: Skier;
  /** the pair lying in the snow, waiting to be stepped into */
  skis: THREE.Group;
  /** binding position of the lying skis */
  base: THREE.Vector3;
  label: HTMLButtonElement;
  step: number;
  wave: number;
  yaw: number;
}

export interface LineupEvents {
  onSelect: (character: Character) => void;
  onHop: () => void;
  /** the chosen friend is on its skis at `at`, facing `heading` */
  onLand: (skier: Skier, at: THREE.Vector3, heading: number) => void;
}

/**
 * The opening scene at the summit: every friend stands behind its own skis.
 * The picked one steps up, and on start hops into its bindings.
 */
export class Lineup {
  readonly heading = START_HEADING;
  readonly fwd = new THREE.Vector3(Math.sin(START_HEADING), 0, Math.cos(START_HEADING));
  /** screen-right when looking back up at the line from downhill */
  private right = new THREE.Vector3(Math.cos(START_HEADING), 0, -Math.sin(START_HEADING));
  /** middle of the waiting line, on the snow */
  readonly center = new THREE.Vector3();
  /** the line has been cleared away for good */
  retired = false;
  selected = 0;
  private slots: Slot[] = [];
  private labels = document.getElementById("lineup-labels")!;
  /** <0 until the run is started */
  private launchTime = -1;
  private hopFrom = new THREE.Vector3();
  private landed = false;
  private time = 0;
  private tmp = new THREE.Vector3();

  constructor(
    private world: World,
    private particles: Particles,
    private events: LineupEvents,
  ) {
    const t = world.terrain;
    this.center.set(SUMMIT.x, 0, SUMMIT.z).addScaledVector(this.fwd, -REST);
    this.center.y = t.heightAt(this.center.x, this.center.z);

    CHARACTERS.forEach((character, index) => {
      const base = new THREE.Vector3(SUMMIT.x, 0, SUMMIT.z).addScaledVector(this.right, (index - (CHARACTERS.length - 1) / 2) * SPACING);
      base.y = t.heightAt(base.x, base.z);

      const skis = new THREE.Group();
      for (const side of [-1, 1]) {
        const ski = makeSki(character.skis);
        ski.position.x = side * SKI_GAP;
        skis.add(ski);
      }
      skis.position.copy(base);
      skis.rotation.y = this.heading;
      world.scene.add(skis);

      const skier = new Skier(character);
      skier.skis = false;
      skier.root.rotation.y = this.heading;
      world.scene.add(skier.root);
      // Desynchronise idle bobbing and blinking a little.
      for (let frame = 0; frame < 30 + index * 17; frame++) skier.update(1 / 60, this.pose(index, 0, 0));

      const label = document.createElement("button");
      label.type = "button";
      label.className = "lineup-label";
      label.setAttribute("aria-label", `${index + 1}. ${character.name}, ${character.species}`);
      label.setAttribute("aria-keyshortcuts", String(index + 1));
      label.innerHTML = `<span class="key">${index + 1}</span><span>${character.name}</span>`;
      label.addEventListener("click", () => this.select(index));
      this.labels.appendChild(label);

      const slot: Slot = { character, skier, skis, base, label, step: 0, wave: 0, yaw: this.heading };
      this.slots.push(slot);
      this.place(slot);
    });
    this.select(0);
  }

  get launching() {
    return this.launchTime >= 0;
  }

  select(index: number) {
    if (this.launching || this.retired || index < 0 || index >= this.slots.length) return;
    if (index !== this.selected) this.slots[this.selected].wave = 0;
    this.selected = index;
    this.slots[index].wave = 1.4;
    this.slots.forEach((slot, i) => slot.label.setAttribute("aria-pressed", String(i === index)));
    this.events.onSelect(this.slots[index].character);
  }

  step(direction: number) {
    this.select((this.selected + direction + this.slots.length) % this.slots.length);
  }

  /** Start the run: the chosen friend hops onto its skis, the others cheer. */
  launch() {
    if (this.launching || this.retired) return;
    this.launchTime = 0;
    const chosen = this.slots[this.selected];
    chosen.wave = 0;
    this.hopFrom.copy(chosen.skier.root.position);
    this.slots.forEach((slot, i) => {
      if (i !== this.selected) slot.wave = 2.2 + Math.abs(i - this.selected) * 0.3;
    });
  }

  /** Skip the hop, e.g. for headless test runs. */
  finishLaunch() {
    this.launch();
    if (!this.landed) this.land(this.slots[this.selected]);
  }

  /** Where the camera should frame: the line, leaning toward (or fully on) the chosen friend. */
  focus(out: THREE.Vector3) {
    const chosen = this.slots[this.selected].skier.root.position;
    return out.lerpVectors(this.center, chosen, this.launching ? 1 : 0.15).setY(this.center.y);
  }

  /** Half the width of the line, for fitting it into the view. */
  get halfWidth() {
    return ((this.slots.length - 1) / 2) * SPACING + 1;
  }

  private pose(index: number, walk: number, wave: number): PoseInput {
    // The others look around idly; the chosen one faces the camera.
    const look = index === this.selected ? 0 : Math.sin(this.time * 0.6 + index * 1.7) * 0.35;
    return { speed: 0, turn: look, tuck: false, brake: false, air: false, skate: 0, seated: false, crashed: false, squash: 0, walk, wave };
  }

  private place(slot: Slot) {
    const p = slot.skier.root.position.copy(slot.base).addScaledVector(this.fwd, -lerp(REST, READY, ease(slot.step)));
    p.y = this.world.terrain.heightAt(p.x, p.z) - SKI_THICKNESS;
  }

  private puff(at: THREE.Vector3, count: number, strength: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.emit(at, this.tmp.set(Math.cos(a) * strength, 0.8 + Math.random() * strength, Math.sin(a) * strength), {
        size: 0.12 + Math.random() * 0.12,
        life: 0.6,
      });
    }
  }

  private land(slot: Slot) {
    this.landed = true;
    slot.skis.visible = false;
    slot.skier.skis = true;
    slot.skier.root.position.copy(slot.base);
    slot.skier.root.rotation.y = this.heading;
    slot.label.remove();
    this.puff(slot.base, 16, 2.2);
    this.events.onLand(slot.skier, slot.base, this.heading);
  }

  private updateHop(slot: Slot, dt: number) {
    const before = this.launchTime;
    this.launchTime += dt;
    const t = this.launchTime;
    const root = slot.skier.root;
    let squash = 0;
    let air = false;
    if (t < CROUCH_TIME) {
      squash = 0.55 * (t / CROUCH_TIME);
    } else {
      if (before < CROUCH_TIME) {
        this.events.onHop();
        this.puff(this.hopFrom, 8, 1.2);
      }
      const u = Math.min(1, (t - CROUCH_TIME) / HOP_TIME);
      root.position.lerpVectors(this.hopFrom, slot.base, u);
      root.position.y += Math.sin(Math.PI * u) * HOP_HEIGHT - SKI_THICKNESS * (1 - u);
      air = u < 1;
      if (u >= 1) {
        this.land(slot);
        return;
      }
    }
    slot.skier.update(dt, { ...this.pose(this.selected, 0, 0), air, squash });
  }

  /** Animate the line; `watch` is where the departing skier is, once the run started. */
  update(dt: number, camera: THREE.Camera, watch?: THREE.Vector3) {
    if (this.retired) return;
    this.time += dt;
    this.slots.forEach((slot, index) => {
      const chosen = index === this.selected;
      if (chosen && this.landed) return;
      if (chosen && this.launching) {
        this.updateHop(slot, dt);
        return;
      }
      const target = chosen && !this.launching ? 1 : 0;
      const before = slot.step;
      slot.step += Math.sign(target - slot.step) * Math.min(Math.abs(target - slot.step), dt / STEP_TIME);
      const walking = slot.step !== before;
      if (!walking) slot.wave = Math.max(0, slot.wave - dt);
      this.place(slot);
      // Friends left behind turn to watch the run.
      const yaw = watch && this.landed ? Math.atan2(watch.x - slot.skier.root.position.x, watch.z - slot.skier.root.position.z) : this.heading;
      let d = yaw - slot.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      slot.yaw += d * damp(3, dt);
      slot.skier.root.rotation.y = slot.yaw;
      slot.skier.update(dt, this.pose(index, walking ? 1 : 0, !walking && slot.wave > 0 ? 1 : 0));
    });
    this.placeLabels(camera);
  }

  private placeLabels(camera: THREE.Camera) {
    if (this.launching) return;
    for (const slot of this.slots) {
      const p = this.tmp.copy(slot.skier.root.position);
      p.y += 2.25;
      p.project(camera);
      const visible = p.z < 1;
      slot.label.style.visibility = visible ? "" : "hidden";
      if (!visible) continue;
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      slot.label.style.left = `${x.toFixed(1)}px`;
      slot.label.style.top = `${y.toFixed(1)}px`;
    }
  }

  /** Clear the friends who stayed behind off the summit. */
  retire() {
    if (this.retired) return;
    this.retired = true;
    this.slots.forEach((slot, index) => {
      this.world.scene.remove(slot.skis);
      slot.skis.traverse((part) => {
        if (part instanceof THREE.Mesh) part.geometry.dispose();
      });
      slot.label.remove();
      if (index === this.selected && this.landed) return;
      this.world.scene.remove(slot.skier.root);
      slot.skier.dispose();
    });
  }
}
