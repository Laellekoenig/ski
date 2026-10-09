import "./style.css";
import * as THREE from "three";
import { World } from "./world";
import { Particles } from "./particles";
import { Trails } from "./trails";
import { Player } from "./player";
import { Input, type InputState } from "./input";
import { Hud } from "./hud";
import { Audio } from "./audio";
import { PauseMenu } from "./pause";
import { damp, lerp } from "./noise";
import { CharacterSelect } from "./character-select";

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
const pause = new PauseMenu();
let overlayChanged = false;

let best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
player.spawnAtSummit();

function endRun(distance: number) {
  if (distance > best && distance > 20) {
    best = distance;
    localStorage.setItem(BEST_KEY, String(Math.floor(best)));
    audio.best();
  }
}

function resetRun() {
  endRun(player.runDistance);
  player.runDistance = 0;
  player.spawnAtSummit();
  snapCamera();
}

function syncOverlays() {
  const paused = pause.open || hud.mapOpen;
  document.body.classList.toggle("playing", started && !paused);
  document.getElementById("hud")!.inert = !started || paused;
  audio.setPaused(paused);
}

hud.onMapChange = () => {
  overlayChanged = true;
  syncOverlays();
};

function setPaused(paused: boolean) {
  pause.show(paused);
  overlayChanged = true;
  if (paused) hud.toggleMap(false);
  syncOverlays();
}

pause.onChoose = (choice) => {
  setPaused(false);
  if (choice === "reset") resetRun();
};

player.events = {
  onJump: () => audio.jump(),
  onLand: (impact) => audio.land(impact),
  onCrash: () => audio.crash(),
  onTrick: () => audio.trick(),
  onBoard: (_lift, dist) => {
    audio.board();
    endRun(dist);
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

// ---- drag-to-look: orbit the usual shot around the skier, easing back once released
const LOOK_ELEV_MIN = -0.2;
const LOOK_ELEV_MAX = 1.3;
let lookYaw = 0;
let lookPitch = 0;
const viewPos = new THREE.Vector3();
const viewLook = new THREE.Vector3();
const lookFocus = new THREE.Vector3();
const lookAxis = new THREE.Vector3();
const lookQ = new THREE.Quaternion();
const pitchQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function updateLook(dt: number, st: InputState) {
  if (st.looking) {
    const k = Math.PI / window.innerHeight;
    lookYaw -= st.lookDX * k;
    lookPitch += st.lookDY * k;
  } else {
    lookYaw = lerp(lookYaw, 0, damp(5, dt));
    lookPitch = lerp(lookPitch, 0, damp(5, dt));
    if (Math.abs(lookYaw) < 1e-4) lookYaw = 0;
    if (Math.abs(lookPitch) < 1e-4) lookPitch = 0;
  }
  // keep the shortest way home after spinning around a few times
  lookYaw = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw));
}

function applyLook() {
  viewPos.copy(camPos);
  viewLook.copy(camLook);
  if (lookYaw === 0 && lookPitch === 0) return;
  lookFocus.copy(player.pos).y += 1.2;
  const offset = viewPos.sub(lookFocus);
  const elev = Math.asin(offset.y / offset.length());
  // store the clamped pitch so dragging past a limit doesn't wind up
  lookPitch = Math.min(LOOK_ELEV_MAX, Math.max(LOOK_ELEV_MIN, elev + lookPitch)) - elev;
  pitchQ.setFromAxisAngle(lookAxis.crossVectors(offset, UP).normalize(), lookPitch);
  lookQ.setFromAxisAngle(UP, lookYaw).multiply(pitchQ);
  viewPos.applyQuaternion(lookQ).add(lookFocus);
  viewLook.sub(lookFocus).applyQuaternion(lookQ).add(lookFocus);
  const ground = world.terrain.heightAt(viewPos.x, viewPos.z) + 1.2;
  if (viewPos.y < ground) viewPos.y = ground;
}

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
  applyLook();
  camera.position.copy(viewPos);
  camera.lookAt(viewLook);
  camera.updateProjectionMatrix();
}

// ---- start / resize
function start() {
  if (started) return;
  started = true;
  player.skier.root.visible = true;
  hud.showTitle(false);
  audio.start();
  // Let the title fade before releasing the preview models and WebGL context.
  setTimeout(() => characterSelect.dispose(), 550);
  syncOverlays();
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const characterSelect = new CharacterSelect((character) => {
  player.selectCharacter(character);
  hud.setCharacter(character);
}, start);

document.getElementById("loading")!.style.opacity = "0";
setTimeout(() => document.getElementById("loading")?.remove(), 700);

// ---- loop
const debug = { freezeCamera: false, pauseSimulation: false };
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let time = 0;

function updateHud() {
  hud.update(player.runDistance, player.pos.x, player.pos.z, player.heading);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update();
  const st = input.state;
  const wasPaused = pause.open || hud.mapOpen;
  if (!started) {
    if (st.characterPressed >= 0) characterSelect.select(st.characterPressed);
    if (st.characterStep) characterSelect.step(st.characterStep);
    if (st.startPressed) start();
    // Confirming the choice must not also jump or board a lift.
    st.jumpPressed = st.actionPressed = false;
  } else if (hud.mapOpen) {
    // Escape belongs to the map while it is open; P / gamepad Start opens pause.
    if (st.closeMapPressed || st.mapPressed) hud.toggleMap(false);
    else if (st.pausePressed) setPaused(true);
  } else if (started && st.pausePressed) setPaused(!pause.open);
  else if (pause.open) pause.update(st);
  else if (started && st.mapPressed) hud.toggleMap();
  if (st.mutePressed) audio.toggleMute();

  // Freeze both overlays, including their closing frame, so menu input never
  // spills into jumping/boarding. Refresh the HUD to paint a newly opened map.
  if (wasPaused || pause.open || hud.mapOpen || overlayChanged) {
    overlayChanged = false;
    updateHud();
    renderer.render(world.scene, camera);
    return;
  }
  time += dt;

  if (started && !debug.pauseSimulation) {
    if (st.resetPressed) resetRun();
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
  updateLook(dt, st);
  if (!debug.freezeCamera) updateCamera(dt);

  updateHud();
  audio.update(player.speed, player.skid, player.grounded, player.state === "lift");

  player.skier.root.visible = started;
  renderer.render(world.scene, camera);
  if (!started) characterSelect.update(dt);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // test helper: run the simulation headlessly for `seconds` with fixed inputs, then render one frame
  const sim = (seconds: number, keys: Partial<typeof input.state> = {}, sample?: () => void) => {
    start();
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      player.update(STEP, { ...input.state, ...keys, jumpPressed: i === 0 && !!keys.jumpPressed, actionPressed: i === 0 && !!keys.actionPressed });
      particles.update(STEP);
      world.update(STEP, (time += STEP), player.pos, particles);
      updateLook(STEP, { ...input.state, lookDX: 0, lookDY: 0 });
      updateCamera(STEP);
      sample?.();
    }
    renderer.render(world.scene, camera);
  };
  Object.assign(window, { game: { player, world, camera, renderer, input, hud, sim, snapCamera, debug } });
}
