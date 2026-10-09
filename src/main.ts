import "./style.css";
import * as THREE from "three";
import { World } from "./world";
import { Particles } from "./particles";
import { Trails } from "./trails";
import { Player } from "./player";
import { Input } from "./input";
import { Hud } from "./hud";
import { Audio } from "./audio";
import { damp, lerp } from "./noise";

const BEST_KEY = "a-short-ski.best";

// let the loading text paint before the heavy terrain generation
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 12000);

const world = new World(renderer);
const particles = new Particles();
world.scene.add(particles.mesh);
const trails = new Trails(world.terrain);
world.scene.add(trails.mesh);
const player = new Player(world, particles, trails);
const input = new Input();
const hud = new Hud(world);
const audio = new Audio();

let best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
player.spawnAtSummit();

function endRun(distance: number) {
  if (distance > best && distance > 20) {
    best = distance;
    localStorage.setItem(BEST_KEY, String(Math.floor(best)));
    hud.toast(`New best! ${Math.floor(distance).toLocaleString("en-US")} m`, "best");
    audio.best();
  } else if (distance > 20) {
    hud.toast(`Run: ${Math.floor(distance).toLocaleString("en-US")} m`, "info");
  }
}

player.events = {
  onJump: () => audio.jump(),
  onLand: (impact) => audio.land(impact),
  onCrash: () => {
    audio.crash();
    hud.toast(["Oof!", "Whoops!", "Bonk!", "Oopsie!"][Math.floor(Math.random() * 4)]);
  },
  onTrick: (label) => {
    audio.trick();
    hud.toast(label);
  },
  onBoard: (lift, dist) => {
    audio.board();
    endRun(dist);
    hud.toast(lift.def.name, "info");
  },
  onDismount: () => audio.board(),
};

// ---- camera rig
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camYaw = player.heading;
let started = false;
let titleTime = 0;

function snapCamera() {
  camYaw = player.heading;
  camPos.copy(player.pos).add(new THREE.Vector3(-Math.sin(camYaw) * 8, 3.5, -Math.cos(camYaw) * 8));
  camLook.copy(player.pos).add(new THREE.Vector3(0, 1.2, 0));
}
snapCamera();

const tmpV = new THREE.Vector3();
function updateCamera(dt: number) {
  const p = player.pos;
  if (!started) {
    // slow orbit around the skier for the title screen
    titleTime += dt;
    const a = player.heading + Math.PI + Math.sin(titleTime * 0.15) * 0.9;
    camPos.set(p.x + Math.sin(a) * 9, p.y + 3.2, p.z + Math.cos(a) * 9);
    camLook.copy(p).add(tmpV.set(Math.sin(player.heading) * 6, 1.6, Math.cos(player.heading) * 6));
    camera.fov = 50;
  } else if (player.state === "lift" && player.lift) {
    const l = player.lift;
    const want = tmpV.copy(p).addScaledVector(l.dir, -6).addScaledVector(l.right, 6.5);
    want.y += 2.5;
    camPos.lerp(want, damp(4, dt));
    camLook.lerp(tmpV.copy(p).addScaledVector(l.dir, 6).add(new THREE.Vector3(0, 1.2, 0)), damp(4, dt));
    camYaw = Math.atan2(l.dir.x, l.dir.z);
    camera.fov = lerp(camera.fov, 55, damp(3, dt));
  } else {
    const speed = player.speed;
    // follow the direction of travel when moving, otherwise the way the skis point
    const hv = Math.hypot(player.vel.x, player.vel.z);
    let targetYaw = player.heading;
    if (hv > 3) {
      const velYaw = Math.atan2(player.vel.x, player.vel.z);
      let d = velYaw - player.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      targetYaw = player.heading + d * Math.min(1, (hv - 3) / 8) * 0.7;
    }
    let dy = targetYaw - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * damp(player.state === "crash" ? 0.5 : 3.2, dt);
    const summitView = Math.max(0, 1 - Math.hypot(p.x, p.z) / 180);
    const dist = 5.2 + Math.min(speed, 30) * 0.07 + summitView * 10;
    const height = 2.3 + Math.min(speed, 30) * 0.025 + summitView * 10;
    const want = tmpV.set(p.x - Math.sin(camYaw) * dist, p.y + height, p.z - Math.cos(camYaw) * dist);
    // the slope ahead is lower: keep the camera above the ground behind us
    const ground = world.terrain.heightAt(want.x, want.z) + 1.6;
    if (want.y < ground) want.y = ground;
    camPos.lerp(want, damp(8, dt));
    const camGround = world.terrain.heightAt(camPos.x, camPos.z) + 1.2;
    if (camPos.y < camGround) camPos.y = camGround;
    const look = tmpV.set(p.x + Math.sin(camYaw) * 3, p.y + 0.9, p.z + Math.cos(camYaw) * 3);
    camLook.lerp(look, damp(14, dt));
    // Keep the skier visible when the camera is still behind a takeoff lip.
    for (let u = 0.15; u < 0.9; u += 0.15) {
      const x = lerp(camPos.x, p.x, u);
      const z = lerp(camPos.z, p.z, u);
      const clearance = world.terrain.heightAt(x, z) + 0.5 - lerp(camPos.y, p.y + 1, u);
      if (clearance > 0) camPos.y += clearance / (1 - u);
    }
    camera.fov = lerp(camera.fov, 55 + Math.min(1, speed / 32) * 14, damp(2, dt));
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();
}

// ---- start / resize
function start() {
  if (started) return;
  started = true;
  hud.showTitle(false);
  audio.start();
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById("loading")!.style.opacity = "0";
setTimeout(() => document.getElementById("loading")?.remove(), 700);

// ---- loop
const debug = { freezeCamera: false, pauseSimulation: false };
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let time = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  input.update();
  const st = input.state;
  if (!started && st.anyPressed) start();
  if (st.mutePressed) audio.toggleMute();

  if (started && st.mapPressed) hud.toggleMap();
  if (st.closeMapPressed && hud.mapOpen) hud.toggleMap(false);

  if (started && !hud.mapOpen && !debug.pauseSimulation) {
    if (st.resetPressed) {
      endRun(player.runDistance);
      player.runDistance = 0;
      player.spawnAtSummit();
      snapCamera();
    }
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      acc -= STEP;
      player.update(STEP, st);
      if (first) {
        // edge-triggered inputs only fire once per frame
        st.jumpPressed = st.actionPressed = false;
        first = false;
      }
    }
  } else if (!started) {
    player.idle(dt, { ...st, steer: 0, tuck: false, brake: false });
  }

  particles.update(dt);
  world.update(dt, time, player.pos, particles);
  if (!debug.freezeCamera) updateCamera(dt);

  let prompt = "";
  if (player.state === "lift" && player.lift) prompt = `riding ${player.lift.def.name} · hold <kbd>Space</kbd> to hurry`;
  else if (player.nearbyLift) prompt = `<kbd>E</kbd> ride the ${player.nearbyLift.def.name}`;
  hud.update(player.runDistance, best, player.speed, started ? prompt : "", player.pos.x, player.pos.z, player.heading, player.surface);
  audio.update(hud.mapOpen ? 0 : player.speed, player.skid, player.grounded, player.state === "lift");

  renderer.render(world.scene, camera);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // test helper: run the simulation headlessly for `seconds` with fixed inputs, then render one frame
  const sim = (seconds: number, keys: Partial<typeof input.state> = {}, sample?: () => void) => {
    started = true;
    hud.showTitle(false);
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      player.update(STEP, { ...input.state, ...keys, jumpPressed: i === 0 && !!keys.jumpPressed, actionPressed: i === 0 && !!keys.actionPressed });
      particles.update(STEP);
      world.update(STEP, (time += STEP), player.pos, particles);
      updateCamera(STEP);
      sample?.();
    }
    renderer.render(world.scene, camera);
  };
  Object.assign(window, { game: { player, world, camera, renderer, input, hud, sim, snapCamera, debug } });
}
