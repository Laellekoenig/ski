import type { CarveMeter } from "./player";

/** Seconds the carve meter lingers after a turn is let go. */
const CARVE_LINGER = 0.6;

export class Hud {
  private distEl = document.getElementById("dist")!;
  private titleEl = document.getElementById("title")!;
  private hudEl = document.getElementById("hud")!;
  private endEl = document.getElementById("run-end")!;
  private fadeEl = document.getElementById("fade")!;
  private carveEl = document.getElementById("carve-meter")!;
  private carveLabel = this.carveEl.querySelector(".carve-label")!;
  private carveResult = "";
  private lastDist = -1;
  private lastFade = 0;

  showTitle(show: boolean) {
    this.titleEl.classList.toggle("hidden", !show);
    this.titleEl.inert = !show;
    this.hudEl.classList.toggle("hidden", show);
  }

  /** `fade` washes the screen out to snow white, 0..1. */
  update(dist: number, finished: boolean, fade: number) {
    const d = Math.floor(dist);
    if (d !== this.lastDist) {
      this.lastDist = d;
      this.distEl.textContent = d.toLocaleString("en-US");
    }
    this.endEl.hidden = !finished;
    if (fade !== this.lastFade) {
      this.lastFade = fade;
      this.fadeEl.style.opacity = String(fade);
    }
  }

  /** The carve meter, pinned beside the rider's leg at screen position `x`, `y` (null when off screen). */
  updateCarve(c: CarveMeter, at: { x: number; y: number } | null) {
    const el = this.carveEl;
    const shown = !!at && (c.side !== 0 || c.released < CARVE_LINGER);
    el.classList.toggle("shown", shown);
    if (!shown) return;
    el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
    el.style.setProperty("--charge", c.charge.toFixed(3));
    el.style.setProperty("--lo", c.sweetLo.toFixed(3));
    el.style.setProperty("--hi", c.sweetHi.toFixed(3));
    el.style.setProperty("--red", c.red.toFixed(3));
    if (c.result !== this.carveResult) {
      this.carveResult = c.result;
      el.classList.remove("carve", "wash");
      if (c.result) {
        // restart the pop animation, even for two carves in a row
        void el.offsetWidth;
        el.classList.add(c.result);
      }
      this.carveLabel.textContent = c.result === "carve" ? "Carve!" : c.result === "wash" ? "Too long" : "";
    }
  }
}
