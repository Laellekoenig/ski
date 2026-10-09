import "./style.css";
import * as THREE from "three";
import { World } from "./world";
import { Weather } from "./weather";
import { Particles } from "./particles";
import { Trails } from "./trails";
import { Player } from "./player";
import { Input, type InputState } from "./input";
import { Hud } from "./hud";
import { Audio } from "./audio";
import { PauseMenu } from "./pause";
import { damp, lerp } from "./noise";
import { Lineup } from "./lineup";
import { loadEngadine } from "./engadine";

const BEST_KEY = "a-short-ski.best";

// let the loading text paint before the heavy terrain generation
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

try {
  await loadEngadine();
} catch (error) {
  document.getElementById("loading")!.textContent = "The mountain couldn’t load. Please reload to try again.";
  throw error;
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 60000);

const world = new World(renderer);
const weather = new Weather(world.scene);
const particles = new Particles();
world.scene.add(particles.mesh);
const trails = new Trails(world.terrain);
world.scene.add(trails.mesh);
const player = new Player(world, particles, trails);
const input = new Input();
const hud = new Hud();
const audio = new Audio();
const pause = new PauseMenu();
let overlayChanged = false;

let best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
player.spawnAtSummit();
player.visible = false;

function endRun(distance: number) {
  if (distance > best && distance > 20) {
    best = distance;
    localStorage.setItem(BEST_KEY, String(Math.floor(best)));
    audio.best();
  }
}

function resetRun() {
  lineup.retire();
  endRun(player.runDistance);
  player.runDistance = 0;
  player.spawnAtSummit();
  snapCamera();
}

function syncOverlays() {
  const paused = pause.open;
  document.body.classList.toggle("playing", started && !paused);
  document.getElementById("hud")!.inert = !started || paused;
  audio.setPaused(paused);
}

function setPaused(paused: boolean) {
  pause.show(paused);
  overlayChanged = true;
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
  onFinish: endRun,
};

// ---- camera rig
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camYaw = player.heading;
/** the run is on: the chosen friend has landed on its skis */
let started = false;
let titleTime = 0;
/** title shot around the lineup, then a sweep from it to the follow camera */
const shotFocus = new THREE.Vector3();
let shotDist = 0;
const INTRO_TIME = 1.5;
let introT = 1;
let introAngle = 0;
let introTurn = 0;
let introRadius = 0;
let introHeight = 0;
const introLook = new THREE.Vector3();

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
    // face the lineup from just downhill, swaying gently; close in on the chosen friend at the start
    titleTime += dt;
    camera.fov = 50;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fit = (lineup.halfWidth + 1) / (halfH * camera.aspect);
    const wantDist = lineup.launching ? 5.2 : Math.max(6.5, fit);
    if (!shotDist) {
      shotDist = wantDist;
      lineup.focus(shotFocus);
    }
    shotDist = lerp(shotDist, wantDist, damp(2.5, dt));
    shotFocus.lerp(lineup.focus(tmpV), damp(3, dt));
    const a = lineup.heading + Math.sin(titleTime * 0.25) * 0.14;
    camPos.set(shotFocus.x + Math.sin(a) * shotDist, shotFocus.y + 1.2 + shotDist * 0.1, shotFocus.z + Math.cos(a) * shotDist);
    camLook.copy(shotFocus).y += 0.6;
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
    const summitView = Math.max(0, 1 - Math.hypot(p.x, p.z) / 100);
    const dist = 5.2 + Math.min(speed, 30) * 0.07 + summitView * 1.5;
    const height = 2.3 + Math.min(speed, 30) * 0.025 + summitView * 1.5;
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
  blendIntro(dt);
  camera.position.copy(viewPos);
  camera.lookAt(viewLook);
  camera.updateProjectionMatrix();
}

/** Sweep around the skier from the lineup shot to the follow camera, rising as it goes. */
function blendIntro(dt: number) {
  if (introT >= 1) return;
  introT = Math.min(1, introT + dt / INTRO_TIME);
  const e = introT * introT * (3 - 2 * introT);
  const p = player.pos;
  const ox = viewPos.x - p.x;
  const oz = viewPos.z - p.z;
  // keep turning the same way round, even as the target swings past straight behind
  let turn = Math.atan2(Math.sin(Math.atan2(ox, oz) - introAngle), Math.cos(Math.atan2(ox, oz) - introAngle));
  if (introTurn && Math.abs(turn - introTurn) > Math.PI) turn += Math.sign(introTurn - turn) * Math.PI * 2;
  introTurn = turn || 1e-6;
  const angle = introAngle + turn * e;
  const radius = lerp(introRadius, Math.hypot(ox, oz), e);
  viewPos.set(p.x + Math.sin(angle) * radius, p.y + lerp(introHeight, viewPos.y - p.y, e), p.z + Math.cos(angle) * radius);
  viewPos.y = Math.max(viewPos.y, world.terrain.heightAt(viewPos.x, viewPos.z) + 1.2);
  viewLook.lerpVectors(tmpV.copy(p).add(introLook), viewLook, e);
}

// ---- start / resize
const lineup = new Lineup(world, particles, {
  onHop: () => audio.jump(),
  onLand: (skier, at, heading) => {
    audio.land(4);
    player.adoptSkier(skier, 0.45);
    player.spawnAt(at.x, at.z, heading);
    player.visible = true;
    // remember the lineup shot relative to the skier, then hand over to the follow camera
    introAngle = Math.atan2(camera.position.x - at.x, camera.position.z - at.z);
    introRadius = Math.hypot(camera.position.x - at.x, camera.position.z - at.z);
    introHeight = camera.position.y - player.pos.y;
    introLook.copy(viewLook).sub(player.pos);
    introTurn = 0;
    introT = 0;
    snapCamera();
    started = true;
    syncOverlays();
  },
});

/** Enter on the title: the chosen friend hops onto its skis, and the run begins on landing. */
function start(instant = false) {
  if (started) return;
  if (!lineup.launching) {
    hud.showTitle(false);
    audio.start();
  }
  if (instant) {
    lineup.finishLaunch();
    introT = 1;
  } else lineup.launch();
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

function updateHud() {
  hud.update(player.runDistance, player.finished);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update();
  const st = input.state;
  const wasPaused = pause.open;
  if (!started) {
    if (st.characterPressed >= 0) lineup.select(st.characterPressed);
    if (st.characterStep) lineup.step(st.characterStep);
    if (st.startPressed) start();
    // Confirming the choice must not also jump.
    st.jumpPressed = st.actionPressed = false;
  } else if (st.pausePressed) setPaused(!pause.open);
  else if (pause.open) pause.update(st);
  if (st.mutePressed) audio.toggleMute();

  // Freeze the pause menu and its closing frame so input cannot spill into skiing.
  if (wasPaused || pause.open || overlayChanged) {
    overlayChanged = false;
    updateHud();
    renderer.render(world.scene, camera);
    return;
  }

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
  }
  // the friends left behind cheer the run off, then leave the summit once it is out of sight
  if (started && player.pos.distanceTo(lineup.center) > 120) lineup.retire();
  lineup.update(dt, camera, started ? player.pos : undefined);

  particles.update(dt);
  world.update(player.pos, dt);
  if (started) updateLook(dt, st);
  if (!debug.freezeCamera) updateCamera(dt);
  weather.update(dt, camera, renderer);

  updateHud();
  audio.update(player.speed, player.skid, player.grounded, false);

  renderer.render(world.scene, camera);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // test helper: run the simulation headlessly for `seconds` with fixed inputs, then render one frame
  const sim = (seconds: number, keys: Partial<typeof input.state> = {}, sample?: () => void) => {
    start(true);
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      player.update(STEP, { ...input.state, ...keys, jumpPressed: i === 0 && !!keys.jumpPressed, actionPressed: i === 0 && !!keys.actionPressed });
      particles.update(STEP);
      world.update(player.pos, STEP);
      updateLook(STEP, { ...input.state, lookDX: 0, lookDY: 0 });
      updateCamera(STEP);
      sample?.();
    }
    if (player.pos.distanceTo(lineup.center) > 120) lineup.retire();
    updateHud();
    renderer.render(world.scene, camera);
  };
  Object.assign(window, { game: { player, world, weather, camera, renderer, input, hud, lineup, sim, snapCamera, debug } });
}
