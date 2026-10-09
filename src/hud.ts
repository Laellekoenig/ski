import type { World } from "./world";
import { BOUNDS, KICKERS, LAKES, PISTES, REGIONS, landscapeAt } from "./layout";
import type { Surface } from "./terrain";

const MAP_W = 190;
const MAP_H = Math.round((MAP_W * (BOUNDS.maxZ - BOUNDS.minZ)) / (BOUNDS.maxX - BOUNDS.minX));

const fmt = (m: number) => `${Math.floor(m).toLocaleString("en-US")}`;

export class Hud {
  private distEl = document.getElementById("dist")!;
  private bestEl = document.getElementById("best")!;
  private speedEl = document.getElementById("speed")!;
  private promptEl = document.getElementById("prompt")!;
  private toastEl = document.getElementById("toasts")!;
  private titleEl = document.getElementById("title")!;
  private hudEl = document.getElementById("hud")!;
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapBg: HTMLCanvasElement;
  private largeMap = document.getElementById("trail-map") as HTMLCanvasElement;
  private largeCtx: CanvasRenderingContext2D;
  private largeBg: HTMLCanvasElement;
  private regionEl = document.getElementById("region-name")!;
  private conditionsEl = document.getElementById("conditions")!;
  private altitudeEl = document.getElementById("altitude")!;
  private world: World;
  mapOpen = false;
  onMapChange: () => void = () => {};
  private lastDist = -1;
  private lastPrompt = "";

  constructor(world: World) {
    this.world = world;
    this.map = document.getElementById("minimap") as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.map.width = MAP_W * dpr;
    this.map.height = MAP_H * dpr;
    this.map.style.width = `${MAP_W}px`;
    this.map.style.height = `${MAP_H}px`;
    this.mapCtx = this.map.getContext("2d")!;
    this.mapCtx.scale(dpr, dpr);
    this.mapBg = this.drawMapBackground(world, dpr);
    this.largeMap.width = this.largeMap.height = 760;
    this.largeCtx = this.largeMap.getContext("2d")!;
    this.largeBg = this.drawMapBackground(world, 4, true);
    document.getElementById("open-map")!.addEventListener("click", () => this.toggleMap());
    document.getElementById("close-map")!.addEventListener("click", () => this.toggleMap(false));
  }

  private toMap(x: number, z: number): [number, number] {
    return [((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * MAP_W, ((z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ)) * MAP_H];
  }

  private drawMapBackground(world: World, dpr: number, detail = false) {
    const c = document.createElement("canvas");
    c.width = MAP_W * dpr;
    c.height = MAP_H * dpr;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    const t = world.terrain;
    for (let py = 0; py < c.height; py++) {
      for (let px = 0; px < c.width; px++) {
        const x = BOUNDS.minX + (px / c.width) * (BOUNDS.maxX - BOUNDS.minX);
        const z = BOUNDS.minZ + (py / c.height) * (BOUNDS.maxZ - BOUNDS.minZ);
        const h = t.heightAt(x, z);
        const hx = t.heightAt(x + 4, z) - h;
        const hz = t.heightAt(x, z + 4) - h;
        const shade = Math.max(0.55, Math.min(1.08, 0.92 + hx * 0.06 - hz * 0.04));
        const alt = Math.min(1, Math.max(0, h / 640));
        let r = (220 + alt * 30) * shade;
        let g = (230 + alt * 22) * shade;
        let b = 250 * shade;
        const region = landscapeAt(x, z);
        if (region === "rock") { r -= 12; g -= 19; b -= 18; }
        if (region === "storm") { r -= 23; g -= 14; b -= 4; }
        if (region === "powder") { r -= 21; g -= 5; b -= 13; }
        if (h % 40 < 2.2) { r -= 14; g -= 12; b -= 9; }
        if (LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < lake.radius)) [r, g, b] = [105, 189, 210];
        const o = (py * c.width + px) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "rgba(47,122,78,0.55)";
    for (const tr of world.trees) {
      const [x, y] = this.toMap(tr.x, tr.z);
      ctx.fillRect(x - 0.25, y - 0.25, 0.55, 0.55);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    world.terrain.pistePaths.forEach((path, i) => {
      ctx.strokeStyle = `#${PISTES[i].color.toString(16).padStart(6, "0")}`;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = PISTES[i].connector ? 0.85 : 1.35;
      ctx.beginPath();
      path.forEach((p, k) => {
        const [x, y] = this.toMap(p.x, p.z);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    for (const l of world.lifts) {
      const [x0, y0] = this.toMap(l.bottom.x, l.bottom.z);
      const [x1, y1] = this.toMap(l.top.x, l.top.z);
      ctx.strokeStyle = "#2b2f36";
      ctx.lineWidth = 0.65;
      ctx.setLineDash([1.5, 1.5]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of [
        [x0, y0],
        [x1, y1],
      ]) {
        ctx.fillStyle = `#${l.def.color.toString(16).padStart(6, "0")}`;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // All jump lips are marked, so transfers and optional gaps are discoverable.
    ctx.fillStyle = "#ec872c";
    for (const jump of KICKERS) {
      const [x, y] = this.toMap(jump.x, jump.z);
      ctx.beginPath(); ctx.moveTo(x, y - 1.6); ctx.lineTo(x + 1.5, y + 1.1); ctx.lineTo(x - 1.5, y + 1.1); ctx.closePath(); ctx.fill();
    }
    if (detail) {
      const label = (text: string, x: number, z: number, size = 3.5) => {
        const [mx, my] = this.toMap(x, z);
        ctx.font = `600 ${size}px Fredoka, sans-serif`;
        ctx.textAlign = "center";
        ctx.strokeStyle = "rgba(248,251,255,0.94)"; ctx.lineWidth = 1.5;
        ctx.strokeText(text, mx, my); ctx.fillStyle = "#30445b"; ctx.fillText(text, mx, my);
      };
      label("GRANITE WILDS", -790, -1080, 4.3);
      label("WHITEOUT GLACIER", 750, -1080, 4.3);
      label("POWDER GARDENS", -790, 1080, 4.3);
      label("MIRROR LAKES", 790, 1080, 4.3);
      PISTES.slice(0, 8).forEach((p) => {
        const point = p.points[6]; label(p.name, point.x, point.z - 52);
      });
      label("SUMMIT · 640 m", 0, -110, 3.5);
      LAKES.forEach((lake) => label(lake.name, lake.x, lake.z + lake.radius + 35, 2.9));
      label("N", 0, -1260, 4.2); label("S", 0, 1300, 4.2);
      label("W", -1260, 0, 4.2); label("E", 1260, 0, 4.2);
    }
    // summit
    const [sx, sy] = this.toMap(world.summit.x, world.summit.z);
    ctx.fillStyle = "#6e4129";
    ctx.font = "bold 9px Fredoka, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("▲", sx, sy + 3);
    return c;
  }

  showTitle(show: boolean) {
    this.titleEl.classList.toggle("hidden", !show);
    this.hudEl.classList.toggle("hidden", show);
  }

  toggleMap(open = !this.mapOpen) {
    if (open === this.mapOpen) return;
    this.mapOpen = open;
    const panel = document.getElementById("map-panel")!;
    panel.hidden = !open;
    document.getElementById("open-map")!.setAttribute("aria-expanded", String(open));
    this.onMapChange();
    if (open) document.getElementById("close-map")!.focus();
    else document.getElementById("open-map")!.focus();
  }

  update(dist: number, best: number, speed: number, prompt: string, px: number, pz: number, heading: number, surface: Surface) {
    const d = Math.floor(dist);
    if (d !== this.lastDist) {
      this.lastDist = d;
      this.distEl.textContent = fmt(d);
    }
    this.bestEl.textContent = fmt(best);
    this.speedEl.textContent = `${Math.round(speed * 3.6)}`;
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.promptEl.innerHTML = prompt;
      this.promptEl.classList.toggle("show", prompt !== "");
    }

    const region = REGIONS[landscapeAt(px, pz)];
    this.regionEl.textContent = region.name;
    const condition = this.world.weather.intensity > 0.45 ? "Snowstorm · low visibility" : surface === "ice" ? "Frozen lake · slippery ice" : surface === "powder" ? "Deep powder · soft & slow" : region.detail;
    this.conditionsEl.textContent = condition;
    this.altitudeEl.textContent = `${Math.round(this.world.terrain.heightAt(px, pz))} m`;
    this.regionEl.style.setProperty("--region-color", region.color);
    this.drawPlayerMap(this.mapCtx, this.mapBg, px, pz, heading);
    if (this.mapOpen) {
      this.largeCtx.save(); this.largeCtx.scale(4, 4);
      this.drawPlayerMap(this.largeCtx, this.largeBg, px, pz, heading);
      this.largeCtx.restore();
    }
  }

  private drawPlayerMap(ctx: CanvasRenderingContext2D, bg: HTMLCanvasElement, px: number, pz: number, heading: number) {
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.drawImage(bg, 0, 0, MAP_W, MAP_H);
    const [x, y] = this.toMap(px, pz);
    ctx.save();
    ctx.translate(x, y);
    // heading 0 faces +z, which is "down" on the map
    ctx.rotate(-heading);
    ctx.fillStyle = "#e8423f";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(4, -4);
    ctx.lineTo(0, -2);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  toast(text: string, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastEl.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
}
