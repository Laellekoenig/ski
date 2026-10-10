// Keyboard + gamepad input, merged into one state object each frame.

export interface InputState {
  /** -1 left .. 1 right */
  steer: number;
  tuck: boolean;
  /** Shift: drop into a low racing crouch, faster but with little steering. */
  duck: boolean;
  brake: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  /** Double-tapped A / D this frame: -1 swings left, 1 right, 0 none. */
  swingPressed: number;
  actionPressed: boolean;
  resetPressed: boolean;
  mutePressed: boolean;
  startPressed: boolean;
  /** Zero-based roster slot; -1 when no number key was pressed. */
  characterPressed: number;
  characterStep: number;
  pausePressed: boolean;
  /** pause menu navigation, edge-triggered */
  menuUp: boolean;
  menuDown: boolean;
  confirmPressed: boolean;
  /** mouse drag-to-look: held, plus pixels moved since last frame */
  looking: boolean;
  lookDX: number;
  lookDY: number;
}

const LEFT = ["KeyA", "ArrowLeft"];
const RIGHT = ["KeyD", "ArrowRight"];
/** Q / E: a wider, gentler curve than A / D. */
const GENTLE_LEFT = ["KeyQ"];
const GENTLE_RIGHT = ["KeyE"];
export const GENTLE_STEER = 0.4;
const UP = ["KeyW", "ArrowUp"];
const DOWN = ["KeyS", "ArrowDown"];
const DUCK = ["ShiftLeft", "ShiftRight"];
/** Second tap on the same side within this many ms counts as a double tap. */
const DOUBLE_TAP_MS = 280;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  private lastTap = { side: 0, at: -Infinity };
  private swing = 0;
  private dragId: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private lastX = 0;
  private lastY = 0;
  readonly state: InputState = {
    steer: 0,
    tuck: false,
    duck: false,
    brake: false,
    jumpHeld: false,
    jumpPressed: false,
    swingPressed: 0,
    actionPressed: false,
    resetPressed: false,
    mutePressed: false,
    startPressed: false,
    characterPressed: -1,
    characterStep: 0,
    pausePressed: false,
    menuUp: false,
    menuDown: false,
    confirmPressed: false,
    looking: false,
    lookDX: 0,
    lookDY: 0,
  };

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        this.tap(e.code, e.timeStamp);
      }
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => {
      this.down.clear();
      this.pressed.clear();
      this.swing = 0;
    });
    const canvas = document.getElementById("game")!;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.dragId !== null) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.dragId) return;
      this.dragX += e.clientX - this.lastX;
      this.dragY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.dragId) return;
      this.dragId = null;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
  }

  private tap(code: string, at: number) {
    const side = RIGHT.includes(code) ? 1 : LEFT.includes(code) ? -1 : 0;
    if (!side) return;
    if (this.lastTap.side === side && at - this.lastTap.at < DOUBLE_TAP_MS) {
      this.swing = side;
      // a third tap starts a fresh pair instead of swinging again
      this.lastTap = { side: 0, at: -Infinity };
    } else this.lastTap = { side, at };
  }

  private any(codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  update() {
    const s = this.state;
    const side = (full: string[], gentle: string[]) => (this.any(full) ? 1 : this.any(gentle) ? GENTLE_STEER : 0);
    let steer = side(RIGHT, GENTLE_RIGHT) - side(LEFT, GENTLE_LEFT);
    let tuck = this.any(UP);
    let brake = this.any(DOWN);
    let duck = this.any(DUCK);
    let jumpHeld = this.down.has("Space");
    let jumpPressed = this.pressed.has("Space");
    let actionPressed = this.pressed.has("Enter");
    let resetPressed = this.pressed.has("KeyR");
    const mutePressed = this.pressed.has("KeyM");
    let startPressed = this.pressed.has("Enter") || this.pressed.has("NumpadEnter") || this.pressed.has("Space");
    let characterPressed = -1;
    for (const code of this.pressed) {
      const match = /^(?:Digit|Numpad)([1-7])$/.exec(code);
      if (match) characterPressed = Number(match[1]) - 1;
    }
    let characterStep = (this.pressed.has("ArrowRight") ? 1 : 0) - (this.pressed.has("ArrowLeft") ? 1 : 0);
    let pausePressed = this.pressed.has("Escape") || this.pressed.has("KeyP");
    let menuUp = UP.some((c) => this.pressed.has(c));
    let menuDown = DOWN.some((c) => this.pressed.has(c));
    let confirmPressed = jumpPressed || actionPressed;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) steer = ax;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => b(i) && !this.padPrev[i];
      tuck ||= b(7) || (pad.axes[1] ?? 0) < -0.5;
      brake ||= b(6) || (pad.axes[1] ?? 0) > 0.5;
      duck ||= b(5);
      jumpHeld ||= b(0);
      jumpPressed ||= edge(0);
      actionPressed ||= edge(2) || edge(1);
      resetPressed ||= edge(3);
      startPressed ||= edge(0) || edge(9);
      characterStep += (edge(15) || edge(5) ? 1 : 0) - (edge(14) || edge(4) ? 1 : 0);
      pausePressed ||= edge(9);
      menuUp ||= edge(12);
      menuDown ||= edge(13);
      confirmPressed ||= edge(0);
      this.padPrev = pad.buttons.map((x) => x.pressed);
    } else this.padPrev = [];

    s.steer = Math.max(-1, Math.min(1, steer));
    s.tuck = tuck;
    s.duck = duck;
    s.brake = brake;
    s.jumpHeld = jumpHeld;
    s.jumpPressed = jumpPressed;
    s.swingPressed = this.swing;
    this.swing = 0;
    s.actionPressed = actionPressed;
    s.resetPressed = resetPressed;
    s.mutePressed = mutePressed;
    s.startPressed = startPressed;
    s.characterPressed = characterPressed;
    s.characterStep = characterStep;
    s.pausePressed = pausePressed;
    s.menuUp = menuUp;
    s.menuDown = menuDown;
    s.confirmPressed = confirmPressed;
    s.looking = this.dragId !== null;
    s.lookDX = this.dragX;
    s.lookDY = this.dragY;
    this.dragX = this.dragY = 0;
    this.pressed.clear();
  }
}
