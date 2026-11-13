import { BRUSH_TOOLS, FX, TOOLS, type App } from "../app";
import type { FxName } from "../audio/engine";
import { describeBild } from "../bild";
import { packBild, unpackBild } from "../codec";
import { clamp, currentScene, MAX_CHORDS, MAX_STEPS, MIN_STEPS, OWN_SOUND, patternOf, SCENE_COUNT, SCENE_NAMES, TIME_MAX, TRACK_COUNT, trackInfo, trackOf, type ScaleId } from "../model";
import { chordName, chordRoman, NOTE_NAMES, SCALE_IDS, SCALES } from "../music";
import { activeSteps, describe } from "../patterns";
import { renderThumb, type EaselView } from "./easel";
import type { RingView, Tool } from "./ring";

/*
 * Everything around the Kreisel: transport and key in the bar, the list of
 * rings and scenes on the left, tools and held effects beside the wheel, the
 * ring in focus on the right. Built once; `sync` then only moves values.
 */

const ICONS = {
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" class="fill"/><circle cx="15.5" cy="15.5" r="1.3" class="fill"/><circle cx="15.5" cy="8.5" r="1.3" class="fill"/><circle cx="8.5" cy="15.5" r="1.3" class="fill"/><circle cx="12" cy="12" r="1.3" class="fill"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path class="on" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/><path class="off" d="m15.5 9.5 5 5m0-5-5 5"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.3-5.2M17 3v4.2h-4.2" transform="matrix(-1 0 0 1 24 0)"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.3-5.2M17 3v4.2h-4.2"/></svg>',
} as const;

const TOOL_ICONS: Record<Tool, string> = {
  setzen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19z"/><path d="m14 6.5 3.5 3.5"/></svg>',
  betonen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18V12M12 18V5M19 18V9"/></svg>',
  zufall: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="3.2 3.2"/><circle cx="12" cy="12" r="2.2" class="fill"/></svg>',
  wirbel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6v12M10 6v12M15 6v12M20 6v12"/></svg>',
  laenge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M4 8v8M20 8v8"/></svg>',
};

const BRUSH_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c3-7 6-7 9 0s6 7 9 0"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16 8 7v9l5-9v9l5-9v9"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="fill"><circle cx="5" cy="13" r="1.3"/><circle cx="9" cy="8" r="1.3"/><circle cx="10" cy="15" r="1.3"/><circle cx="14" cy="11" r="1.3"/><circle cx="15" cy="17" r="1.3"/><circle cx="18" cy="7" r="1.3"/><circle cx="19" cy="13" r="1.3"/></g></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 19-4-4 9-9 6 6-7 7zM13 19h7M9 10l6 6"/></svg>',
] as const;

/** The physical keys: tools on the top row, playing on the home row, effects on the bottom row. */
export const TOOL_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT"] as const;
export const PLAY_CODES = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"] as const;
export const FX_CODES = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB"] as const;

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className: string, label: string, title = ""): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  if (title) node.title = title;
  return node;
}

function iconButton(className: string, icon: string, label: string, title = label): HTMLButtonElement {
  const node = button(className, "", title);
  node.innerHTML = icon;
  node.setAttribute("aria-label", label);
  return node;
}

/** Keeps a drag with the element it began on, where the browser knows the pointer. */
function capture(node: HTMLElement, event: PointerEvent): void {
  try {
    node.setPointerCapture(event.pointerId);
  } catch {
    // A pointer the browser no longer tracks: the gesture still works while it stays over the element.
  }
}

/** A labelled slider that edits with `change` and shows `read`. */
interface Slider {
  input: HTMLInputElement;
  read(): number;
}

export class Panels {
  /** What stands on each key on this keyboard (QWERTZ until the browser says otherwise). */
  private labels = new Map<string, string>([["KeyZ", "Y"], ["KeyY", "Z"]]);
  private readonly sliders: Slider[] = [];
  private readonly trackRows: HTMLLIElement[] = [];
  private readonly sceneButtons: HTMLButtonElement[] = [];
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly fxButtons = new Map<FxName, HTMLButtonElement>();
  private readonly soundButtons: HTMLButtonElement[] = [];
  private readonly brushButtons: HTMLButtonElement[] = [];
  private readonly own = { pick: button("own-pick", ""), thumb: el("canvas", "thumb"), label: el("span", "own-label") };
  private readonly sizeDots = el("span", "dots");
  private thumbSignature = "";
  private shelfSignature = "noch nicht gebaut";
  private easelOpen = false;
  private closeCoach: () => void = () => undefined;
  private readonly panel = { name: el("h2"), info: el("p", "info"), pad: el("div", "pad"), puck: el("span", "puck"), axisX: el("span", "axis x"), axisY: el("span", "axis y"), steps: el("output"), spread: el("input"), spreadValue: el("output") };
  private chordSignature = "";
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private lastPreview = 0;

  constructor(private readonly app: App, private readonly ring: RingView, private readonly easel: EaselView) {
    this.buildBar();
    this.buildTracks();
    this.buildScenes();
    this.buildTools();
    this.buildEasel();
    this.buildFx();
    this.buildPanel();
    this.buildCoach();
    this.buildHelp();
    document.addEventListener("pointerdown", (event) => this.outside(event), true);
    // A button clicked with the mouse should not keep the keyboard: the space bar belongs to start and stop.
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (target && event.detail > 0 && !target.closest("dialog")) target.blur();
    });
    void this.readKeyboard();
    app.subscribe(() => this.sync());
    this.sync();
  }

  keyLabel(code: string): string {
    return this.labels.get(code) ?? code.replace(/^Key|^Digit/, "");
  }

  private async readKeyboard(): Promise<void> {
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    try {
      const map = await keyboard?.getLayoutMap();
      if (map) {
        for (const code of [...TOOL_CODES, ...PLAY_CODES, ...FX_CODES, "KeyN", "KeyM", "KeyL", "KeyY"]) {
          const label = map.get(code);
          if (label) this.labels.set(code, label.toUpperCase());
        }
      } else if (!navigator.language.toLowerCase().startsWith("de")) {
        this.labels.clear();
      }
    } catch {
      // Keep the QWERTZ guess.
    }
    this.labelKeys();
  }

  private labelKeys(): void {
    TOOLS.forEach((tool, index) => {
      const key = this.toolButtons.get(tool.id)?.querySelector(".key");
      if (key) key.textContent = this.keyLabel(TOOL_CODES[index] ?? "");
    });
    FX.forEach((fx, index) => {
      const key = this.fxButtons.get(fx.id)?.querySelector(".key");
      if (key) key.textContent = this.keyLabel(FX_CODES[index] ?? "");
    });
    this.brushButtons.forEach((node, index) => {
      const key = node.querySelector(".key");
      if (key) key.textContent = this.keyLabel(TOOL_CODES[index] ?? "");
    });
    this.buildHelp();
  }

  // ---- building ---------------------------------------------------------------

  private slider(input: HTMLInputElement, read: () => number, write: (value: number) => void): void {
    input.addEventListener("input", () => write(Number(input.value) / 100));
    input.addEventListener("change", () => this.app.store.settle());
    this.sliders.push({ input, read });
  }

  private buildBar(): void {
    const app = this.app;
    byId("play").addEventListener("click", () => app.togglePlay());
    const bpm = byId<HTMLInputElement>("bpm");
    bpm.addEventListener("change", () => {
      const value = Number.parseInt(bpm.value, 10);
      if (Number.isFinite(value)) app.setGlobal({ bpm: clamp(value, 60, 200) }, "bpm");
      bpm.value = String(app.project.bpm);
    });
    bpm.addEventListener("wheel", (event) => {
      event.preventDefault();
      app.setGlobal({ bpm: clamp(app.project.bpm - Math.sign(event.deltaY), 60, 200) }, "bpm");
    }, { passive: false });
    this.slider(byId("swing"), () => app.project.swing, (swing) => app.setGlobal({ swing }, "swing"));
    this.slider(byId("pump"), () => app.project.pump, (pump) => app.setGlobal({ pump }, "pump"));
    this.slider(byId("volume"), () => app.project.volume, (volume) => app.setGlobal({ volume }, "volume"));

    const root = byId<HTMLSelectElement>("root");
    NOTE_NAMES.forEach((name, index) => root.append(new Option(name, String(index))));
    root.addEventListener("change", () => app.setGlobal({ root: Number(root.value) }));
    const scale = byId<HTMLSelectElement>("scale");
    for (const id of SCALE_IDS) scale.append(new Option(SCALES[id].name, id));
    scale.addEventListener("change", () => app.setGlobal({ scale: scale.value as ScaleId }));

    byId("undo").addEventListener("click", () => app.undo());
    byId("redo").addEventListener("click", () => app.redo());
    byId("share").addEventListener("click", () => void app.share());
    byId("record").addEventListener("click", () => void app.toggleRecording());
    byId("dice-all").addEventListener("click", () => app.diceAll());

    const more = byId<HTMLButtonElement>("more");
    const menu = byId("menu");
    more.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      more.setAttribute("aria-expanded", String(!menu.hidden));
    });
    menu.addEventListener("click", (event) => {
      const action = event.target instanceof HTMLElement ? event.target.dataset.do : undefined;
      if (!action) return;
      this.closeMenu();
      if (action === "wav") void app.exportWav();
      else if (action === "clear-scene") app.clearScene(app.project.scene);
      else if (action === "empty") app.newProject(true);
      else if (action === "factory") app.newProject(false);
      else if (action === "help") this.showHelp();
    });

    const chain = byId<HTMLInputElement>("chain");
    chain.addEventListener("change", () => app.setGlobal({ chain: chain.checked }));
    const repeats = byId<HTMLSelectElement>("repeats");
    repeats.addEventListener("change", () => app.setGlobal({ repeats: Number(repeats.value) }));
  }

  closeMenu(): void {
    byId("menu").hidden = true;
    byId("more").setAttribute("aria-expanded", "false");
  }

  showHelp(): void {
    const dialog = byId<HTMLDialogElement>("help");
    if (!dialog.open) dialog.showModal();
  }

  private buildTracks(): void {
    const list = byId("tracks");
    for (let track = TRACK_COUNT - 1; track >= 0; track -= 1) {
      // The list runs like the rings: the outermost on top.
      const info = trackInfo(track);
      const row = el("li", "track");
      row.style.setProperty("--c", info.color);
      const pick = button("pick", "", `${info.name} wählen (Taste ${track + 1})`);
      pick.append(el("span", "dot"), el("span", "name", info.name), el("span", "sound"));
      pick.addEventListener("click", () => this.app.select(track));
      const mute = iconButton("mute", ICONS.mute, `${info.name} stumm`, "Stumm schalten (M) · mit Umschalt: nur diesen Ring hören");
      mute.addEventListener("click", (event) => {
        if (event.shiftKey) this.app.toggleSolo(track);
        else this.app.toggleMute(track);
      });
      const roll = iconButton("roll", ICONS.dice, `${info.name} würfeln`, "Neu würfeln (N)");
      roll.addEventListener("click", () => this.app.diceRing(track));
      row.append(pick, mute, roll);
      list.append(row);
      this.trackRows[track] = row;
    }
  }

  private buildScenes(): void {
    const holder = byId("scenes");
    for (let index = 0; index < SCENE_COUNT; index += 1) {
      const scene = button("scene", SCENE_NAMES[index] ?? "");
      scene.addEventListener("click", (event) => {
        if (event.shiftKey) this.app.clearScene(index);
        else this.app.pickScene(index);
      });
      holder.append(scene);
      this.sceneButtons.push(scene);
    }
  }

  private buildTools(): void {
    const holder = byId("tools");
    for (const tool of TOOLS) {
      const node = button("tool", "", tool.hint);
      node.innerHTML = TOOL_ICONS[tool.id];
      node.append(el("span", "name", tool.name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => this.app.setTool(tool.id));
      holder.append(node);
      this.toolButtons.set(tool.id, node);
    }
    const live = button("tool live", "", "Was du auf A bis K spielst, in den Ring schreiben, solange der Kreisel läuft");
    live.id = "live";
    live.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5" class="fill"/></svg>';
    live.append(el("span", "name", "Einspielen"), el("kbd", "key", "L"));
    live.addEventListener("click", () => this.app.toggleLive());
    holder.append(live);
  }

  /** The paint box: its buttons, and the brushes that take the tools' place while it is open. */
  private buildEasel(): void {
    const app = this.app;
    const brushes = byId("brushes");
    BRUSH_TOOLS.forEach((brush, index) => {
      const node = button("tool", "", brush.hint);
      node.innerHTML = BRUSH_ICONS[index] ?? "";
      node.append(el("span", "name", brush.name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => app.setBrush(index));
      brushes.append(node);
      this.brushButtons.push(node);
    });
    const size = button("tool size", "", "Wie viel Farbe der Pinsel hält: dünn und leise bis dick und laut (auch mit dem Mausrad)");
    size.id = "brush-size";
    size.append(this.sizeDots, el("span", "name", "Dicke"), el("kbd", "key", "T"));
    for (let dot = 0; dot < 3; dot += 1) this.sizeDots.append(el("i"));
    size.addEventListener("click", () => app.setBrushSize((app.brushSize + 1) % 3));
    brushes.append(size);

    byId("easel-done").addEventListener("click", () => app.closeEasel());
    byId("bild-dice").addEventListener("click", () => app.diceOwn());
    byId("bild-clear").addEventListener("click", () => app.clearOwn());
    byId("bild-keep").addEventListener("click", () => app.keepOwn());
    byId("bild-listen").addEventListener("click", () => void app.imitate());
    const ear = byId("listening");
    app.onLoudness = (level) => ear.style.setProperty("--loud", String(1 + Math.min(0.9, level * 8)));
    const hold = byId<HTMLInputElement>("hold");
    hold.addEventListener("change", () => app.setHold(hold.checked ? Math.round(TIME_MAX * 0.32) : null));
    // A click beside the sheet puts it away, like a click beside any open box.
    byId("easel").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) app.closeEasel();
    });
  }

  private buildFx(): void {
    const holder = byId("fx");
    for (const fx of FX) {
      const pad = button("pad-fx", "", `${fx.hint} (halten)`);
      pad.append(el("span", "name", fx.name), el("kbd", "key"));
      const release = (): void => this.app.setFx(fx.id, false);
      pad.addEventListener("pointerdown", (event) => {
        capture(pad, event);
        this.app.setFx(fx.id, true);
      });
      pad.addEventListener("pointerup", release);
      pad.addEventListener("pointercancel", release);
      pad.addEventListener("lostpointercapture", release);
      pad.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) this.app.setFx(fx.id, true);
      });
      pad.addEventListener("keyup", (event) => {
        if (event.key === "Enter" || event.key === " ") release();
      });
      pad.addEventListener("blur", release);
      holder.append(pad);
      this.fxButtons.set(fx.id, pad);
    }
  }

  private buildPanel(): void {
    const app = this.app;
    const holder = byId("panel");
    const parts = this.panel;

    const head = el("header", "panel-head");
    head.append(el("span", "dot"), parts.name);
    const doing = el("div", "doing");
    const roll = button("button small", "Würfeln", "Eine neue Idee für diesen Ring (N)");
    roll.addEventListener("click", () => app.diceRing(app.selected));
    const vary = button("button small", "Variieren", "Nur ein wenig verändern (Umschalt+N)");
    vary.addEventListener("click", () => app.varyRing(app.selected));
    const wipe = button("button small", "Leeren", "Alle Schläge dieses Rings entfernen (Umschalt+Entf)");
    wipe.addEventListener("click", () => app.clearRing(app.selected));
    doing.append(roll, vary, wipe);

    const sounds = el("div", "chips");
    sounds.setAttribute("role", "group");
    sounds.setAttribute("aria-label", "Klang");
    for (let sound = 0; sound < 4; sound += 1) {
      const chip = button("chip", "");
      chip.addEventListener("click", () => app.setSound(app.selected, sound));
      sounds.append(chip);
      this.soundButtons.push(chip);
    }

    const own = el("div", "own");
    this.own.pick.append(this.own.thumb, this.own.label);
    this.own.pick.addEventListener("click", () => app.useOwn());
    const paint = button("button small", "Malen", "Den eigenen Klang dieses Rings malen");
    paint.id = "paint";
    paint.addEventListener("click", () => app.openEasel());
    own.append(this.own.pick, paint);

    const pad = parts.pad;
    pad.tabIndex = 0;
    pad.setAttribute("role", "group");
    pad.append(parts.puck, parts.axisX, parts.axisY);
    const place = (event: PointerEvent): void => {
      const box = pad.getBoundingClientRect();
      app.setTrack(app.selected, { x: clamp((event.clientX - box.left) / box.width, 0, 1), y: clamp(1 - (event.clientY - box.top) / box.height, 0, 1) }, "pad");
      if (performance.now() - this.lastPreview > 170) {
        this.lastPreview = performance.now();
        app.preview(app.selected);
      }
    };
    pad.addEventListener("pointerdown", (event) => {
      capture(pad, event);
      app.wake();
      this.lastPreview = 0;
      place(event);
    });
    pad.addEventListener("pointermove", (event) => {
      if (pad.hasPointerCapture(event.pointerId)) place(event);
    });
    pad.addEventListener("pointerup", () => app.store.settle());
    pad.addEventListener("keydown", (event) => {
      const moves: Record<string, [number, number]> = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] };
      const delta = moves[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const track = trackOf(app.project, app.selected);
      app.setTrack(app.selected, { x: clamp(track.x + delta[0], 0, 1), y: clamp(track.y + delta[1], 0, 1) }, "pad");
      app.preview(app.selected);
    });

    const ringGroup = el("div", "group");
    const steps = el("div", "line");
    const less = button("button icon small", "−", "Einen Schritt kürzer");
    less.setAttribute("aria-label", "Einen Schritt kürzer");
    less.addEventListener("click", () => app.resizeRing(app.selected, patternOf(app.project, app.selected).len - 1));
    const more = button("button icon small", "+", "Einen Schritt länger");
    more.setAttribute("aria-label", "Einen Schritt länger");
    more.addEventListener("click", () => app.resizeRing(app.selected, patternOf(app.project, app.selected).len + 1));
    const quick = el("span", "quick");
    for (const length of [8, 12, 16, 32]) {
      const chip = button("chip tiny", String(length), `${length} Schritte`);
      chip.addEventListener("click", () => app.resizeRing(app.selected, length));
      quick.append(chip);
    }
    steps.append(el("span", "label", "Schritte"), less, parts.steps, more, quick);

    const turn = el("div", "line");
    const turnLeft = iconButton("button icon small", ICONS.left, "Einen Schritt zurückdrehen", "Zurückdrehen (Umschalt+←)");
    turnLeft.addEventListener("click", () => app.rotate(app.selected, -1));
    const turnRight = iconButton("button icon small", ICONS.right, "Einen Schritt weiterdrehen", "Weiterdrehen (Umschalt+→ oder Mausrad über dem Ring)");
    turnRight.addEventListener("click", () => app.rotate(app.selected, 1));
    turn.append(el("span", "label", "Drehen"), turnLeft, turnRight);

    const spread = el("label", "line");
    parts.spread.type = "range";
    parts.spread.min = "0";
    parts.spread.step = "1";
    parts.spread.title = "So viele Schläge gleichmäßig über den Ring verteilen";
    parts.spread.addEventListener("input", () => app.spreadRing(app.selected, Number(parts.spread.value)));
    parts.spread.addEventListener("change", () => app.store.settle());
    spread.append(el("span", "label", "Verteilen"), parts.spread, parts.spreadValue);
    ringGroup.append(steps, turn, spread);

    const mix = el("div", "group");
    const mixSlider = (label: string, field: "level" | "hall" | "echo"): void => {
      const line = el("label", "line");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      this.slider(input, () => trackOf(app.project, app.selected)[field], (value) => app.setTrack(app.selected, { [field]: value }, field));
      line.append(el("span", "label", label), input);
      mix.append(line);
    };
    mixSlider("Lautstärke", "level");
    mixSlider("Hall", "hall");
    mixSlider("Echo", "echo");

    holder.append(head, parts.info, doing, sounds, own, pad, ringGroup, mix);
  }

  private buildCoach(): void {
    const coach = byId("coach");
    let seen = false;
    try {
      seen = localStorage.getItem("kreisel.hinweis") === "1";
    } catch {
      // No storage: show it.
    }
    coach.hidden = seen;
    const close = (): void => {
      if (coach.hidden) return;
      coach.hidden = true;
      try {
        localStorage.setItem("kreisel.hinweis", "1");
      } catch {
        // It will show again next time.
      }
    };
    byId("coach-ok").addEventListener("click", close);
    byId("kreisel").addEventListener("pointerdown", close);
    this.closeCoach = close;
  }

  private buildHelp(): void {
    const key = (code: string): string => this.keyLabel(code);
    const rows: [string, string][] = [
      ["Leertaste", "Start und Stopp"],
      ["1 bis 7", "Ring wählen · mit Umschalt stumm"],
      [`${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")}`, "Werkzeug: Setzen, Betonen, Zufall, Wirbel, Länge"],
      [`${key("KeyA")} bis ${key("KeyK")}`, "den Ring von Hand spielen (acht Stufen)"],
      [key("KeyL"), "Einspielen: Gespieltes landet im Ring"],
      [`${key("KeyZ")} ${key("KeyX")} ${key("KeyC")} ${key("KeyV")} ${key("KeyB")} halten`, "Effekte: Dumpf, Dünn, Stotter, Echo, Pause"],
      ["← →", "Zeiger auf dem Ring · mit Umschalt den Ring drehen"],
      ["↑ ↓", "Ring wechseln · mit Umschalt alles höher oder tiefer"],
      ["Eingabe", "am Zeiger setzen oder löschen"],
      ["+ −", "Ton am Zeiger höher oder tiefer"],
      [key("KeyN"), "Ring würfeln · mit Umschalt nur variieren"],
      ["Im Malkasten", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} Pinsel und Radierer · ${key("KeyT")} Dicke · ${key("KeyN")} würfeln · Entf nimmt den letzten Strich · Esc fertig`],
      [key("KeyM"), "Ring stumm · mit Umschalt allein hören"],
      [", .", "Szene zurück oder vor"],
      ["Strg+Z", "Rückgängig · mit Umschalt wiederholen"],
      ["?", "diese Hilfe"],
    ];
    const list = byId("help-keys");
    list.replaceChildren(...rows.flatMap(([keys, what]) => [el("dt", "", keys), el("dd", "", what)]));
    const commit: unknown = import.meta.env.VITE_APP_COMMIT;
    byId("version").textContent = typeof commit === "string" && commit ? `Kreisel, Stand ${commit.slice(0, 7)}` : "Kreisel, Entwicklungsstand";
  }

  private outside(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".more")) this.closeMenu();
    if (!target?.closest("#chord-menu") && target?.id !== "kreisel") this.app.closeChord();
  }

  // ---- showing ----------------------------------------------------------------

  sync(): void {
    const app = this.app;
    const project = app.project;
    const selected = app.selected;
    const info = trackInfo(selected);
    const pattern = patternOf(project, selected);
    const settings = trackOf(project, selected);
    document.documentElement.style.setProperty("--focus", info.color);

    const play = byId("play");
    play.setAttribute("aria-pressed", String(app.playing));
    play.querySelector(".label")!.textContent = app.playing ? "Stopp" : "Start";
    const bpm = byId<HTMLInputElement>("bpm");
    if (document.activeElement !== bpm) bpm.value = String(project.bpm);
    byId<HTMLSelectElement>("root").value = String(project.root);
    byId<HTMLSelectElement>("scale").value = project.scale;
    byId<HTMLButtonElement>("undo").disabled = !app.store.canUndo;
    byId<HTMLButtonElement>("redo").disabled = !app.store.canRedo;
    byId<HTMLInputElement>("chain").checked = project.chain;
    byId<HTMLSelectElement>("repeats").value = String(project.repeats);
    for (const slider of this.sliders) {
      const value = String(Math.round(slider.read() * 100));
      if (slider.input.value !== value) slider.input.value = value;
    }

    const record = byId("record");
    record.setAttribute("aria-pressed", String(app.engine.recording));
    const showTime = (): void => {
      const seconds = Math.floor(app.engine.recordedSeconds);
      record.querySelector(".label")!.textContent = app.engine.recording ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Stopp` : "Aufnehmen";
    };
    showTime();
    if (app.engine.recording && this.recordTimer === null) this.recordTimer = setInterval(showTime, 500);
    if (!app.engine.recording && this.recordTimer !== null) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }

    this.trackRows.forEach((row, track) => {
      const one = trackOf(project, track);
      row.classList.toggle("selected", track === selected);
      row.classList.toggle("silent", !app.audible(track));
      row.classList.toggle("solo", app.solo === track);
      row.querySelector(".sound")!.textContent = trackInfo(track).sounds[one.sound] ?? "";
      row.querySelector(".pick")!.setAttribute("aria-pressed", String(track === selected));
      row.querySelector(".mute")!.setAttribute("aria-pressed", String(!app.audible(track)));
    });

    const queued = app.engine.queuedScene;
    this.sceneButtons.forEach((node, index) => {
      const filled = project.scenes[index] !== null;
      node.classList.toggle("filled", filled);
      node.classList.toggle("current", index === project.scene);
      node.classList.toggle("queued", index === queued && index !== project.scene);
      node.setAttribute("aria-pressed", String(index === project.scene));
      node.title = filled ? `Szene ${SCENE_NAMES[index]} · mit Umschalt leeren` : `Leer: Klick macht eine Kopie von Szene ${SCENE_NAMES[project.scene]}`;
    });

    for (const [tool, node] of this.toolButtons) {
      node.setAttribute("aria-checked", String(tool === app.tool));
      node.disabled = tool === "laenge" && !info.melodic;
    }
    this.syncEasel();
    byId("live").setAttribute("aria-pressed", String(app.live));
    for (const [fx, node] of this.fxButtons) node.classList.toggle("held", app.engine.fx[fx]);

    const parts = this.panel;
    byId("panel").style.setProperty("--c", info.color);
    parts.name.textContent = info.name;
    parts.info.textContent = describe(pattern);
    this.soundButtons.forEach((chip, sound) => {
      chip.textContent = info.sounds[sound] ?? "";
      chip.setAttribute("aria-pressed", String(sound === settings.sound));
    });
    parts.puck.style.left = `${settings.x * 100}%`;
    parts.puck.style.bottom = `${settings.y * 100}%`;
    parts.axisX.textContent = `${info.xLabel} →`;
    parts.axisY.textContent = `${info.yLabel} ↑`;
    parts.pad.setAttribute("aria-label", `Klangfeld: ${info.xLabel} ${Math.round(settings.x * 100)} %, ${info.yLabel} ${Math.round(settings.y * 100)} %. Pfeiltasten verändern.`);
    parts.steps.textContent = String(pattern.len);
    const hits = activeSteps(pattern).length;
    parts.spread.max = String(pattern.len);
    if (document.activeElement !== parts.spread || Number(parts.spread.value) !== hits) parts.spread.value = String(hits);
    parts.spreadValue.textContent = String(hits);
    for (const node of byId("panel").querySelectorAll<HTMLButtonElement>(".line .button")) {
      if (node.textContent === "−") node.disabled = pattern.len <= MIN_STEPS;
      if (node.textContent === "+") node.disabled = pattern.len >= MAX_STEPS;
    }

    byId("status").textContent = app.easel ? `Klangmalerei ${info.name}: ${describeBild(settings.bild)}` : `${info.name}: ${describe(pattern)}`;
    this.syncChordMenu();
    this.syncToast();
    this.ring.invalidate();
    this.easel.invalidate();
  }

  /** The ring's own sound in the panel, the paint box and its shelf. */
  private syncEasel(): void {
    const app = this.app;
    const track = app.selected;
    const info = trackInfo(track);
    const settings = trackOf(app.project, track);
    const bild = settings.bild;

    this.own.pick.setAttribute("aria-pressed", String(settings.sound === OWN_SOUND));
    this.own.pick.title = bild ? "Den eigenen Klang dieses Rings spielen (noch ein Klick öffnet den Malkasten)" : "Einen eigenen Klang für diesen Ring malen";
    this.own.label.textContent = bild ? "Eigener Klang" : "Eigenen Klang malen";
    const signature = `${track}|${bild ? packBild(bild) : ""}`;
    if (signature !== this.thumbSignature) {
      this.thumbSignature = signature;
      renderThumb(this.own.thumb, bild, info.color);
    }

    const open = app.easel;
    byId("easel").hidden = !open;
    byId("brushes").hidden = !open;
    byId("tools").hidden = open;
    if (open && !this.easelOpen) {
      // The first hint is about the rings, and where the panel sits below the wheel, the sheet opens out of sight.
      this.closeCoach();
      byId("stage").scrollIntoView({ block: "nearest" });
    }
    this.easelOpen = open;
    if (!open) return;
    byId("easel").style.setProperty("--c", info.color);
    byId("easel-title").textContent = `Klangmalerei: ${info.name}`;
    byId("hold-box").hidden = !info.melodic;
    byId<HTMLInputElement>("hold").checked = bild?.hold !== null && bild?.hold !== undefined;
    byId("bild-empty").hidden = (bild?.strokes.length ?? 0) > 0 || app.listening !== null;
    this.brushButtons.forEach((node, index) => node.setAttribute("aria-checked", String(index === app.brush)));
    this.sizeDots.dataset.size = String(app.brushSize);
    byId("listening").hidden = !app.listening;
    byId("listening-text").textContent = app.listening ?? "";
    byId("bild-listen").setAttribute("aria-pressed", String(app.listening !== null));

    const shelfSignature = app.kept.map((item) => item.bild).join("|");
    if (shelfSignature !== this.shelfSignature) {
      this.shelfSignature = shelfSignature;
      const shelf = byId("shelf");
      const items: HTMLElement[] = [app.kept.length > 0 ? el("span", "shelf-label", "Regal") : el("span", "shelf-label empty", "Das Regal ist leer. „Merken“ hebt ein Bild auf: für andere Ringe und für den nächsten Kreisel.")];
      app.kept.forEach((item, index) => {
        const holder = el("span", "kept");
        const pick = button("kept-pick", "", `Aus dem Regal in diesen Ring holen (gemalt für ${trackInfo(item.ring).name})`);
        pick.setAttribute("aria-label", `Gemerkter Klang ${index + 1}, gemalt für ${trackInfo(item.ring).name}`);
        const thumb = el("canvas", "thumb");
        pick.append(thumb);
        pick.addEventListener("click", () => app.useKept(index));
        const drop = button("kept-drop", "×", "Aus dem Regal nehmen");
        drop.setAttribute("aria-label", `Gemerkten Klang ${index + 1} aus dem Regal nehmen`);
        drop.addEventListener("click", () => app.dropKept(index));
        holder.append(pick, drop);
        items.push(holder);
        // The canvas needs its place on the page before it knows its size.
        requestAnimationFrame(() => renderThumb(thumb, unpackBild(item.bild), trackInfo(item.ring).color));
      });
      shelf.replaceChildren(...items);
    }
  }

  private syncChordMenu(): void {
    const app = this.app;
    const menu = byId("chord-menu");
    const slot = app.openSlot;
    if (slot === null) {
      menu.hidden = true;
      this.chordSignature = "";
      return;
    }
    const project = app.project;
    const chords = currentScene(project).chords;
    const signature = `${slot}|${chords.join(",")}|${project.root}|${project.scale}`;
    if (signature !== this.chordSignature) {
      this.chordSignature = signature;
      const head = el("header");
      const close = button("button icon small", "×");
      close.setAttribute("aria-label", "Schließen");
      close.addEventListener("click", () => app.closeChord());
      head.append(el("strong", "", `Takt ${slot + 1} von ${chords.length}`), close);
      const grid = el("div", "chord-grid");
      for (let degree = 0; degree < 7; degree += 1) {
        const choice = button("chord", "");
        choice.append(el("b", "", chordName(project.root, project.scale, degree)), el("small", "", chordRoman(project.scale, degree)));
        choice.setAttribute("aria-pressed", String(chords[slot] === degree));
        choice.addEventListener("click", () => app.setChord(slot, degree));
        grid.append(choice);
      }
      const bars = el("div", "line");
      const less = button("button icon small", "−", "Einen Takt weniger");
      less.disabled = chords.length <= 1;
      less.addEventListener("click", () => app.setBars(chords.length - 1));
      const more = button("button icon small", "+", "Einen Takt mehr");
      more.disabled = chords.length >= MAX_CHORDS;
      more.addEventListener("click", () => app.setBars(chords.length + 1));
      bars.append(el("span", "label", "Takte"), less, el("output", "", String(chords.length)), more);
      menu.replaceChildren(head, grid, bars);
    }
    menu.hidden = false;
    const stage = byId("stage").getBoundingClientRect();
    const at = this.ring.slotPosition(slot);
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${clamp(at.x - stage.left - width / 2, 4, Math.max(4, stage.width - width - 4))}px`;
    const below = at.y - stage.top + 18;
    menu.style.top = `${below + height > stage.height - 4 ? Math.max(4, at.y - stage.top - height - 18) : below}px`;
  }

  private syncToast(): void {
    const app = this.app;
    const node = byId("toast");
    if (app.exporting !== null) {
      node.hidden = false;
      node.replaceChildren(el("span", "", `WAV wird gerechnet … ${Math.round(app.exporting * 100)} %`));
      node.dataset.text = "export";
      return;
    }
    const toast = app.toast;
    if (!toast) {
      node.hidden = true;
      node.dataset.text = "";
      return;
    }
    if (node.dataset.text === toast.text && !node.hidden) return;
    node.dataset.text = toast.text;
    const close = button("button icon small", "×");
    close.setAttribute("aria-label", "Meldung schließen");
    close.addEventListener("click", () => app.dismiss());
    const children: Node[] = [el("span", "", toast.text)];
    if (toast.action) {
      const action = toast.action;
      const act = button("button small", action.label);
      act.addEventListener("click", () => {
        action.run();
        app.dismiss();
      });
      children.push(act);
    }
    node.replaceChildren(...children, close);
    node.hidden = false;
  }
}
