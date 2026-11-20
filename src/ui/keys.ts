import { FX, TOOLS, type App } from "../app/app";
import { MALLETS } from "../app/body";
import { BRUSH_TOOLS } from "../app/paint";
import { SCENE_COUNT, stepAt, patternOf, TRACK_COUNT } from "../model";
import { FX_CODES, PLAY_CODES, TOOL_CODES, WEATHER_CODES } from "./keymap";
import type { Panels } from "./panels";

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

/** `atCursor` opens the menu for the ring (and the step) the keyboard is on. */
export function bindKeys(app: App, panels: Panels, atCursor: () => void): void {
  const held = new Set<string>();
  // The menu key also asks the browser for its own menu, a moment later: that one stays away.
  let asked = -Infinity;
  document.addEventListener("contextmenu", (event) => {
    if (performance.now() - asked < 500) event.preventDefault();
  });

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

    // The menu key (or Shift+F10) on the wheel: the same menu the right button opens, at the keyboard's cursor.
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      const focused = document.activeElement;
      if (focused === null || focused === document.body || focused.id === "kreisel") {
        event.preventDefault();
        asked = performance.now();
        if (!event.repeat) atCursor();
      }
      return;
    }

    if (code === "Space") {
      // A button focused by keyboard keeps its space bar; otherwise space is start and stop.
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && focused.matches(":focus-visible")) return;
      event.preventDefault();
      if (!event.repeat) app.togglePlay();
      return;
    }
    if (event.key === "Escape") {
      // Escape puts away what is open, one thing at a time from the top: the tour, a window, and last the stage.
      if (panels.endTour()) return;
      const open = app.paint.isOpen || app.body.isOpen || app.voice.isOpen || app.chords.openSlot !== null;
      if (!open && app.stage) app.toggleStage(false);
      panels.closeMenu();
      app.chords.close();
      app.hideCursor();
      app.paint.close();
      app.body.close();
      app.voice.close();
      // Away from the weather, back to the ring that was in focus.
      if (app.weather.focused) app.select(app.selected);
      app.relay.look(null);
      return;
    }
    // While the paint box is open, the top row holds the brushes and Enter puts the sheet away.
    if (app.paint.isOpen && !event.repeat) {
      const brush = TOOL_CODES.indexOf(code as (typeof TOOL_CODES)[number]);
      if (brush >= 0 && brush < BRUSH_TOOLS.length) {
        app.paint.setBrush(brush);
        return;
      }
      if (code === "KeyT") {
        app.paint.setBrushSize((app.paint.brushSize + 1) % 3);
        return;
      }
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        app.paint.close();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (event.shiftKey) app.paint.clear();
        else app.paint.eraseLast();
        return;
      }
      if (code === "KeyN") {
        app.paint.dice();
        return;
      }
    }
    // While the workbench is open, the top row holds what sets the body going, and Enter puts the bench away.
    if (app.body.isOpen && !event.repeat) {
      const mallet = TOOL_CODES.indexOf(code as (typeof TOOL_CODES)[number]);
      if (mallet >= 0 && mallet < MALLETS.length) {
        app.body.shape({ exciter: mallet });
        app.body.hear();
        return;
      }
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        app.body.close();
        return;
      }
      if (code === "KeyN") {
        app.body.dice();
        return;
      }
    }
    if (event.key === "?") {
      event.preventDefault();
      panels.showHelp();
      return;
    }
    // The stage: only the wheel, in the dark. (O, like the wheel.)
    if (code === "KeyO" && !event.repeat && !event.shiftKey) {
      app.toggleStage();
      return;
    }

    const range = event.target instanceof HTMLInputElement && event.target.type === "range";
    // Under the weather the top row holds its six kinds; the keys that write into a ring rest.
    if (app.weather.focused && !range) {
      const kind = WEATHER_CODES.indexOf(code as (typeof WEATHER_CODES)[number]);
      if (kind >= 0) {
        if (!event.repeat) app.weather.setCloud(kind);
        return;
      }
      if (code === "KeyN") {
        if (!event.repeat) app.weather.dice();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (event.shiftKey) app.weather.clear();
        else app.weather.clear(app.weather.cloud);
        return;
      }
      if (code.startsWith("Arrow") || event.key === "Enter" || event.key === "+" || event.key === "-") {
        if (code === "ArrowDown") {
          event.preventDefault();
          app.piece.focus();
        }
        return;
      }
    }
    // On the piece's ring the keys mean bars and tension.
    if (app.piece.focused && !range) {
      if (code === "ArrowLeft" || code === "ArrowRight") {
        event.preventDefault();
        const by = code === "ArrowLeft" ? -1 : 1;
        if (event.shiftKey) app.piece.rotate(by);
        else app.piece.moveKey(by);
        return;
      }
      if (code === "ArrowDown") {
        event.preventDefault();
        app.select(TRACK_COUNT - 1);
        return;
      }
      if (code === "ArrowUp") {
        event.preventDefault();
        return;
      }
      if (event.key === "+" || event.key === "-") {
        event.preventDefault();
        app.piece.nudgeTension(event.key === "+" ? 2 : -2);
        return;
      }
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (app.piece.key !== null) app.piece.seek(app.piece.key);
        return;
      }
      if (!event.repeat && code === "KeyN") {
        app.piece.dice();
        return;
      }
      if (!event.repeat && code === "KeyM") {
        app.piece.toggle();
        return;
      }
    }
    if (code.startsWith("Arrow") && !range) {
      event.preventDefault();
      app.wake();
      if (code === "ArrowLeft" || code === "ArrowRight") {
        const by = code === "ArrowLeft" ? -1 : 1;
        if (event.shiftKey) app.rings.rotate(app.selected, by);
        else app.moveCursor(by);
      } else {
        const by = code === "ArrowUp" ? 1 : -1;
        if (event.shiftKey) app.rings.nudgePitch(by, true);
        else if (by > 0 && app.selected === TRACK_COUNT - 1) app.piece.focus();
        else app.select(app.selected + by);
      }
      return;
    }
    if (event.key === "+" || event.key === "-") {
      event.preventDefault();
      app.rings.nudgePitch(event.key === "+" ? 1 : -1, false);
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      app.wake();
      app.rings.strikeCursor();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const cursor = app.keyCursor;
      if (event.shiftKey) app.rings.clear(app.selected);
      else if (cursor !== null && stepAt(patternOf(app.project, app.selected), cursor).on) app.rings.removeNote(app.selected, cursor, "taste");
      app.store.settle();
      return;
    }
    if (event.repeat) return;

    const digit = /^Digit([1-9])$/.exec(code)?.[1];
    if (digit) {
      const track = Number(digit) - 1;
      if (track === TRACK_COUNT) app.piece.focus();
      if (track === TRACK_COUNT + 1) app.weather.focus();
      if (track >= TRACK_COUNT) return;
      if (event.shiftKey) app.rings.toggleMute(track);
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
      app.rings.playKey(degree);
      return;
    }
    const fx = FX_CODES.indexOf(code as (typeof FX_CODES)[number]);
    if (fx >= 0) {
      const wanted = FX[fx];
      if (!wanted) return;
      // With Shift an effect latches; a latched one lets go at the next press of its key.
      if (event.shiftKey || app.latched.has(wanted.id)) {
        app.latchFx(wanted.id);
      } else {
        held.add(code);
        app.setFx(wanted.id, true);
      }
      return;
    }
    if (code === "KeyN") {
      if (event.shiftKey) app.rings.vary(app.selected);
      else app.rings.dice(app.selected);
    } else if (code === "KeyM") {
      if (event.shiftKey) app.rings.toggleSolo(app.selected);
      else app.rings.toggleMute(app.selected);
    } else if (code === "KeyL") {
      app.rings.toggleLive();
    } else if (code === "Comma" || code === "Period") {
      const direction = code === "Comma" ? -1 : 1;
      for (let offset = 1; offset < SCENE_COUNT; offset += 1) {
        const index = (app.project.scene + direction * offset + SCENE_COUNT * 2) % SCENE_COUNT;
        if (app.project.scenes[index]) {
          app.scenes.pick(index);
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
