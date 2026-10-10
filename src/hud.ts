export class Hud {
  private distEl = document.getElementById("dist")!;
  private titleEl = document.getElementById("title")!;
  private hudEl = document.getElementById("hud")!;
  private endEl = document.getElementById("run-end")!;
  private fadeEl = document.getElementById("fade")!;
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
}
