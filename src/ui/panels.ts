import { BRUSH_TOOLS, FX, MALLETS, TOOLS, type App, type Deed } from "../app";
import type { FxName } from "../audio/engine";
import { describeBild } from "../bild";
import { BODY_NAMES, describeBody, materialName, TIGHT_NAMES } from "../body";
import { describeRumble, hasRumble } from "../rumble";
import { describeVoice, FIELD_LETTERS, syllables } from "../voice";
import { describeWeather, hasWeather, WEATHER_COLORS, WEATHER_HINTS, WEATHER_NAMES, windName, WINDS } from "../weather";
import { packBild, unpackBild } from "../codec";
import { BODY_SOUND, clamp, currentScene, MAX_VOICE_TEXT, VOICE_SOUND, MAX_BARS, MAX_CHORDS, MAX_STEPS, MIN_BARS, MIN_STEPS, OWN_SOUND, patternOf, SCENE_COUNT, SCENE_NAMES, TIME_MAX, TRACK_COUNT, trackInfo, trackOf, type ScaleId } from "../model";
import { chordName, chordRoman, NOTE_NAMES, SCALE_IDS, SCALES } from "../music";
import { activeSteps, describe } from "../patterns";
import { barCount, describePiece } from "../piece";
import { RULES, turnColor } from "../relay";
import { renderBodyThumb, type BenchView } from "./bench";
import type { BoothView } from "./booth";
import { renderThumb, type EaselView } from "./easel";
import { onContext } from "./menu";
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

/** Fog, sun, a cloud, rain, a spark, hail. */
const WEATHER_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18M6 12h15M3 16h14"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 10.8 1.3A3.4 3.4 0 0 1 17 18z"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4 5 11M13 4l-3 7M18 4l-3 7M9 13l-3 7M15 13l-3 7"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="1.9" class="fill"/><circle cx="14" cy="5" r="1.9" class="fill"/><circle cx="18" cy="12" r="1.9" class="fill"/><circle cx="9" cy="13" r="1.9" class="fill"/><circle cx="15" cy="19" r="1.9" class="fill"/><circle cx="5" cy="19" r="1.9" class="fill"/></svg>',
];

/** What sets a body going: soft mallet, hard mallet, a plucking pick, a bow, breath. */
const MALLET_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 13.5 20 4"/><circle cx="7.5" cy="16.5" r="4.4"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 20 4"/><circle cx="6.5" cy="17.5" r="2.6" class="fill"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 6 9.5c2-4.6 10-4.6 12 0z"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.5 21 6.5M4.5 20.5 21 10.5"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h10.5a2.8 2.8 0 1 0-2.8-2.8M3 15h13.5a2.8 2.8 0 1 1-2.8 2.8M3 12h6"/></svg>',
];

const BRUSH_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c3-7 6-7 9 0s6 7 9 0"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16 8 7v9l5-9v9l5-9v9"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="fill"><circle cx="5" cy="13" r="1.3"/><circle cx="9" cy="8" r="1.3"/><circle cx="10" cy="15" r="1.3"/><circle cx="14" cy="11" r="1.3"/><circle cx="15" cy="17" r="1.3"/><circle cx="18" cy="7" r="1.3"/><circle cx="19" cy="13" r="1.3"/></g></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 19-4-4 9-9 6 6-7 7zM13 19h7M9 10l6 6"/></svg>',
] as const;

/** The physical keys: tools on the top row, playing on the home row, effects on the bottom row. */
export const TOOL_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT"] as const;
/** The six kinds of weather: the top row, one key further. */
export const WEATHER_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY"] as const;
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
/*
 * The little motions a node plays once, when something was done or has changed: a tin toy on a paper table, so
 * things hop into place and click, quickly. What goes with a state or with something appearing is in the style
 * sheet (under "motion"); what the wheel does is drawn on its canvas (ring.ts, motion.ts).
 */
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SNAP = "cubic-bezier(0.2, 0.9, 0.3, 1)";
const MOTIONS = {
  /** Something clicks in: a chosen scene or sound, a switched sign. */
  pop: { frames: [{ transform: "scale(0.55)" }, { transform: "scale(1)" }], duration: 240, easing: SPRING },
  /** Dice. */
  tumble: { frames: [{ transform: "rotate(0deg)" }, { transform: "translateY(-4px) rotate(200deg)", offset: 0.45 }, { transform: "rotate(360deg)" }], duration: 420, easing: SNAP },
  /** The arrows of undo and redo wind back and on. */
  "wind-back": { frames: [{ transform: "rotate(0deg)" }, { transform: "rotate(-55deg)", offset: 0.35 }, { transform: "rotate(0deg)" }], duration: 300, easing: SNAP },
  "wind-on": { frames: [{ transform: "rotate(0deg)" }, { transform: "rotate(55deg)", offset: 0.35 }, { transform: "rotate(0deg)" }], duration: 300, easing: SNAP },
  /** A number that counts on. */
  tick: { frames: [{ opacity: 0.2, transform: "translateY(-5px)" }, { opacity: 1, transform: "translateY(0)" }], duration: 180, easing: SNAP },
  /** A tool that was taken up. */
  wiggle: { frames: [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(-14deg) scale(1.12)", offset: 0.3 }, { transform: "rotate(9deg) scale(1)", offset: 0.65 }, { transform: "rotate(0deg) scale(1)" }], duration: 300, easing: SNAP },
  /** A name that arrives. */
  "slide-in": { frames: [{ opacity: 0, transform: "translateX(-7px)" }, { opacity: 1, transform: "translateX(0)" }], duration: 240, easing: SNAP },
  /** The frame around what the keyboard is on lands there. */
  land: { frames: [{ outlineOffset: "8px" }, { outlineOffset: "2px" }], duration: 160, easing: SNAP },
} as const satisfies Record<string, { frames: Keyframe[]; duration: number; easing: string }>;
type Motion = keyof typeof MOTIONS;
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Plays a motion on a node once, from its start even if it is still playing. Not for someone who asked for less motion. */
function playMotion(node: Element | null, motion: Motion, delay = 0): void {
  if (!node || calm.matches) return;
  for (const running of node.getAnimations()) if (running.id === motion) running.cancel();
  const { frames, duration, easing } = MOTIONS[motion];
  node.animate([...frames], { id: motion, duration, easing, delay, fill: delay > 0 ? "backwards" : "none" });
}

/** A button answers that what it stands for was done: it lights up in a colour and fades back. */
function flash(node: Element | null, color: string): void {
  if (!node || calm.matches) return;
  for (const running of node.getAnimations()) if (running.id === "flash") running.cancel();
  node.animate([{ backgroundColor: color }, { backgroundColor: getComputedStyle(node).backgroundColor }], { id: "flash", duration: 400, easing: "ease-out" });
}

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
  private readonly built = { pick: button("own-pick", ""), thumb: el("canvas", "thumb"), label: el("span", "own-label") };
  private builtSignature = "";
  private benchOpen = false;
  private readonly malletButtons: HTMLButtonElement[] = [];
  private readonly kindButtons: HTMLButtonElement[] = [];
  private readonly shape = { size: el("input"), tight: el("input"), material: el("input"), tightName: el("span", "label"), materialName: el("span", "label") };
  private readonly quake = el("div", "group quake");
  private readonly sung = { pick: button("own-pick", ""), label: el("span", "own-label") };
  private readonly vowels = el("span", "vowels");
  private boothOpen = false;
  private syllableSignature = "";
  private litSyllable = -1;
  private readonly weatherRow = el("li", "track weather-row");
  private readonly weatherBox = el("div", "panel-box panel-weather");
  private readonly sky = { info: el("p", "info"), clear: button("button small", "Aufklaren", "Alles Wetter wegnehmen (Umschalt+Entf)") };
  private readonly cloudButtons: HTMLButtonElement[] = [];
  private readonly windInputs: HTMLInputElement[] = [];
  private readonly windNames: HTMLElement[] = [];
  private weatherFocused = false;
  private readonly sizeDots = el("span", "dots");
  private thumbSignature = "";
  private shelfSignature = "noch nicht gebaut";
  private easelOpen = false;
  private readonly ringBox = el("div", "panel-box panel-ring");
  private readonly pieceBox = el("div", "panel-box panel-piece");
  private readonly pieceRow = el("li", "track piece-row");
  private readonly pieceParts = { info: el("p", "info"), on: el("input"), bars: el("output"), order: el("ol", "entries") };
  private orderSignature = "";
  private pieceFocused = false;
  private readonly veilBox = el("div", "panel-box panel-veil");
  private readonly ruleInputs: HTMLInputElement[] = [];
  private turnsSignature = "";
  private closeCoach: () => void = () => undefined;
  private readonly panel = { name: el("h2"), info: el("p", "info"), pad: el("div", "pad"), puck: el("span", "puck"), axisX: el("span", "axis x"), axisY: el("span", "axis y"), steps: el("output"), spread: el("input"), spreadValue: el("output") };
  private chordSignature = "";
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private lastPreview = 0;
  // ---- motion: what each node showed last, so that it moves when that changes (and not when the page is built) ----
  private readonly seen = new WeakMap<Element, string>();
  private shownRing = -1;
  private readonly lamps: boolean[] = [];
  private readonly doing = { roll: button("button small", "Würfeln", "Eine neue Idee für diesen Ring (N)"), vary: button("button small", "Variieren", "Nur ein wenig verändern (Umschalt+N)"), wipe: button("button small", "Leeren", "Alle Schläge dieses Rings entfernen (Umschalt+Entf)") };
  private readonly head = el("header", "panel-head");

  constructor(private readonly app: App, private readonly ring: RingView, private readonly easel: EaselView, private readonly bench: BenchView, private readonly mouth: BoothView) {
    this.buildBar();
    this.buildTracks();
    this.buildScenes();
    this.buildTools();
    this.buildEasel();
    this.buildBench();
    this.buildBooth();
    this.buildWeather();
    this.buildFx();
    this.buildPanel();
    this.buildPiece();
    this.buildRelay();
    this.buildCoach();
    this.buildHelp();
    document.addEventListener("pointerdown", (event) => this.outside(event), true);
    // A button clicked with the mouse should not keep the keyboard: the space bar belongs to start and stop.
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (target && event.detail > 0 && !target.closest("dialog")) target.blur();
    });
    // The right button sends no click, so its button is let go when the button comes up: a latched effect
    // must not keep the space bar.
    document.addEventListener("mouseup", (event) => {
      if (event.button !== 2) return;
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (target && target === document.activeElement && !target.closest("dialog, #context")) target.blur();
    });
    // A window that closes hands the keyboard back to the button that opened it. For someone working with the
    // mouse that button would then swallow the space bar, so it is let go again; with the Tab key in use it stays.
    let tabbing = false;
    document.addEventListener("pointerdown", () => { tabbing = false; }, true);
    document.addEventListener("keydown", (event) => { if (event.key === "Tab") tabbing = true; }, true);
    for (const dialog of document.querySelectorAll("dialog")) {
      dialog.addEventListener("close", () => {
        queueMicrotask(() => {
          const active = document.activeElement;
          if (!tabbing && active instanceof HTMLButtonElement) active.blur();
        });
      });
    }
    // The frame around what the keyboard is on lands there (a click shows no frame, so nothing lands).
    document.addEventListener("focusin", (event) => {
      if (event.target instanceof Element && event.target.matches(":focus-visible")) playMotion(event.target, "land");
    });
    app.onDeed = (deed) => this.answer(deed);
    const frame = (): void => {
      this.everyFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    void this.readKeyboard();
    app.subscribe(() => this.sync());
    this.sync();
  }

  /** Plays a motion on a node when what it shows has changed since the last time (never the first time). With `when`, only for a change to that value; with `quiet`, the change is only noted. */
  private moved(node: Element | null, value: string | number | boolean, motion: Motion, when?: string, quiet = false): void {
    if (!node) return;
    const text = String(value);
    const before = this.seen.get(node);
    this.seen.set(node, text);
    if (quiet || before === undefined || before === text) return;
    if (when === undefined || when === text) playMotion(node, motion);
  }

  /** A button answers what was done, whether a click did it or a key. */
  private answer(deed: Deed): void {
    const color = trackInfo(this.app.selected).color;
    const tumble = (track: number, delay: number): void => playMotion(this.trackRows[track]?.querySelector(".roll svg") ?? null, "tumble", delay);
    if (deed.what === "undo") playMotion(byId("undo").querySelector("svg"), "wind-back");
    else if (deed.what === "redo") playMotion(byId("redo").querySelector("svg"), "wind-on");
    else if (deed.what === "share") flash(byId("share"), color);
    else if (deed.what === "dice-all") {
      flash(byId("dice-all"), color);
      // Down the list, one after the other.
      for (let track = 0; track < TRACK_COUNT; track += 1) tumble(track, (TRACK_COUNT - 1 - track) * 30);
    } else if (deed.what === "dice") {
      tumble(deed.track, 0);
      if (deed.track === this.app.selected) flash(this.doing.roll, color);
    } else if (deed.what === "vary" || deed.what === "clear") {
      if (deed.track === this.app.selected) flash(deed.what === "vary" ? this.doing.vary : this.doing.wipe, color);
    }
  }

  /** What moves with the music rather than with a change: the lamp of every ring in the list, the syllable being sung. */
  private everyFrame(): void {
    const app = this.app;
    this.trackRows.forEach((row, track) => {
      const since = app.sinceStruck(track);
      const lit = since > -0.02 && since < 0.09 && app.audible(track);
      if (lit === (this.lamps[track] ?? false)) return;
      this.lamps[track] = lit;
      row.classList.toggle("hit", lit);
    });
    this.lightSyllable();
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
    for (const nodes of [this.brushButtons, this.malletButtons, this.cloudButtons]) {
      nodes.forEach((node, index) => {
        const key = node.querySelector(".key");
        if (key) key.textContent = this.keyLabel(WEATHER_CODES[index] ?? "");
      });
    }
    this.buildHelp();
  }

  // ---- building ---------------------------------------------------------------

  private slider(input: HTMLInputElement, read: () => number, write: (value: number) => void, reset?: () => void): void {
    input.addEventListener("input", () => write(Number(input.value) / 100));
    input.addEventListener("change", () => this.app.store.settle());
    if (reset) {
      // The right button puts a control back where a fresh Kreisel has it.
      input.addEventListener("pointerdown", (event) => {
        if (event.button !== 2) return;
        reset();
        this.app.store.settle();
      });
      input.addEventListener("contextmenu", (event) => event.preventDefault());
      input.title = input.title ? `${input.title} · Rechtsklick setzt zurück` : "Rechtsklick setzt zurück";
    }
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
    this.slider(byId("swing"), () => app.project.swing, (swing) => app.setGlobal({ swing }, "swing"), () => app.resetGlobal("swing"));
    this.slider(byId("pump"), () => app.project.pump, (pump) => app.setGlobal({ pump }, "pump"), () => app.resetGlobal("pump"));
    this.slider(byId("volume"), () => app.project.volume, (volume) => app.setGlobal({ volume }, "volume"), () => app.resetGlobal("volume"));

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
      if (action === "save") void app.exportSound();
      else if (action === "clear-scene") app.clearScene(app.project.scene);
      else if (action === "empty") app.newProject(true);
      else if (action === "factory") app.newProject(false);
      else if (action === "help") this.showHelp();
      else if (action === "relay") this.showRelay();
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
    // The weather lies over all the rings: it comes before them.
    const sky = this.weatherRow;
    const choose = button("pick", "", "Das Wetter wählen: Effekte auf das Rad malen (Taste 9)");
    choose.append(el("span", "dot"), el("span", "name", "Wetter"), el("span", "sound"));
    choose.addEventListener("click", () => this.app.focusWeather());
    const throwIt = iconButton("roll", ICONS.dice, "Wetter würfeln", "Ein neues Wetter würfeln");
    throwIt.addEventListener("click", () => this.app.diceWeather());
    sky.append(choose, throwIt);
    onContext(sky, (x, y, byKeyboard) => this.app.openContext({ kind: "weather" }, x, y, byKeyboard));
    list.append(sky);
    // The piece is the outermost ring: it comes first.
    const row = this.pieceRow;
    const pick = button("pick", "", "Den Stück-Ring wählen (Taste 8)");
    pick.append(el("span", "dot"), el("span", "name", "Stück"), el("span", "sound"));
    pick.addEventListener("click", () => this.app.focusPiece());
    const toggle = button("piece-toggle", "", "Nach dem Stück spielen oder nur die Szene im Kreis");
    toggle.addEventListener("click", () => this.app.togglePiece());
    const roll = iconButton("roll", ICONS.dice, "Stück würfeln", "Einen neuen Verlauf würfeln");
    roll.addEventListener("click", () => this.app.diceThePiece());
    row.append(pick, toggle, roll);
    onContext(row, (x, y, byKeyboard) => this.app.openContext({ kind: "piece", bar: null }, x, y, byKeyboard));
    list.append(row);
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
      onContext(row, (x, y, byKeyboard) => {
        this.app.select(track);
        this.app.openContext({ kind: "ring", track, step: null }, x, y, byKeyboard);
      });
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
      onContext(scene, (x, y, byKeyboard) => this.app.openContext({ kind: "scene", index }, x, y, byKeyboard));
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

  /** The voice's window: the line it sings, how it is cut into syllables, and the two ways to shape the voice. */
  private buildBooth(): void {
    const app = this.app;
    const text = byId<HTMLInputElement>("voice-text");
    text.maxLength = MAX_VOICE_TEXT;
    text.addEventListener("input", () => app.shapeVoice({ text: text.value }, "text"));
    text.addEventListener("keydown", (event) => {
      // Typing a line must not play the Kreisel; Enter sings it, Escape puts the window away.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        app.singLine();
      } else if (event.key === "Escape") {
        app.closeBooth();
      }
    });
    byId("voice-sing").addEventListener("click", () => app.singLine());
    byId("booth-dice").addEventListener("click", () => app.diceVoice());
    byId("booth-done").addEventListener("click", () => app.closeBooth());
    const holder = byId("booth-shape");
    const shaper = (label: string, field: "mouth" | "breath", title: string, id: string): void => {
      const line = el("label", "line");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.id = id;
      input.title = title;
      this.slider(input, () => app.voice?.[field] ?? 0.5, (value) => app.shapeVoice({ [field]: value }, field), () => app.shapeVoice({ [field]: field === "mouth" ? 0.5 : 0.15 }));
      input.addEventListener("change", () => app.singLine());
      line.append(el("span", "label", label), input);
      holder.append(line);
    };
    shaper("Mundraum", "mouth", "Der Raum im Mund: klein und hell bis groß und dunkel", "voice-mouth");
    shaper("Hauch", "breath", "Wie viel Atem in der Stimme liegt: klar bis geflüstert", "voice-breath");
    // A click beside the window puts it away, like a click beside any open box.
    byId("booth").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) app.closeBooth();
    });
  }

  /** The weather: its brushes (in the tools' place) and its panel, where every kind of weather has a wind. */
  private buildWeather(): void {
    const app = this.app;
    const brushes = byId("weathers");
    WEATHER_NAMES.forEach((name, kind) => {
      const node = button("tool", "", WEATHER_HINTS[kind] ?? name);
      node.innerHTML = WEATHER_ICONS[kind] ?? "";
      node.style.setProperty("--w", WEATHER_COLORS[kind] ?? "currentColor");
      node.append(el("span", "name", name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => app.setCloud(kind));
      brushes.append(node);
      this.cloudButtons.push(node);
    });

    const head = el("header", "panel-head");
    head.append(el("span", "dot"), el("h2", "", "Wetter"));
    const doing = el("div", "doing");
    const roll = button("button small", "Würfeln", "Ein neues Wetter würfeln (N)");
    roll.id = "weather-dice";
    roll.addEventListener("click", () => app.diceWeather());
    this.sky.clear.id = "weather-clear";
    this.sky.clear.addEventListener("click", () => app.clearWeather());
    doing.append(roll, this.sky.clear);

    const winds = el("div", "group");
    winds.append(el("h3", "", "Wind: so zieht jedes Wetter um das Rad"));
    WEATHER_NAMES.forEach((name, kind) => {
      const line = el("label", "line sky");
      const swatch = el("span", "swatch");
      swatch.style.background = WEATHER_COLORS[kind] ?? "";
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = String(WINDS.length - 1);
      input.step = "1";
      input.title = `Wie schnell ${name} um das Rad zieht: nach links gegen, nach rechts mit dem Uhrzeiger · Rechtsklick hält es an`;
      input.addEventListener("input", () => app.setWind(kind, WINDS[Number(input.value)] ?? 0, "wind"));
      input.addEventListener("change", () => app.store.settle());
      input.addEventListener("pointerdown", (event) => {
        if (event.button !== 2) return;
        app.setWind(kind, 0);
      });
      input.addEventListener("contextmenu", (event) => event.preventDefault());
      const speed = el("output");
      line.append(swatch, el("span", "label", name), input, speed);
      winds.append(line);
      this.windInputs.push(input);
      this.windNames.push(speed);
    });
    const hint = el("p", "easel-hint", "Mal Wetter auf das Rad: Wie weit außen, sagt welcher Ring, der Winkel sagt wann. Ein Strich quer über mehrere Ringe trifft sie alle. Noch einmal darüber macht es stärker, die rechte Taste nimmt es weg, das Mausrad ändert die Pinselbreite. Mit Wind zieht das Wetter Takt für Takt weiter.");
    this.weatherBox.append(head, this.sky.info, doing, winds, hint);
    this.weatherBox.hidden = true;
    byId("panel").append(this.weatherBox);
  }

  /** The workbench: the kinds of body, the three ways to shape one, and what sets it going (in the tools' place). */
  private buildBench(): void {
    const app = this.app;
    const mallets = byId("mallets");
    MALLETS.forEach((mallet, index) => {
      const node = button("tool", "", mallet.hint);
      node.innerHTML = MALLET_ICONS[index] ?? "";
      node.append(el("span", "name", mallet.name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => {
        app.shapeBody({ exciter: index });
        app.hearBody();
      });
      mallets.append(node);
      this.malletButtons.push(node);
    });
    const kinds = byId("bench-kinds");
    BODY_NAMES.forEach((name, kind) => {
      const chip = button("chip", name);
      chip.addEventListener("click", () => {
        app.shapeBody({ kind });
        app.hearBody();
      });
      kinds.append(chip);
      this.kindButtons.push(chip);
    });

    const holder = byId("bench-shape");
    const shaper = (input: HTMLInputElement, label: HTMLElement, field: "size" | "tight" | "material", title: string): void => {
      const line = el("label", "line");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.title = title;
      this.slider(input, () => app.body?.[field] ?? 0.5, (value) => app.shapeBody({ [field]: value }, field), () => app.shapeBody({ [field]: 0.5 }));
      // Let go of the slider, the body says how it sounds now.
      input.addEventListener("change", () => app.hearBody());
      line.append(label, input);
      holder.append(line);
    };
    shaper(this.shape.size, el("span", "label", "Größe"), "size", "Groß klingt tief und lang, klein hoch und kurz (auch mit dem Mausrad über dem Körper)");
    shaper(this.shape.tight, this.shape.tightName, "tight", "Straffer, dicker, enger: heller und kürzer (auch mit Umschalt und Mausrad)");
    shaper(this.shape.material, this.shape.materialName, "material", "Material, von Holz über Metall zu Glas: wie lange es nachklingt");

    byId("bench-done").addEventListener("click", () => app.closeBench());
    byId("bench-dice").addEventListener("click", () => app.diceBody());
    // A click beside the bench puts it away, like a click beside any open box.
    byId("bench").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) app.closeBench();
    });
  }

  private buildFx(): void {
    const holder = byId("fx");
    for (const fx of FX) {
      const pad = button("pad-fx", "", `${fx.hint} (halten · Rechtsklick rastet ein)`);
      // Each effect's name shows what it does while it is held (see "motion" in the style sheet).
      pad.dataset.fx = fx.id;
      pad.append(el("span", "name", fx.name), el("kbd", "key"));
      pad.setAttribute("aria-pressed", "false");
      const release = (): void => this.app.setFx(fx.id, false);
      pad.addEventListener("pointerdown", (event) => {
        // The right button latches the effect; any press on a latched one lets it go again.
        if (event.button === 2 || this.app.latched.has(fx.id)) {
          this.app.latchFx(fx.id);
          return;
        }
        capture(pad, event);
        this.app.setFx(fx.id, true);
      });
      pad.addEventListener("contextmenu", (event) => event.preventDefault());
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

    const head = this.head;
    head.append(el("span", "dot"), parts.name);
    const doing = el("div", "doing");
    const { roll, vary, wipe } = this.doing;
    roll.addEventListener("click", () => app.diceRing(app.selected));
    vary.addEventListener("click", () => app.varyRing(app.selected));
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
    this.own.pick.id = "own-pick";
    this.own.pick.append(this.own.thumb, this.own.label);
    this.own.pick.addEventListener("click", () => app.useOwn());
    const paint = button("button small", "Malen", "Den eigenen Klang dieses Rings malen");
    paint.id = "paint";
    paint.addEventListener("click", () => app.openEasel());
    own.append(this.own.pick, paint);

    // And its own body: a thing that rings, built on the workbench.
    const built = el("div", "own");
    this.built.pick.id = "built-pick";
    this.built.pick.append(this.built.thumb, this.built.label);
    this.built.pick.addEventListener("click", () => app.useBody());
    const build = button("button small", "Bauen", "Den Klangkörper dieses Rings bauen");
    build.id = "build";
    build.addEventListener("click", () => app.openBench());
    built.append(this.built.pick, build);

    // And its own voice: a line of text, sung a syllable a hit.
    const sung = el("div", "own");
    const lips = el("span", "thumb lips");
    this.sung.pick.id = "voice-pick";
    this.sung.pick.append(lips, this.sung.label);
    this.sung.pick.addEventListener("click", () => app.useVoice());
    const write = button("button small", "Text", "Die Zeile schreiben, die dieser Ring singt");
    write.id = "voice-edit";
    write.addEventListener("click", () => app.openBooth());
    sung.append(this.sung.pick, write);

    const pad = parts.pad;
    pad.tabIndex = 0;
    pad.setAttribute("role", "group");
    // For a voice the pad is the field of the vowels.
    for (const { x, y, vowel } of FIELD_LETTERS) {
      const letter = el("i", "", vowel);
      // Kept clear of the pad's edge, however flat the pad is.
      letter.style.left = `calc(9px + (100% - 18px) * ${x})`;
      letter.style.bottom = `calc(9px + (100% - 18px) * ${y})`;
      this.vowels.append(letter);
    }
    pad.append(this.vowels, parts.puck, parts.axisX, parts.axisY);
    const place = (event: PointerEvent): void => {
      const box = pad.getBoundingClientRect();
      app.setTrack(app.selected, { x: clamp((event.clientX - box.left) / box.width, 0, 1), y: clamp(1 - (event.clientY - box.top) / box.height, 0, 1) }, "pad");
      if (performance.now() - this.lastPreview > 170) {
        this.lastPreview = performance.now();
        app.preview(app.selected);
      }
    };
    pad.addEventListener("pointerdown", (event) => {
      app.wake();
      if (event.button === 2) {
        // The right button puts the sound back where a fresh Kreisel has it.
        app.resetPad(app.selected);
        app.store.settle();
        return;
      }
      capture(pad, event);
      // While it is dragged the point follows the pointer at once; let go, it glides to wherever it is put.
      pad.classList.add("dragging");
      this.lastPreview = 0;
      place(event);
    });
    for (const end of ["pointerup", "pointercancel", "lostpointercapture"] as const) pad.addEventListener(end, () => pad.classList.remove("dragging"));
    pad.addEventListener("contextmenu", (event) => event.preventDefault());
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

    // The kick's ring has its Nachbeben: painted into the ring, with a character of its own.
    const quake = this.quake;
    const shaking = el("div", "line");
    const paintIt = button("button small", "Malen", "Das Nachbeben in den Kick-Ring malen: außen bebt es stark, innen gar nicht (Werkzeug Beben)");
    paintIt.id = "rumble-paint";
    paintIt.addEventListener("click", () => app.paintTheRumble());
    const throwIt = button("button small", "Würfeln", "Eine der üblichen Formen um die Kicks legen: Offbeat, rollend, Schweif");
    throwIt.id = "rumble-dice";
    throwIt.addEventListener("click", () => app.diceRumble());
    const still = button("button small", "Aus", "Das Nachbeben wegnehmen");
    still.id = "rumble-off";
    still.addEventListener("click", () => app.shapeRumble(-1));
    shaking.append(el("span", "label", "Nachbeben"), paintIt, throwIt, still);
    const character = el("div", "line pair");
    const characterSlider = (label: string, field: "dirt" | "roll", title: string): void => {
      const half = el("label", "half");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.id = `rumble-${field}`;
      input.title = title;
      this.slider(input, () => app.project[field], (value) => app.setRumble({ [field]: value }, field), () => app.resetRumble(field));
      half.append(el("span", "label", label), input);
      character.append(half);
    };
    characterSlider("Dreck", "dirt", "Von tief und sauber bis verzerrt und dreckig");
    characterSlider("Rollen", "roll", "Von einem einzigen Schwellen bis zu rollenden Sechzehnteln");
    quake.append(shaking, character);

    const mix = el("div", "group");
    const mixSlider = (label: string, field: "level" | "hall" | "echo"): void => {
      const line = el("label", "line");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      this.slider(input, () => trackOf(app.project, app.selected)[field], (value) => app.setTrack(app.selected, { [field]: value }, field), () => app.resetTrack(app.selected, field));
      line.append(el("span", "label", label), input);
      mix.append(line);
    };
    mixSlider("Lautstärke", "level");
    mixSlider("Hall", "hall");
    mixSlider("Echo", "echo");

    this.ringBox.append(head, parts.info, doing, sounds, own, built, sung, pad, ringGroup, quake, mix);
    this.veilBox.append(
      el("header", "panel-head"),
      el("p", "veil-text", "Stille Post: Dieser Ring ist verdeckt. Jemand hat hier schon gebaut, aber du hörst und siehst nur den Ring der Person vor dir. Bau deinen eigenen dazu: Nimm einen Ring, der noch leer ist. Wenn alle fertig sind, deckt ihr im Reihum-Fenster auf."),
    );
    this.veilBox.querySelector("header")!.append(el("span", "dot"), el("h2"));
    holder.append(this.ringBox, this.pieceBox, this.veilBox);
  }

  /** Reihum: the button in the bar, the window with the turns, and the bar shown while looking back. */
  private buildRelay(): void {
    const app = this.app;
    const dialog = byId<HTMLDialogElement>("reihum");
    byId("relay").addEventListener("click", () => this.showRelay());
    const name = byId<HTMLInputElement>("relay-name");
    name.addEventListener("input", () => app.setName(name.value));
    const rules = byId("relay-rules");
    RULES.forEach((rule, index) => {
      const label = el("label", "check");
      const input = el("input");
      input.type = "radio";
      input.name = "relay-rule";
      input.value = String(index);
      input.addEventListener("change", () => app.setRule(index));
      label.append(input, el("span", "", rule.name));
      rules.append(label);
      this.ruleInputs.push(input);
    });
    const message = byId("relay-message");
    byId("relay-send").addEventListener("click", () => {
      void app.finishTurn().then((done) => {
        if (done) {
          dialog.close();
          return;
        }
        // Why the turn did not count is said here, in the window, not on the page behind it.
        message.textContent = app.toast?.text ?? "";
        message.hidden = message.textContent === "";
        app.dismiss();
      });
    });
    dialog.addEventListener("input", () => { message.hidden = true; });
    byId("relay-reveal").addEventListener("click", () => {
      app.revealRelay();
      dialog.close();
    });
    byId("relay-end").addEventListener("click", () => {
      app.endRelay();
      dialog.close();
    });
  }

  showRelay(): void {
    const dialog = byId<HTMLDialogElement>("reihum");
    byId<HTMLInputElement>("relay-name").value = this.app.name;
    byId("relay-message").hidden = true;
    this.turnsSignature = "";
    // Open first: the window's contents are only kept up to date while it is open.
    if (!dialog.open) dialog.showModal();
    this.syncRelay();
  }

  /** The turns in the bar's button, the window, the look-back bar, and the cloth over veiled rings. */
  private syncRelay(): void {
    const app = this.app;
    const relay = app.relay;
    const turns = relay?.turns ?? [];
    const veils = relay !== null && relay.rule === 2 && !relay.open && turns.length > 0;
    const relayButton = byId("relay");
    relayButton.textContent = turns.length > 0 ? `Reihum · ${turns.length + 1}` : "Reihum";
    relayButton.setAttribute("aria-label", turns.length > 0 ? `Reihum: Zug ${turns.length + 1} ist deiner` : "Reihum");

    const bar = byId("lookback");
    const looked = app.lookBack;
    bar.hidden = looked === null;
    if (looked !== null && bar.dataset.turn !== String(looked)) {
      bar.dataset.turn = String(looked);
      const now = button("button small", "Zurück zu jetzt");
      now.addEventListener("click", () => app.look(null));
      const from = button("button small", "Von hier weiterbauen", "Der Kreisel wird wieder, was er nach diesem Zug war; die späteren Züge fallen weg");
      from.addEventListener("click", () => app.continueFrom(looked));
      bar.replaceChildren(el("span", "", `Rückblick: Zug ${looked + 1} von ${turns[looked]?.name ?? ""}`), now, from);
    }
    if (looked === null) bar.dataset.turn = "";

    this.trackRows.forEach((row, track) => {
      const veiled = app.veiled(track);
      row.classList.toggle("veiled", veiled);
      if (veiled) row.querySelector(".sound")!.textContent = "verdeckt";
      for (const node of row.querySelectorAll<HTMLButtonElement>(".mute, .roll")) node.disabled = veiled;
    });
    const veiled = !app.pieceFocus && app.veiled(app.selected);
    this.veilBox.hidden = !veiled;
    if (veiled) {
      this.ringBox.hidden = true;
      this.veilBox.style.setProperty("--c", trackInfo(app.selected).color);
      this.veilBox.querySelector("h2")!.textContent = trackInfo(app.selected).name;
    }

    if (!byId<HTMLDialogElement>("reihum").open) return;
    const rule = relay ? relay.rule : app.rule;
    byId("relay-rules").hidden = turns.length > 0;
    this.ruleInputs.forEach((input, index) => { input.checked = index === rule; });
    byId("relay-rule").textContent = turns.length > 0
      ? `Spielregel dieser Runde: ${RULES[rule]?.name ?? ""}. ${RULES[rule]?.hint ?? ""}${relay?.rule === 2 && relay.open ? " (Aufgedeckt.)" : ""}`
      : (RULES[rule]?.hint ?? "");
    byId("relay-turns-title").hidden = turns.length === 0;

    const signature = `${veils}|${turns.map((turn) => turn.name).join("|")}`;
    if (signature !== this.turnsSignature) {
      this.turnsSignature = signature;
      byId("relay-turns").replaceChildren(...turns.map((turn, index) => {
        const item = el("li", "turn");
        item.style.setProperty("--c", relay ? turnColor(relay, index) : "currentColor");
        const hear = button("button small", "Anhören", veils ? "Erst nach dem Aufdecken" : `Den Kreisel hören, wie er nach Zug ${index + 1} war`);
        hear.disabled = veils;
        hear.addEventListener("click", () => {
          app.look(index);
          byId<HTMLDialogElement>("reihum").close();
        });
        const from = button("button small", "Von hier weiter", veils ? "Erst nach dem Aufdecken" : "Von diesem Zug aus neu weiterbauen; die späteren Züge fallen weg");
        from.disabled = veils;
        from.addEventListener("click", () => {
          app.continueFrom(index);
          byId<HTMLDialogElement>("reihum").close();
        });
        item.append(el("span", "dot"), el("span", "name", `Zug ${index + 1} · ${turn.name}`), hear, from);
        return item;
      }));
    }
    const touched = turns.length > 0 ? app.turnRings.map((ring) => trackInfo(ring).name) : [];
    byId("relay-now").textContent = turns.length === 0
      ? "Noch kein Zug. Der erste Zug ist der Kreisel, wie er jetzt ist."
      : touched.length > 0 ? `Dein Zug (Nr. ${turns.length + 1}): ${touched.join(", ")} angefasst.` : `Dein Zug (Nr. ${turns.length + 1}): noch nichts an den Ringen verändert.`;
    byId("relay-reveal").hidden = !veils;
    byId("relay-end").hidden = relay === null;
  }

  /** The panel of the piece: what the outermost ring is, its length, and the order in which the rings come in. */
  private buildPiece(): void {
    const app = this.app;
    const parts = this.pieceParts;
    const head = el("header", "panel-head");
    head.append(el("span", "dot"), el("h2", "", "Stück"));

    const doing = el("div", "doing");
    const roll = button("button small", "Würfeln", "Einen neuen Verlauf würfeln (N)");
    roll.addEventListener("click", () => app.diceThePiece());
    const smooth = button("button small", "Glätten", "Die Linie abrunden: steile Stufen werden sanfter");
    smooth.addEventListener("click", () => app.smoothThePiece());
    const top = button("button small", "Von vorn", "Das Stück beginnt wieder beim ersten Takt");
    top.id = "piece-top";
    top.addEventListener("click", () => app.seekPiece(0));
    doing.append(roll, smooth, top);

    const on = el("label", "check");
    parts.on.type = "checkbox";
    parts.on.id = "piece-on";
    parts.on.addEventListener("change", () => app.togglePiece());
    on.append(parts.on, el("span", "", "Nach dem Stück spielen"));

    const length = el("div", "group");
    const line = el("div", "line");
    const less = button("button icon small", "−", "Vier Takte kürzer");
    less.setAttribute("aria-label", "Vier Takte kürzer");
    less.addEventListener("click", () => app.resizeThePiece(barCount(app.project.piece) - 4));
    const more = button("button icon small", "+", "Vier Takte länger");
    more.setAttribute("aria-label", "Vier Takte länger");
    more.addEventListener("click", () => app.resizeThePiece(barCount(app.project.piece) + 4));
    const quick = el("span", "quick");
    for (const bars of [16, 32, 64, 128]) {
      const chip = button("chip tiny", String(bars), `${bars} Takte`);
      chip.addEventListener("click", () => app.resizeThePiece(bars));
      quick.append(chip);
    }
    line.append(el("span", "label", "Takte"), less, parts.bars, more, quick);
    length.append(line);

    const order = el("div", "group");
    order.append(el("h3", "", "Wer zuerst einsetzt"), parts.order);

    const hint = el("p", "easel-hint", "Mal die Spannung in den äußeren Ring: außen ist viel los, innen wenig. Die farbigen Linien zeigen, ab wo ein Ring mitspielt. Vor einem steilen Anstieg nimmt der Kreisel Anlauf. Am inneren Rand liegen die Szenen: links eine wählen, dann dort malen. Ein Rechtsklick auf einen Takt spielt ab dort, legt eine Szene hin oder ändert die Spannung.");

    const save = button("button small", "Als Opus speichern", "Das Stück einmal rundherum als Opus-Datei");
    save.addEventListener("click", () => void app.exportSound());

    this.pieceBox.append(head, parts.info, on, doing, length, order, hint, save);
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
      ["Menütaste", "das Menü für den Ring und den Schritt am Zeiger (auch Umschalt+F10)"],
      ["1 bis 7", "Ring wählen · mit Umschalt stumm"],
      [`${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")}`, "Werkzeug: Setzen, Betonen, Zufall, Wirbel, Länge (am Kick-Ring: Beben)"],
      [`${key("KeyA")} bis ${key("KeyK")}`, "den Ring von Hand spielen (acht Stufen)"],
      [key("KeyL"), "Einspielen: Gespieltes landet im Ring"],
      [`${key("KeyZ")} ${key("KeyX")} ${key("KeyC")} ${key("KeyV")} ${key("KeyB")} halten`, "Effekte: Dumpf, Dünn, Stotter, Echo, Pause · mit Umschalt rasten sie ein"],
      ["← →", "Zeiger auf dem Ring · mit Umschalt den Ring drehen"],
      ["↑ ↓", "Ring wechseln · mit Umschalt alles höher oder tiefer"],
      ["Eingabe", "am Zeiger setzen oder löschen"],
      ["+ −", "Ton am Zeiger höher oder tiefer"],
      [key("KeyN"), "Ring würfeln · mit Umschalt nur variieren"],
      ["Im Fenster der Stimme", "Eingabe singt die Zeile vor · ein Bindestrich trennt eine Silbe, wo du willst · Esc fertig"],
      ["An der Werkbank", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} Schlägel weich und hart, Zupfen, Streichen, Blasen · ${key("KeyN")} würfeln · Esc fertig`],
      ["Im Malkasten", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} Pinsel und Radierer · ${key("KeyT")} Dicke · ${key("KeyN")} würfeln · Entf nimmt den letzten Strich · Esc fertig`],
      [key("KeyM"), "Ring stumm · mit Umschalt allein hören"],
      [", .", "Szene zurück oder vor"],
      ["8", "den Stück-Ring wählen · dort: ← → Takt, + − Spannung, Eingabe spielt ab dem Takt"],
      ["9", `das Wetter wählen · dort: ${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} ${key("KeyY")} Nebel, Sonne, Wolken, Regen, Funken, Hagel · ${key("KeyN")} würfeln · Entf nimmt das gewählte Wetter weg`],
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
    const root = document.documentElement;
    root.style.setProperty("--focus", info.color);
    // For the motions that go with the music: whether it plays, and how long a beat is.
    root.dataset.playing = String(app.playing);
    root.style.setProperty("--beat", `${(60 / project.bpm).toFixed(3)}s`);
    // What belongs to the ring in focus only moves when it changes, not when another ring comes into focus.
    const sameRing = this.shownRing === selected;
    if (!sameRing && this.shownRing !== -1) {
      playMotion(this.head.querySelector(".dot"), "pop");
      playMotion(this.panel.name, "slide-in");
    }
    this.shownRing = selected;

    const play = byId("play");
    play.setAttribute("aria-pressed", String(app.playing));
    play.querySelector(".label")!.textContent = app.playing ? "Stopp" : "Start";
    this.moved(play.querySelector(".glyph"), app.playing, "pop");
    const bpm = byId<HTMLInputElement>("bpm");
    if (document.activeElement !== bpm) bpm.value = String(project.bpm);
    byId<HTMLSelectElement>("root").value = String(project.root);
    byId<HTMLSelectElement>("scale").value = project.scale;
    byId<HTMLButtonElement>("undo").disabled = !app.store.canUndo;
    byId<HTMLButtonElement>("redo").disabled = !app.store.canRedo;
    const chain = byId<HTMLInputElement>("chain");
    chain.checked = project.chain;
    // A piece lays the scenes out itself.
    chain.disabled = project.piece.on;
    byId<HTMLSelectElement>("repeats").disabled = project.piece.on;
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

    this.syncPiece();
    this.trackRows.forEach((row, track) => {
      const one = trackOf(project, track);
      row.classList.toggle("selected", track === selected && !app.pieceFocus && !app.weatherFocus);
      row.classList.toggle("silent", !app.audible(track));
      row.classList.toggle("solo", app.solo === track);
      row.querySelector(".sound")!.textContent = one.sound === VOICE_SOUND ? "Stimme" : one.sound === BODY_SOUND && one.body ? (BODY_NAMES[one.body.kind] ?? "") : (trackInfo(track).sounds[one.sound] ?? "Gemalt");
      row.querySelector(".pick")!.setAttribute("aria-pressed", String(track === selected && !app.pieceFocus && !app.weatherFocus));
      row.querySelector(".mute")!.setAttribute("aria-pressed", String(!app.audible(track)));
      this.moved(row.querySelector(".mute svg"), !app.audible(track), "pop");
    });

    const queued = app.engine.queuedScene;
    this.sceneButtons.forEach((node, index) => {
      const filled = project.scenes[index] !== null;
      node.classList.toggle("filled", filled);
      node.classList.toggle("current", index === project.scene);
      node.classList.toggle("queued", index === queued && index !== project.scene);
      node.setAttribute("aria-pressed", String(index === project.scene));
      this.moved(node, index === project.scene, "pop", "true");
      node.title = filled ? `Szene ${SCENE_NAMES[index]} · mit Umschalt leeren` : `Leer: Klick macht eine Kopie von Szene ${SCENE_NAMES[project.scene]}`;
    });

    for (const [tool, node] of this.toolButtons) {
      node.setAttribute("aria-checked", String(tool === app.tool));
      this.moved(node.querySelector("svg"), tool === app.tool, "wiggle", "true");
      node.disabled = tool === "laenge" && !info.melodic && selected !== 0;
    }
    // A drum has no notes to hold: on the kick's ring that tool paints the Nachbeben instead.
    const hold = this.toolButtons.get("laenge");
    if (hold && hold.dataset.shake !== String(selected === 0)) {
      hold.dataset.shake = String(selected === 0);
      hold.querySelector(".name")!.textContent = selected === 0 ? "Beben" : "Länge";
      hold.querySelector("path")?.setAttribute("d", selected === 0 ? "M2 12h3l2-7 3 14 3-10 2 6 1.5-3H22" : "M4 12h16M4 8v8M20 8v8");
      hold.title = selected === 0 ? "Am Kick-Ring entlang ziehen malt das Nachbeben: außen stark, innen nichts; die rechte Taste radiert" : "Am Ring entlang ziehen hält den Ton länger";
    }
    this.quake.hidden = selected !== 0;
    this.syncEasel();
    byId("live").setAttribute("aria-pressed", String(app.live));
    for (const [fx, node] of this.fxButtons) {
      node.classList.toggle("held", app.engine.fx[fx]);
      node.classList.toggle("latched", app.latched.has(fx));
      node.setAttribute("aria-pressed", String(app.latched.has(fx)));
    }

    const parts = this.panel;
    byId("panel").style.setProperty("--c", info.color);
    parts.name.textContent = info.name;
    parts.info.textContent = describe(pattern);
    this.soundButtons.forEach((chip, sound) => {
      chip.textContent = info.sounds[sound] ?? "";
      chip.setAttribute("aria-pressed", String(sound === settings.sound));
      this.moved(chip, sound === settings.sound, "pop", "true", !sameRing);
    });
    parts.puck.style.left = `${settings.x * 100}%`;
    parts.puck.style.bottom = `${settings.y * 100}%`;
    const sings = settings.sound === VOICE_SOUND;
    parts.axisX.textContent = sings ? "" : `${info.xLabel} →`;
    parts.axisY.textContent = sings ? "" : `${info.yLabel} ↑`;
    this.vowels.hidden = !sings;
    parts.pad.title = sings ? "Das Vokalfeld: Der Punkt zieht alle Vokale zu sich, am Rand ganz, in der Mitte gar nicht" : "";
    parts.pad.setAttribute("aria-label", `Klangfeld: ${info.xLabel} ${Math.round(settings.x * 100)} %, ${info.yLabel} ${Math.round(settings.y * 100)} %. Pfeiltasten verändern.`);
    parts.steps.textContent = String(pattern.len);
    this.moved(parts.steps, pattern.len, "tick", undefined, !sameRing);
    const hits = activeSteps(pattern).length;
    parts.spread.max = String(pattern.len);
    if (document.activeElement !== parts.spread || Number(parts.spread.value) !== hits) parts.spread.value = String(hits);
    parts.spreadValue.textContent = String(hits);
    this.moved(parts.spreadValue, hits, "tick", undefined, !sameRing);
    for (const node of byId("panel").querySelectorAll<HTMLButtonElement>(".line .button")) {
      if (node.textContent === "−") node.disabled = pattern.len <= MIN_STEPS;
      if (node.textContent === "+") node.disabled = pattern.len >= MAX_STEPS;
    }

    this.syncRelay();
    byId("status").textContent = app.weatherFocus
      ? `Wetter: ${describeWeather(currentScene(project))}`
      : app.pieceFocus
      ? `Stück: ${describePiece(project.piece, project.bpm)}${project.piece.on ? "" : " (aus)"}`
      : app.veiled(selected) ? `${info.name}: verdeckt (Stille Post)`
      : app.easel ? `Klangmalerei ${info.name}: ${describeBild(settings.bild)}`
      : app.bench ? `Klangkörper ${info.name}: ${describeBody(settings.body)}`
      : app.booth ? `Stimme ${info.name}: ${describeVoice(settings.voice)}`
      : `${info.name}: ${describe(pattern)}${selected === 0 && hasRumble(currentScene(project), pattern.len) ? ` · ${describeRumble(currentScene(project), pattern)}` : ""}`;
    this.syncBooth();
    this.syncWeather();
    this.syncChordMenu();
    this.syncToast();
    this.ring.invalidate();
    this.easel.invalidate();
    this.bench.invalidate();
    this.mouth.invalidate(info.color);
  }

  /** The piece in the list of rings and in its panel. */
  private syncPiece(): void {
    const app = this.app;
    const piece = app.project.piece;
    const count = barCount(piece);
    this.pieceRow.classList.toggle("selected", app.pieceFocus);
    this.pieceRow.classList.toggle("silent", !piece.on);
    this.pieceRow.querySelector(".sound")!.textContent = `${count} Takte`;
    this.pieceRow.querySelector(".pick")!.setAttribute("aria-pressed", String(app.pieceFocus));
    const toggle = this.pieceRow.querySelector<HTMLButtonElement>(".piece-toggle")!;
    toggle.textContent = piece.on ? "an" : "aus";
    toggle.setAttribute("aria-pressed", String(piece.on));
    toggle.setAttribute("aria-label", piece.on ? "Das Stück spielt: ausschalten" : "Nach dem Stück spielen");

    this.ringBox.hidden = app.pieceFocus;
    this.pieceBox.hidden = !app.pieceFocus;
    // The piece is painted on the wheel: where the list sits below it, bring the wheel into view.
    if (app.pieceFocus && !this.pieceFocused) byId("stage").scrollIntoView({ block: "nearest" });
    this.pieceFocused = app.pieceFocus;
    if (!app.pieceFocus) return;
    const parts = this.pieceParts;
    parts.info.textContent = describePiece(piece, app.project.bpm);
    parts.on.checked = piece.on;
    parts.bars.textContent = String(count);
    for (const node of this.pieceBox.querySelectorAll<HTMLButtonElement>(".line .button")) {
      if (node.textContent === "−") node.disabled = count <= MIN_BARS;
      if (node.textContent === "+") node.disabled = count >= MAX_BARS;
    }
    const signature = piece.order.join("");
    if (signature !== this.orderSignature) {
      this.orderSignature = signature;
      parts.order.replaceChildren(...piece.order.map((ring, place) => {
        const info = trackInfo(ring);
        const item = el("li", "entry");
        item.style.setProperty("--c", info.color);
        const earlier = button("button icon small", "↑", `${info.name} früher einsetzen lassen`);
        earlier.setAttribute("aria-label", `${info.name} früher einsetzen lassen`);
        earlier.disabled = place === 0;
        earlier.addEventListener("click", () => app.moveEntry(ring, -1));
        const later = button("button icon small", "↓", `${info.name} später einsetzen lassen`);
        later.setAttribute("aria-label", `${info.name} später einsetzen lassen`);
        later.disabled = place === piece.order.length - 1;
        later.addEventListener("click", () => app.moveEntry(ring, 1));
        item.append(el("span", "dot"), el("span", "name", info.name), earlier, later);
        return item;
      }));
    }
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

    this.syncBench();
    const open = app.easel;
    byId("easel").hidden = !open;
    byId("brushes").hidden = !open;
    byId("tools").hidden = open || app.bench || app.weatherFocus;
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

  /** The ring's voice in the panel, and its window. */
  private syncBooth(): void {
    const app = this.app;
    const track = app.selected;
    const info = trackInfo(track);
    const settings = trackOf(app.project, track);
    const voice = settings.voice;
    // A voice that is gone (taken back) has no window.
    if (app.booth && !voice) app.closeBooth();

    this.sung.pick.setAttribute("aria-pressed", String(settings.sound === VOICE_SOUND));
    this.sung.pick.title = voice ? "Die Stimme dieses Rings spielen (noch ein Klick öffnet ihr Fenster)" : "Diesem Ring eine Stimme geben: Er singt eine Zeile Text";
    this.sung.label.textContent = voice ? (voice.text.trim() ? `Stimme: ${voice.text.trim()}` : "Stimme: nur Vokal") : "Stimme geben";

    const open = app.booth && voice !== null;
    byId("booth").hidden = !open;
    if (open && !this.boothOpen) {
      this.closeCoach();
      byId("stage").scrollIntoView({ block: "nearest" });
      // With a keyboard at hand the line is ready to be typed over (a phone's keyboard would only be in the way).
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        const field = byId<HTMLInputElement>("voice-text");
        field.value = voice?.text ?? "";
        field.focus({ preventScroll: true });
        field.select();
      }
    }
    this.boothOpen = open;
    if (!open || !voice) return;
    byId("booth").style.setProperty("--c", info.color);
    byId("booth-title").textContent = `Stimme: ${info.name}`;
    const text = byId<HTMLInputElement>("voice-text");
    // What is being typed is left alone (the line is kept as typed, a trailing space included).
    if (document.activeElement !== text || text.value.trimStart() !== voice.text) text.value = voice.text;
    const cut = syllables(voice.text);
    const signature = cut.map((syllable) => `${syllable.first ? " " : "·"}${syllable.text}`).join("");
    const holder = byId("voice-syllables");
    if (signature !== this.syllableSignature) {
      this.syllableSignature = signature;
      this.litSyllable = -1;
      holder.replaceChildren(...(cut.length > 0
        ? cut.map((syllable, index) => {
            const chip = button(`syllable${syllable.first && index > 0 ? " word" : ""}`, syllable.text, "Diese Silbe singen");
            chip.addEventListener("click", () => void app.engine.audition(app.selected, { on: true, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 2 }, app.chordNow(), index));
            return chip;
          })
        : [el("span", "shelf-label empty", "Ohne Text singt der Ring den Vokal, auf dem der Punkt im Klangfeld steht.")]));
    }
    this.lightSyllable();
  }

  /** The syllable that is being sung lights up (looked at on every frame while the window is open). */
  private lightSyllable(): void {
    const app = this.app;
    if (!app.booth) return;
    const track = app.selected;
    const chips = byId("voice-syllables").querySelectorAll(".syllable");
    const since = app.sinceStruck(track);
    const sounding = since > -0.02 && since < 0.3 && chips.length > 0 ? (((app.engine.sung[track] ?? 0) % chips.length) + chips.length) % chips.length : -1;
    if (sounding === this.litSyllable) return;
    this.litSyllable = sounding;
    chips.forEach((chip, index) => chip.classList.toggle("sung", index === sounding));
  }

  /** The weather in the list of rings, its brushes and its panel. */
  private syncWeather(): void {
    const app = this.app;
    const scene = currentScene(app.project);
    const focus = app.weatherFocus;
    const kinds = WEATHER_NAMES.filter((_, kind) => hasWeather(scene, kind));
    this.weatherRow.classList.toggle("selected", focus);
    this.weatherRow.classList.toggle("silent", kinds.length === 0);
    this.weatherRow.querySelector(".pick")!.setAttribute("aria-pressed", String(focus));
    this.weatherRow.querySelector(".sound")!.textContent = kinds.length === 0 ? "klar" : kinds.length <= 2 ? kinds.join(", ") : `${kinds.length} Wetter`;
    byId("weathers").hidden = !focus;
    this.weatherBox.hidden = !focus;
    if (focus) {
      // The weather has the panel to itself.
      this.ringBox.hidden = true;
      this.pieceBox.hidden = true;
      this.veilBox.hidden = true;
      // It is painted on the wheel: where the list sits below it, bring the wheel into view.
      if (!this.weatherFocused) {
        this.closeCoach();
        byId("stage").scrollIntoView({ block: "nearest" });
      }
    }
    this.weatherFocused = focus;
    if (!focus) return;
    this.sky.info.textContent = describeWeather(scene);
    this.sky.clear.disabled = kinds.length === 0;
    this.cloudButtons.forEach((node, kind) => node.setAttribute("aria-checked", String(kind === app.cloud)));
    this.windInputs.forEach((input, kind) => {
      const wind = scene.wind[kind] ?? 0;
      const index = WINDS.indexOf(wind as (typeof WINDS)[number]);
      if (document.activeElement !== input || index >= 0) input.value = String(index >= 0 ? index : WINDS.findIndex((value) => value >= wind));
      this.windNames[kind]!.textContent = windName(wind);
    });
  }

  /** The ring's body in the panel, and the workbench. */
  private syncBench(): void {
    const app = this.app;
    const track = app.selected;
    const info = trackInfo(track);
    const settings = trackOf(app.project, track);
    const body = settings.body;
    // A body that is gone (taken back) has no bench to stand on.
    if (app.bench && !body) app.closeBench();

    this.built.pick.setAttribute("aria-pressed", String(settings.sound === BODY_SOUND));
    this.built.pick.title = body ? "Den Klangkörper dieses Rings spielen (noch ein Klick öffnet die Werkbank)" : "Einen Klangkörper für diesen Ring bauen";
    this.built.label.textContent = body ? `Klangkörper: ${BODY_NAMES[body.kind]}` : "Klangkörper bauen";
    const signature = `${track}|${body ? `${body.kind}.${body.material}.${body.tight}.${body.exciter}.${body.where}` : ""}`;
    if (signature !== this.builtSignature) {
      this.builtSignature = signature;
      renderBodyThumb(this.built.thumb, body, info.color);
    }

    const open = app.bench && body !== null;
    byId("bench").hidden = !open;
    byId("mallets").hidden = !open;
    if (open && !this.benchOpen) {
      this.closeCoach();
      byId("stage").scrollIntoView({ block: "nearest" });
    }
    this.benchOpen = open;
    if (!open || !body) return;
    byId("bench").style.setProperty("--c", info.color);
    byId("bench-title").textContent = `Klangkörper: ${info.name}`;
    this.malletButtons.forEach((node, index) => node.setAttribute("aria-checked", String(index === body.exciter)));
    this.kindButtons.forEach((node, kind) => node.setAttribute("aria-pressed", String(kind === body.kind)));
    this.shape.tightName.textContent = TIGHT_NAMES[body.kind] ?? "Spannung";
    this.shape.materialName.textContent = `Material: ${materialName(body.material)}`;
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
      node.replaceChildren(el("span", "", `Opus wird gerechnet … ${Math.round(app.exporting * 100)} %`));
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
