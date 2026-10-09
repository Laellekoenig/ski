import type { World } from "./world";
import { BOUNDS, PISTES } from "./layout";
import { LAKE } from "./layout";

const MAP_W = 150;
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
  private lastDist = -1;
  private lastPrompt = "";

  constructor(world: World) {
    this.map = document.getElementById("minimap") as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.map.width = MAP_W * dpr;
    this.map.height = MAP_H * dpr;
    this.map.style.width = `${MAP_W}px`;
    this.map.style.height = `${MAP_H}px`;
    this.mapCtx = this.map.getContext("2d")!;
    this.mapCtx.scale(dpr, dpr);
    this.mapBg = this.drawMapBackground(world, dpr);
  }

  private toMap(x: number, z: number): [number, number] {
    return [((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * MAP_W, ((z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ)) * MAP_H];
  }

  private drawMapBackground(world: World, dpr: number) {
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
        const alt = Math.min(1, Math.max(0, h / 450));
        let r = (220 + alt * 30) * shade;
        let g = (230 + alt * 22) * shade;
        let b = 250 * shade;
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius) [r, g, b] = [150, 200, 235];
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
      ctx.fillRect(x - 0.6, y - 0.6, 1.3, 1.3);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    world.terrain.pistePaths.forEach((path, i) => {
      ctx.strokeStyle = `#${PISTES[i].color.toString(16).padStart(6, "0")}`;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
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
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 2]);
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
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
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

  update(dist: number, best: number, speed: number, prompt: string, px: number, pz: number, heading: number) {
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

    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.drawImage(this.mapBg, 0, 0, MAP_W, MAP_H);
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
