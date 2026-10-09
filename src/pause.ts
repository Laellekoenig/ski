import type { InputState } from "./input";

export type PauseChoice = "continue" | "reset";

/** Escape menu: carry on, or start the run over from the summit. */
export class PauseMenu {
  open = false;
  onChoose: (choice: PauseChoice) => void = () => {};
  private el = document.getElementById("pause")!;
  private buttons = [...this.el.querySelectorAll<HTMLButtonElement>("button")];
  private selected = 0;

  constructor() {
    this.buttons.forEach((b, i) => {
      b.addEventListener("pointerenter", () => this.select(i));
      b.addEventListener("click", () => this.choose(i));
    });
  }

  show(open: boolean) {
    this.open = open;
    this.el.classList.toggle("hidden", !open);
    // inert keeps a clicked button from holding focus (and eating Enter/Space) once hidden
    this.el.inert = !open;
    if (open) this.select(0);
  }

  /** Keyboard / gamepad navigation, once per frame while open. */
  update(st: InputState) {
    if (st.menuUp) this.select(this.selected - 1);
    if (st.menuDown) this.select(this.selected + 1);
    if (st.confirmPressed) this.choose(this.selected);
  }

  private select(i: number) {
    this.selected = (i + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, k) => b.classList.toggle("selected", k === this.selected));
  }

  private choose(i: number) {
    this.onChoose(this.buttons[i].dataset.choice as PauseChoice);
  }
}
