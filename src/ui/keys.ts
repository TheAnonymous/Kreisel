import { FX, TOOLS, type App } from "../app";
import { SCENE_COUNT, stepAt, patternOf, TRACK_COUNT } from "../model";
import { FX_CODES, PLAY_CODES, TOOL_CODES, type Panels } from "./panels";

/*
 * The keyboard, by where the keys are rather than what is printed on them:
 * tools on the top row, playing on the home row, held effects on the bottom
 * row. So it feels the same on QWERTZ and QWERTY.
 */

/** Typing into a field or a menu must not play notes. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("dialog[open]")) return true;
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox";
}

export function bindKeys(app: App, panels: Panels): void {
  const held = new Set<string>();

  window.addEventListener("keydown", (event) => {
    if (typing(event.target)) return;
    const { code } = event;
    const command = event.ctrlKey || event.metaKey;

    if (command) {
      // By what is printed on the key here: Z and Y swap places between QWERTZ and QWERTY.
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) app.redo();
        else app.undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        app.redo();
      }
      return;
    }
    if (event.altKey) return;

    if (code === "Space") {
      // A button focused by keyboard keeps its space bar; otherwise space is start and stop.
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && focused.matches(":focus-visible")) return;
      event.preventDefault();
      if (!event.repeat) app.togglePlay();
      return;
    }
    if (event.key === "Escape") {
      panels.closeMenu();
      app.closeChord();
      app.hideCursor();
      return;
    }
    if (event.key === "?") {
      event.preventDefault();
      panels.showHelp();
      return;
    }

    const range = event.target instanceof HTMLInputElement && event.target.type === "range";
    if (code.startsWith("Arrow") && !range) {
      event.preventDefault();
      app.wake();
      if (code === "ArrowLeft" || code === "ArrowRight") {
        const by = code === "ArrowLeft" ? -1 : 1;
        if (event.shiftKey) app.rotate(app.selected, by);
        else app.moveCursor(by);
      } else {
        const by = code === "ArrowUp" ? 1 : -1;
        if (event.shiftKey) app.nudgePitch(by, true);
        else app.select(app.selected + by);
      }
      return;
    }
    if (event.key === "+" || event.key === "-") {
      event.preventDefault();
      app.nudgePitch(event.key === "+" ? 1 : -1, false);
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      app.wake();
      app.strikeCursor();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const cursor = app.keyCursor;
      if (event.shiftKey) app.clearRing(app.selected);
      else if (cursor !== null && stepAt(patternOf(app.project, app.selected), cursor).on) app.removeNote(app.selected, cursor, "taste");
      app.store.settle();
      return;
    }
    if (event.repeat) return;

    const digit = /^Digit([1-9])$/.exec(code)?.[1];
    if (digit) {
      const track = Number(digit) - 1;
      if (track >= TRACK_COUNT) return;
      if (event.shiftKey) app.toggleMute(track);
      else app.select(track);
      return;
    }
    const tool = TOOL_CODES.indexOf(code as (typeof TOOL_CODES)[number]);
    if (tool >= 0) {
      const wanted = TOOLS[tool];
      if (wanted) app.setTool(wanted.id);
      return;
    }
    const degree = PLAY_CODES.indexOf(code as (typeof PLAY_CODES)[number]);
    if (degree >= 0) {
      app.playKey(degree);
      return;
    }
    const fx = FX_CODES.indexOf(code as (typeof FX_CODES)[number]);
    if (fx >= 0) {
      const wanted = FX[fx];
      if (wanted) {
        held.add(code);
        app.setFx(wanted.id, true);
      }
      return;
    }
    if (code === "KeyN") {
      if (event.shiftKey) app.varyRing(app.selected);
      else app.diceRing(app.selected);
    } else if (code === "KeyM") {
      if (event.shiftKey) app.toggleSolo(app.selected);
      else app.toggleMute(app.selected);
    } else if (code === "KeyL") {
      app.toggleLive();
    } else if (code === "Comma" || code === "Period") {
      const direction = code === "Comma" ? -1 : 1;
      for (let offset = 1; offset < SCENE_COUNT; offset += 1) {
        const index = (app.project.scene + direction * offset + SCENE_COUNT * 2) % SCENE_COUNT;
        if (app.project.scenes[index]) {
          app.pickScene(index);
          break;
        }
      }
    }
  });

  const release = (code: string): void => {
    if (!held.delete(code)) return;
    const wanted = FX[FX_CODES.indexOf(code as (typeof FX_CODES)[number])];
    if (wanted) app.setFx(wanted.id, false);
  };
  window.addEventListener("keyup", (event) => release(event.code));
  // A key still down when the window loses focus never sends its keyup.
  window.addEventListener("blur", () => {
    for (const code of [...held]) release(code);
  });
}
