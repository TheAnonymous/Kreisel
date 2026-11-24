import { FX, TOOLS, type App } from "../app/app";
import { MALLETS } from "../app/body";
import { BRUSH_TOOLS } from "../app/paint";
import { patternOf, stepAt, TRACK_COUNT } from "../model";
import { FX_CODES, place, PLAY_CODES, TOOL_CODES, WEATHER_CODES } from "./keymap";
import type { Panels } from "./panels";

/*
 * The keyboard, by where the keys are rather than what is printed on them:
 * tools on the top row, playing on the home row, held effects on the bottom
 * row. So it feels the same on QWERTZ and QWERTY.
 *
 * A press is offered to one listener after the other (see `take`): first
 * the keys that mean the same everywhere, then the window that is open over
 * the wheel, then what is in focus. The first that knows the key takes it,
 * and those after it never see it.
 */

/** Typing into a field or a menu must not play notes. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("dialog[open]")) return true;
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox";
}

/** One press of a key, as the listeners look at it. */
interface Press {
  event: KeyboardEvent;
  /** Where the key is on the keyboard. */
  code: string;
  /** What is printed on it. */
  key: string;
  shift: boolean;
  /** The key is held down and sends itself again. */
  repeat: boolean;
  /** It went to a slider, which keeps its own arrows. */
  onSlider: boolean;
  /** Enter, unless a button has it for itself. */
  enter: boolean;
  /** Delete or the backspace key. */
  erase: boolean;
  /** 1 for the plus key, −1 for minus, 0 for any other. */
  sign: number;
}

function pressOf(event: KeyboardEvent): Press {
  const { code, key, target } = event;
  return {
    event,
    code,
    key,
    shift: event.shiftKey,
    repeat: event.repeat,
    onSlider: target instanceof HTMLInputElement && target.type === "range",
    enter: key === "Enter" && !(target instanceof HTMLButtonElement),
    erase: key === "Delete" || key === "Backspace",
    sign: key === "+" ? 1 : key === "-" ? -1 : 0,
  };
}

class Keyboard {
  /** The effect keys that are held down. */
  private readonly held = new Set<string>();
  /** When the menu key last asked for the wheel's menu. */
  private asked = -Infinity;

  /** @param atCursor opens the menu for the ring (and the step) the keyboard is on */
  constructor(private readonly app: App, private readonly panels: Panels, private readonly atCursor: () => void) {}

  listen(): void {
    window.addEventListener("keydown", (event) => {
      if (!typing(event.target)) this.take(pressOf(event));
    });
    window.addEventListener("keyup", (event) => this.release(event.code));
    // A key still down when the window loses focus never sends its keyup.
    window.addEventListener("blur", () => {
      for (const code of [...this.held]) this.release(code);
    });
    // The menu key also asks the browser for its own menu, a moment later: that one stays away.
    document.addEventListener("contextmenu", (event) => {
      if (performance.now() - this.asked < 500) event.preventDefault();
    });
  }

  /** Offers a press to one listener after the other, until one of them takes it. */
  private take(press: Press): boolean {
    return this.browsersOwn(press)
      || this.menuKey(press)
      || this.startStop(press)
      || this.putAway(press)
      || this.inPaintBox(press)
      || this.atWorkbench(press)
      || this.help(press)
      || this.stage(press)
      || this.underWeather(press)
      || this.onPiece(press)
      || this.arrows(press)
      || this.cursorKeys(press)
      || this.once(press);
  }

  /** What happens once a press, however long the key is held. */
  private once(press: Press): boolean {
    if (press.repeat) return true;
    return this.digit(press) || this.tool(press) || this.note(press) || this.effect(press) || this.letter(press);
  }

  // ---- the same everywhere ----

  /** Ctrl with Z or Y goes back and forth; anything else with Ctrl, the command key or Alt is the browser's. */
  private browsersOwn({ event, key, shift }: Press): boolean {
    if (!event.ctrlKey && !event.metaKey) return event.altKey;
    // By what is printed on the key here: Z and Y swap places between QWERTZ and QWERTY.
    const letter = key.toLowerCase();
    if (letter !== "z" && letter !== "y") return true;
    event.preventDefault();
    if (letter === "z" && !shift) this.app.undo();
    else this.app.redo();
    return true;
  }

  /** The menu key (or Shift+F10) on the wheel: the same menu the right button opens, at the keyboard's cursor. */
  private menuKey({ event, key, shift, repeat }: Press): boolean {
    if (key !== "ContextMenu" && !(key === "F10" && shift)) return false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body || focused.id === "kreisel") {
      event.preventDefault();
      this.asked = performance.now();
      if (!repeat) this.atCursor();
    }
    return true;
  }

  /** Space is start and stop, except on a button focused by keyboard: that one keeps its space bar. */
  private startStop({ event, code, repeat }: Press): boolean {
    if (code !== "Space") return false;
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && focused.matches(":focus-visible")) return true;
    event.preventDefault();
    if (!repeat) this.app.togglePlay();
    return true;
  }

  /** Escape puts away what is open, one thing at a time from the top: the tour, a window, and last the stage. */
  private putAway({ key }: Press): boolean {
    if (key !== "Escape") return false;
    const { app, panels } = this;
    if (panels.endTour()) return true;
    const open = app.paint.isOpen || app.body.isOpen || app.voice.isOpen || app.chords.openSlot !== null || app.rings.paletteOpen;
    if (!open && app.stage) app.toggleStage(false);
    app.chords.close();
    app.rings.closePalette();
    app.hideCursor();
    app.paint.close();
    app.body.close();
    app.voice.close();
    // Away from the weather, back to the ring that was in focus.
    if (app.weather.focused) app.select(app.selected);
    app.relay.look(null);
    return true;
  }

  private help({ event, key }: Press): boolean {
    if (key !== "?") return false;
    event.preventDefault();
    this.panels.showHelp();
    return true;
  }

  /** The stage: only the wheel, in the dark. (O, like the wheel.) */
  private stage({ code, shift, repeat }: Press): boolean {
    if (code !== "KeyO" || repeat || shift) return false;
    this.app.toggleStage();
    return true;
  }

  // ---- a window over the wheel ----

  /** While the paint box is open, the top row holds the brushes and Enter puts the sheet away. */
  private inPaintBox({ event, code, shift, repeat, enter, erase }: Press): boolean {
    const { paint } = this.app;
    if (!paint.isOpen || repeat) return false;
    const brush = place(TOOL_CODES, code);
    if (brush >= 0 && brush < BRUSH_TOOLS.length) {
      paint.setBrush(brush);
    } else if (code === "KeyT") {
      paint.setBrushSize((paint.brushSize + 1) % 3);
    } else if (enter) {
      event.preventDefault();
      paint.close();
    } else if (erase) {
      event.preventDefault();
      if (shift) paint.clear();
      else paint.eraseLast();
    } else if (code === "KeyN") {
      paint.dice();
    } else {
      return false;
    }
    return true;
  }

  /** While the workbench is open, the top row holds what sets the body going, and Enter puts the bench away. */
  private atWorkbench({ event, code, repeat, enter }: Press): boolean {
    const { body } = this.app;
    if (!body.isOpen || repeat) return false;
    const mallet = place(TOOL_CODES, code);
    if (mallet >= 0 && mallet < MALLETS.length) {
      body.shape({ exciter: mallet });
      body.hear();
    } else if (enter) {
      event.preventDefault();
      body.close();
    } else if (code === "KeyN") {
      body.dice();
    } else {
      return false;
    }
    return true;
  }

  // ---- what is in focus ----

  /** Under the weather the top row holds its six kinds; the keys that write into a ring rest. */
  private underWeather({ event, code, key, shift, repeat, onSlider, erase, sign }: Press): boolean {
    const { weather } = this.app;
    if (!weather.focused || onSlider) return false;
    const kind = place(WEATHER_CODES, code);
    if (kind >= 0) {
      if (!repeat) weather.setCloud(kind);
      return true;
    }
    if (code === "KeyN") {
      if (!repeat) weather.dice();
      return true;
    }
    if (erase) {
      event.preventDefault();
      if (shift) weather.clear();
      else weather.clear(weather.cloud);
      return true;
    }
    if (code.startsWith("Arrow") || key === "Enter" || sign !== 0) {
      // Only the way down leads on, to the piece.
      if (code === "ArrowDown") {
        event.preventDefault();
        this.app.piece.focus();
      }
      return true;
    }
    return false;
  }

  /** On the piece's ring the keys mean bars and tension. */
  private onPiece({ event, code, shift, repeat, onSlider, enter, sign }: Press): boolean {
    const { piece } = this.app;
    if (!piece.focused || onSlider) return false;
    // The piece's two tools are where the ring tools' first two keys are.
    if (code === "KeyQ" || code === "KeyW") {
      if (!repeat) piece.setTool(code === "KeyQ" ? "spannung" : "einsaetze");
      return true;
    }
    // "Einspielen": the third key switches it, and while it is on the arrows up and down (and plus and minus) are the hand on the tension.
    if (code === "KeyE") {
      if (!repeat) piece.toggleRide();
      return true;
    }
    if (piece.riding && (code === "ArrowUp" || code === "ArrowDown" || sign !== 0)) {
      event.preventDefault();
      piece.rideBy(code === "ArrowUp" ? 1 : code === "ArrowDown" ? -1 : sign);
      return true;
    }
    if (piece.laying && this.onRoster(event, code, repeat, enter, sign)) return true;
    if (code === "ArrowLeft" || code === "ArrowRight") {
      event.preventDefault();
      const by = code === "ArrowLeft" ? -1 : 1;
      if (shift) piece.rotate(by);
      else piece.moveKey(by);
      return true;
    }
    if (code === "ArrowDown") {
      event.preventDefault();
      this.app.select(TRACK_COUNT - 1);
      return true;
    }
    if (code === "ArrowUp") {
      event.preventDefault();
      return true;
    }
    if (sign !== 0) {
      event.preventDefault();
      piece.nudgeTension(sign * 2);
      return true;
    }
    if (enter) {
      event.preventDefault();
      if (piece.key !== null) piece.seek(piece.key);
      return true;
    }
    if (repeat) return false;
    if (code === "KeyN") {
      piece.dice();
      return true;
    }
    if (code === "KeyM") {
      piece.toggle();
      return true;
    }
    if (code === "KeyK") {
      // "Ohne Kick" for the phrase at the pointer, and back.
      if (piece.key !== null) piece.kickForPhrase(piece.key);
      return true;
    }
    return false;
  }

  /** While the rings show the roster: the arrows go from phrase to phrase and from ring to ring, and Enter turns the phrase around. */
  private onRoster(event: KeyboardEvent, code: string, repeat: boolean, enter: boolean, sign: number): boolean {
    const { piece } = this.app;
    if (code === "ArrowLeft" || code === "ArrowRight") {
      if (event.shiftKey) return false;
      event.preventDefault();
      piece.movePhrase(code === "ArrowLeft" ? -1 : 1);
      return true;
    }
    if (code === "ArrowUp" || code === "ArrowDown") {
      // Outwards is up: the melody's lane is the outermost.
      event.preventDefault();
      piece.moveLane(code === "ArrowUp" ? 1 : -1);
      return true;
    }
    if (enter) {
      event.preventDefault();
      if (!repeat && piece.key !== null) piece.flipRoster(piece.lane, piece.key);
      return true;
    }
    // Plus and minus are the tension's, which is not what is being laid here.
    return sign !== 0;
  }

  /** Arrows on a ring: sideways along it, up and down from ring to ring; with Shift they turn the ring and move the note by an octave. */
  private arrows({ event, code, shift, onSlider }: Press): boolean {
    if (!code.startsWith("Arrow") || onSlider) return false;
    const { app } = this;
    event.preventDefault();
    app.wake();
    if (code === "ArrowLeft" || code === "ArrowRight") {
      const by = code === "ArrowLeft" ? -1 : 1;
      if (shift) app.rings.rotate(app.selected, by);
      else app.moveCursor(by);
    } else {
      const by = code === "ArrowUp" ? 1 : -1;
      if (shift) app.rings.nudgePitch(by, true);
      else if (by > 0 && app.selected === TRACK_COUNT - 1) app.piece.focus();
      else app.select(app.selected + by);
    }
    return true;
  }

  /** At the keyboard's cursor: plus and minus move the note, Enter sets or takes a hit, Delete takes it. */
  private cursorKeys({ event, shift, enter, erase, sign }: Press): boolean {
    const { app } = this;
    if (sign !== 0) {
      event.preventDefault();
      app.rings.nudgePitch(sign, false);
      return true;
    }
    if (enter) {
      event.preventDefault();
      app.wake();
      app.rings.strikeCursor();
      return true;
    }
    if (erase) {
      event.preventDefault();
      const cursor = app.keyCursor;
      if (shift) app.rings.clear(app.selected);
      else if (cursor !== null && stepAt(patternOf(app.project, app.selected), cursor).on) app.rings.removeNote(app.selected, cursor, "taste");
      app.store.settle();
      return true;
    }
    return false;
  }

  // ---- once a press ----

  /** The digits pick a ring, with Shift they mute it; the two after the rings pick the piece and the weather. */
  private digit({ code, shift }: Press): boolean {
    const digit = /^Digit([1-9])$/.exec(code)?.[1];
    if (!digit) return false;
    const { app } = this;
    const track = Number(digit) - 1;
    if (track === TRACK_COUNT) app.piece.focus();
    else if (track === TRACK_COUNT + 1) app.weather.focus();
    else if (track > TRACK_COUNT) return true;
    else if (shift) app.rings.toggleMute(track);
    else app.select(track);
    return true;
  }

  /** The top row picks a tool. */
  private tool({ code }: Press): boolean {
    const tool = place(TOOL_CODES, code);
    if (tool < 0) return false;
    const wanted = TOOLS[tool];
    if (wanted) this.app.setTool(wanted.id);
    return true;
  }

  /** The home row plays the ring in focus. */
  private note({ code }: Press): boolean {
    const degree = place(PLAY_CODES, code);
    if (degree < 0) return false;
    this.app.rings.playKey(degree);
    return true;
  }

  /** The bottom row holds an effect for as long as its key is down. */
  private effect({ code, shift }: Press): boolean {
    const fx = place(FX_CODES, code);
    if (fx < 0) return false;
    const wanted = FX[fx];
    if (!wanted) return true;
    // With Shift an effect latches; a latched one lets go at the next press of its key.
    if (shift || this.app.latched.has(wanted.id)) {
      this.app.latchFx(wanted.id);
    } else {
      this.held.add(code);
      this.app.setFx(wanted.id, true);
    }
    return true;
  }

  private release(code: string): void {
    if (!this.held.delete(code)) return;
    const wanted = FX[place(FX_CODES, code)];
    if (wanted) this.app.setFx(wanted.id, false);
  }

  /** Dice, mute, playing in, the sound before or after on the palette, and the scene before or after. */
  private letter({ code, shift }: Press): boolean {
    const { app } = this;
    if (code === "KeyU" || code === "KeyI") {
      app.rings.stepSound(app.selected, code === "KeyU" ? -1 : 1);
    } else if (code === "KeyP") {
      app.rings.togglePalette();
    } else if (code === "KeyN") {
      if (shift) app.rings.vary(app.selected);
      else app.rings.dice(app.selected);
    } else if (code === "KeyM") {
      if (shift) app.rings.toggleSolo(app.selected);
      else app.rings.toggleMute(app.selected);
    } else if (code === "KeyL") {
      app.rings.toggleLive();
    } else if (code === "Comma" || code === "Period") {
      app.scenes.pickNext(code === "Comma" ? -1 : 1);
    } else {
      return false;
    }
    return true;
  }
}

/** `atCursor` opens the menu for the ring (and the step) the keyboard is on. */
export function bindKeys(app: App, panels: Panels, atCursor: () => void): void {
  new Keyboard(app, panels, atCursor).listen();
}
