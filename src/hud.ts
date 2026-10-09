export class Hud {
  private distEl = document.getElementById("dist")!;
  private titleEl = document.getElementById("title")!;
  private hudEl = document.getElementById("hud")!;
  private endEl = document.getElementById("run-end")!;
  private lastDist = -1;

  showTitle(show: boolean) {
    this.titleEl.classList.toggle("hidden", !show);
    this.titleEl.inert = !show;
    this.hudEl.classList.toggle("hidden", show);
  }

  update(dist: number, finished: boolean) {
    const d = Math.floor(dist);
    if (d !== this.lastDist) {
      this.lastDist = d;
      this.distEl.textContent = d.toLocaleString("en-US");
    }
    this.endEl.hidden = !finished;
  }
}
