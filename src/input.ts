// Keyboard + gamepad input, merged into one state object each frame.

export interface InputState {
  /** -1 left .. 1 right */
  steer: number;
  tuck: boolean;
  brake: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  actionPressed: boolean;
  resetPressed: boolean;
  mutePressed: boolean;
  anyPressed: boolean;
}

const LEFT = ["KeyA", "ArrowLeft"];
const RIGHT = ["KeyD", "ArrowRight"];
const UP = ["KeyW", "ArrowUp"];
const DOWN = ["KeyS", "ArrowDown"];

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  readonly state: InputState = {
    steer: 0,
    tuck: false,
    brake: false,
    jumpHeld: false,
    jumpPressed: false,
    actionPressed: false,
    resetPressed: false,
    mutePressed: false,
    anyPressed: false,
  };

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
    window.addEventListener("pointerdown", () => this.pressed.add("Pointer"));
  }

  private any(codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  update() {
    const s = this.state;
    let steer = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    let tuck = this.any(UP);
    let brake = this.any(DOWN);
    let jumpHeld = this.down.has("Space");
    let jumpPressed = this.pressed.has("Space");
    let actionPressed = this.pressed.has("KeyE") || this.pressed.has("Enter");
    let resetPressed = this.pressed.has("KeyR");
    const mutePressed = this.pressed.has("KeyM");
    let anyPressed = this.pressed.size > 0;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) steer = ax;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => b(i) && !this.padPrev[i];
      tuck ||= b(7) || (pad.axes[1] ?? 0) < -0.5;
      brake ||= b(6) || (pad.axes[1] ?? 0) > 0.5;
      jumpHeld ||= b(0);
      jumpPressed ||= edge(0);
      actionPressed ||= edge(2) || edge(1);
      resetPressed ||= edge(3);
      anyPressed ||= pad.buttons.some((_, i) => edge(i));
      this.padPrev = pad.buttons.map((x) => x.pressed);
    }

    s.steer = Math.max(-1, Math.min(1, steer));
    s.tuck = tuck;
    s.brake = brake;
    s.jumpHeld = jumpHeld;
    s.jumpPressed = jumpPressed;
    s.actionPressed = actionPressed;
    s.resetPressed = resetPressed;
    s.mutePressed = mutePressed;
    s.anyPressed = anyPressed;
    this.pressed.clear();
  }
}
