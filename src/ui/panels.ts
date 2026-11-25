import { FX, TOOLS, type App, type ContextTarget, type Deed, type Tool } from "../app/app";
import type { FxName } from "../audio/engine";
import { describeBild } from "../bild";
import { describeBody } from "../body";
import { describeRumble, hasRumble } from "../rumble";
import { describeVoice, FIELD_LETTERS } from "../voice";
import { describeWeather } from "../weather";
import { ACID_SOUND, BAR, clamp, currentScene, SAMPLE_SOUND, VOICE_SOUND, MAX_STEPS, MIN_STEPS, patternOf, TRACK_COUNT, trackInfo, trackOf, type ScaleId } from "../model";
import { NOTE_NAMES, SCALE_IDS, SCALES } from "../music";
import { activeSteps, behindKick, describe, meeting } from "../patterns";
import { describePiece } from "../piece";
import type { BenchView } from "./bench";
import type { BoothView } from "./booth";
import type { EaselView } from "./easel";
import type { BarMenu } from "./bar-menus";
import { onContext } from "./menu";
import type { RingView } from "./ring";
import { flash, playMotion, type Motion } from "./answers";
import { button, byId, capture, el, iconButton } from "./dom";
import { FX_CODES, PLAY_CODES, TOOL_CODES, WEATHER_CODES } from "./keymap";
import { RelayDialog } from "./relay-dialog";
import { GuideCard } from "./guide-card";
import { HelpDialog } from "./help";
import { ChordMenu } from "./chord-menu";
import { ToastView } from "./toast";
import { PiecePanel } from "./piece-panel";
import { AcidPanel } from "./acid-panel";
import { PedalBoard } from "./pedal-board";
import { SampleBoard } from "./sample-board";
import { WeatherPanel } from "./weather-panel";
import { EaselWindow } from "./easel-window";
import { BoothWindow } from "./booth-window";
import { BenchWindow } from "./bench-window";
import { SoundPalette, soundLabel } from "./sound-palette";
import { describeSample, SLICES } from "../sample";
import { RowBand } from "./row-band";
import { ScenesBox } from "./scenes-box";

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

/** A labelled slider that edits with `change` and shows `read`. */
/** What stands on the keys that have no letter in their code, on a keyboard laid out the American way. */
const OTHER_KEYS: Record<string, string> = { IntlBackslash: "<", Semicolon: ";", Quote: "'", BracketLeft: "[" };

interface Slider {
  input: HTMLInputElement;
  read(): number;
  /** The value in words, for whoever has it read out; without it, a percentage. */
  say?: ((value: number) => string) | undefined;
}

export class Panels {
  /** What stands on each key on this keyboard (QWERTZ until the browser says otherwise). */
  private labels = new Map<string, string>([["KeyZ", "Y"], ["KeyY", "Z"], ["IntlBackslash", "<"], ["Semicolon", "Ö"], ["Quote", "Ä"], ["BracketLeft", "Ü"]]);
  private readonly sliders: Slider[] = [];
  /** Opens the menu that hangs under one of the bar's buttons (set by whoever holds the menu). */
  onBarMenu: (opener: HTMLElement, which: BarMenu, byKeyboard: boolean) => void = () => undefined;
  /** A button of a panel opens one of the wheel's menus under itself. */
  onMenuUnder: (opener: HTMLElement, target: ContextTarget, byKeyboard: boolean) => void = () => undefined;
  readonly trackRows: HTMLLIElement[] = [];
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly fxButtons = new Map<FxName, HTMLButtonElement>();
  readonly own = { pick: button("own-pick", ""), thumb: el("canvas", "thumb"), label: el("span", "own-label") };
  readonly built = { pick: button("own-pick", ""), thumb: el("canvas", "thumb"), label: el("span", "own-label") };
  private readonly quake = el("div", "group quake");
  readonly sung = { pick: button("own-pick", ""), label: el("span", "own-label") };
  private readonly vowels = el("span", "vowels");
  readonly weatherRow = el("li", "track weather-row");
  readonly ringBox = el("div", "panel-box panel-ring");
  readonly pieceBox = el("div", "panel-box panel-piece");
  readonly pieceRow = el("li", "track piece-row");
  readonly veilBox = el("div", "panel-box panel-veil");
  private shownStage = false;
  private readonly panel = { name: el("h2"), info: el("p", "info"), pad: el("div", "pad"), puck: el("span", "puck"), axisX: el("span", "axis x"), axisY: el("span", "axis y"), steps: el("output"), spread: el("input"), spreadValue: el("output") };
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private lastPreview = 0;
  // ---- motion: what each node showed last, so that it moves when that changes (and not when the page is built) ----
  private readonly seen = new WeakMap<Element, string>();
  private shownRing = -1;
  private readonly lamps: boolean[] = [];
  /** The row of the ring's Zerre. The kick's ring has none: what makes a kick hard is its own. */
  private driveRow: HTMLElement | null = null;
  private readonly doing = { roll: button("button small", "Dice", "A new idea for this ring (N)"), vary: button("button small", "Vary", "Change it only a little (Shift+N)"), wipe: button("button small", "Clear", "Remove all hits of this ring (Shift+Del)") };
  private readonly head = el("header", "panel-head");

  // ---- the parts of the page that have a file of their own ----
  private readonly relayDialog: RelayDialog;
  private readonly guideCard: GuideCard;
  private readonly help: HelpDialog;
  private readonly chordMenu: ChordMenu;
  private readonly toast: ToastView;
  private readonly piecePanel: PiecePanel;
  private readonly weatherPanel: WeatherPanel;
  private readonly acidPanel: AcidPanel;
  private readonly pedalBoard: PedalBoard;
  private readonly sampleBoard: SampleBoard;
  /** The ring's Zerre and the button to its pedals, side by side. */
  private readonly driving = el("div", "lines driving");
  private readonly easelWindow: EaselWindow;
  private readonly boothWindow: BoothWindow;
  private readonly benchWindow: BenchWindow;
  private readonly palette: SoundPalette;
  private readonly rowBand: RowBand;
  private readonly scenesBox: ScenesBox;

  constructor(private readonly app: App, private readonly ring: RingView, private readonly easel: EaselView, private readonly bench: BenchView, private readonly mouth: BoothView) {
    this.relayDialog = new RelayDialog(this, app);
    this.guideCard = new GuideCard(this, app, () => ring.cheer(), () => ring.pointAgain());
    this.help = new HelpDialog(this);
    this.chordMenu = new ChordMenu(app, ring);
    this.toast = new ToastView(app);
    this.piecePanel = new PiecePanel(this, app);
    this.weatherPanel = new WeatherPanel(this, app);
    this.acidPanel = new AcidPanel(this, app);
    this.pedalBoard = new PedalBoard(this, app);
    this.sampleBoard = new SampleBoard(this, app);
    this.easelWindow = new EaselWindow(this, app, easel);
    this.boothWindow = new BoothWindow(this, app, mouth);
    this.benchWindow = new BenchWindow(this, app, bench);
    this.palette = new SoundPalette(app);
    this.rowBand = new RowBand(app);
    this.scenesBox = new ScenesBox(app, this.rowBand);
    this.buildBar();
    this.buildTracks();
    this.rowBand.build();
    this.scenesBox.build();
    this.buildTools();
    this.easelWindow.build();
    this.benchWindow.build();
    this.boothWindow.build();
    this.weatherPanel.build();
    this.buildFx();
    this.buildPanel();
    this.palette.build();
    this.piecePanel.build();
    this.relayDialog.build();
    this.guideCard.build();
    this.buildStage();
    this.help.build();
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
    this.boothWindow.lightSyllable();
  }

  /** While the piece plays, the status line counts the bars to its next drop. */
  private ahead(): string {
    const bars = this.app.piece.dropAhead();
    return bars === null ? "" : ` · Drop in ${bars === 1 ? "1 bar" : `${bars} bars`}`;
  }

  /**
   * What the status line says of the pull between the rings. For the kick, the anchor of them all: after how many
   * bars rings of unequal length are together again. For any other ring: how far it lies behind the kick, and, where
   * its length does not go with the kick's, after how many bars the two meet again.
   */
  private pull(selected: number): string {
    const project = this.app.project;
    const patterns = currentScene(project).patterns;
    const kick = patterns[0];
    const own = patterns[selected];
    const count = (steps: number | null): string | null => {
      if (steps === null) return null;
      const bars = steps / BAR;
      return `${Number.isInteger(bars) ? bars : bars.toFixed(1).replace(".", ",")} bars`;
    };
    const lined = project.align ? ", realigned every 8" : "";
    if (selected === 0 || !kick || !own) {
      const all = count(meeting(patterns));
      return all === null ? "" : ` · all rings meet every ${all}${lined}`;
    }
    const behind = behindKick(kick, own);
    const meets = count(meeting([kick, own]));
    return `${behind === null ? "" : behind === 0 ? " · with the kick" : ` · ${behind} ${behind === 1 ? "step" : "steps"} behind the kick`}${meets === null ? "" : ` · meets the kick again every ${meets}${lined}`}`;
  }

  keyLabel(code: string): string {
    // The key between Shift and Y has no letter in its code: it carries "<" on most keyboards that have it.
    return this.labels.get(code) ?? OTHER_KEYS[code] ?? code.replace(/^Key|^Digit/, "");
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
    for (const nodes of [this.easelWindow.brushButtons, this.benchWindow.malletButtons, this.weatherPanel.cloudButtons, this.piecePanel.toolButtons]) {
      nodes.forEach((node, index) => {
        const key = node.querySelector(".key");
        if (key) key.textContent = this.keyLabel(WEATHER_CODES[index] ?? "");
      });
    }
    this.help.build();
  }

  // ---- building ---------------------------------------------------------------

  /** A slider from nothing to all of it. `say` gives its value in words to whoever has it read out (a percentage without it). */
  slider(input: HTMLInputElement, read: () => number, write: (value: number) => void, reset?: () => void, say?: (value: number) => string): void {
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
      input.title = input.title ? `${input.title} · right click resets` : "Right click resets";
    }
    this.sliders.push({ input, read, say });
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

    const root = byId<HTMLSelectElement>("root");
    NOTE_NAMES.forEach((name, index) => root.append(new Option(name, String(index))));
    root.addEventListener("change", () => app.setGlobal({ root: Number(root.value) }));
    const scale = byId<HTMLSelectElement>("scale");
    for (const id of SCALE_IDS) scale.append(new Option(SCALES[id].name, id));
    scale.addEventListener("change", () => app.setGlobal({ scale: scale.value as ScaleId }));

    byId("undo").addEventListener("click", () => app.undo());
    byId("redo").addEventListener("click", () => app.redo());
    byId("record").addEventListener("click", () => void app.files.toggleRecording());
    byId("dice-all").addEventListener("click", () => app.rings.diceAll());

    // Each of these buttons opens the menu for what it is about; on a phone the three dots hold all of them.
    const menus: readonly (readonly [string, BarMenu])[] = [["kreisel-menu", "kreisel"], ["sound", "klang"], ["share", "teilen"], ["record-more", "aufnahme"], ["help-open", "hilfe"], ["more", "alles"]];
    for (const [id, which] of menus) {
      const opener = byId(id);
      // A click without a pointer came from the keyboard: then the keyboard goes into the menu.
      opener.addEventListener("click", (event) => this.onBarMenu(opener, which, event.detail === 0));
    }

  }

  showHelp(): void {
    this.help.show();
  }

  /** The guide was asked for: its list of lessons comes up. */
  startTour(): void {
    this.app.guide.open();
  }

  /** The piece written down phrase by phrase, in a window of its own. */
  showProtocol(): void {
    const dialog = byId<HTMLDialogElement>("protokoll");
    byId("protokoll-lines").replaceChildren(...this.app.piece.protocol().map((line) => el("li", "", line)));
    // The window lies over the page's messages: the button itself says how copying went.
    const copy = byId<HTMLButtonElement>("protokoll-copy");
    copy.textContent = "Copy as text";
    copy.onclick = () => void this.app.piece.copyProtocol().then((copied) => { copy.textContent = copied ? "Copied" : "The browser does not release the clipboard"; });
    if (!dialog.open) dialog.showModal();
  }

  showRelay(): void {
    this.relayDialog.show();
  }

  /** Puts the guide away if it is up, and says whether it was. */
  endTour(): boolean {
    return this.guideCard.end();
  }

  private buildTracks(): void {
    const list = byId("tracks");
    // The weather lies over all the rings: it comes before them.
    const sky = this.weatherRow;
    const choose = button("pick", "", "Pick the weather: paint effects onto the wheel (key 9)");
    choose.append(el("span", "dot"), el("span", "name", "Weather"), el("span", "sound"));
    choose.addEventListener("click", () => this.app.weather.focus());
    const throwIt = iconButton("roll", ICONS.dice, "Dice the weather", "Dice a new weather");
    throwIt.addEventListener("click", () => this.app.weather.dice());
    sky.append(choose, throwIt);
    onContext(sky, (x, y, byKeyboard) => this.app.openContext({ kind: "weather" }, x, y, byKeyboard));
    list.append(sky);
    // The piece is the outermost ring: it comes first.
    const row = this.pieceRow;
    const pick = button("pick", "", "Pick the piece's ring (key 8)");
    pick.append(el("span", "dot"), el("span", "name", "Piece"), el("span", "sound"));
    pick.addEventListener("click", () => this.app.piece.focus());
    const toggle = button("piece-toggle", "", "Play by the piece, or only the scene in a circle");
    toggle.addEventListener("click", () => this.app.piece.toggle());
    const roll = iconButton("roll", ICONS.dice, "Dice the piece", "Dice a new course");
    roll.addEventListener("click", () => this.app.piece.dice());
    row.append(pick, toggle, roll);
    onContext(row, (x, y, byKeyboard) => this.app.openContext({ kind: "piece", bar: null }, x, y, byKeyboard));
    list.append(row);
    for (let track = TRACK_COUNT - 1; track >= 0; track -= 1) {
      // The list runs like the rings: the outermost on top.
      const info = trackInfo(track);
      const row = el("li", "track");
      row.dataset.track = String(track);
      row.style.setProperty("--c", info.color);
      const pick = button("pick", "", `Pick ${info.name} (key ${track + 1})`);
      pick.append(el("span", "dot"), el("span", "name", info.name), el("span", "sound"));
      pick.addEventListener("click", () => this.app.select(track));
      const mute = iconButton("mute", ICONS.mute, `Mute ${info.name}`, "Mute (M) · with Shift: hear only this ring");
      mute.addEventListener("click", (event) => {
        if (event.shiftKey) this.app.rings.toggleSolo(track);
        else this.app.rings.toggleMute(track);
      });
      const roll = iconButton("roll", ICONS.dice, `Dice ${info.name}`, "Dice anew (N)");
      roll.addEventListener("click", () => this.app.rings.dice(track));
      row.append(pick, mute, roll);
      onContext(row, (x, y, byKeyboard) => {
        this.app.select(track);
        this.app.openContext({ kind: "ring", track, step: null }, x, y, byKeyboard);
      });
      list.append(row);
      this.trackRows[track] = row;
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
    const live = button("tool live", "", "Write what you play on A to K into the ring while the Kreisel runs");
    live.id = "live";
    live.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5" class="fill"/></svg>';
    live.append(el("span", "name", "Play in"), el("kbd", "key", "L"));
    live.addEventListener("click", () => this.app.rings.toggleLive());
    holder.append(live);
  }

  private buildFx(): void {
    const holder = byId("fx");
    for (const fx of FX) {
      const pad = button("pad-fx", "", `${fx.hint} (hold · right click or Shift latches)`);
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
      // A click that no pointer and no key of ours made comes from a screen reader, a switch or a voice command: nobody can hold with those, so it latches.
      let keyed = false;
      pad.addEventListener("click", (event) => {
        if (event.detail === 0 && !keyed) this.app.latchFx(fx.id);
      });
      pad.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        keyed = true;
        if (event.repeat) return;
        // With Shift the effect latches, as it does under its own key: nobody has to hold a key down. Any press on a latched one lets it go again.
        if (event.shiftKey || this.app.latched.has(fx.id)) this.app.latchFx(fx.id);
        else this.app.setFx(fx.id, true);
      });
      pad.addEventListener("keyup", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        release();
        // The space bar's own click comes with this key going up: it is still ours.
        setTimeout(() => { keyed = false; }, 0);
      });
      pad.addEventListener("blur", () => {
        keyed = false;
        release();
      });
      holder.append(pad);
      this.fxButtons.set(fx.id, pad);
    }
  }

  /** The panel of the ring in focus, and the cloth over a ring that someone else has built (Stille Post). */
  private buildPanel(): void {
    this.head.append(el("span", "dot"), this.panel.name);
    this.ringBox.append(this.head, this.panel.info, this.buildDoing(), this.palette.buildRow(), ...this.buildOwnSounds(), this.sampleBoard.buildRow(), this.buildPad(), this.acidPanel.build(), this.buildSteps(), this.buildQuake(), this.buildMix());
    this.veilBox.append(
      el("header", "panel-head"),
      el("p", "veil-text", "Telephone: this ring is covered. Someone has already built here, but you hear and see only the ring of the person before you. Add your own: take a ring that is still empty. When everyone is done, you reveal it in the pass-around window."),
    );
    this.veilBox.querySelector("header")!.append(el("span", "dot"), el("h2"));
    byId("panel").append(this.ringBox, this.pedalBoard.build(), this.sampleBoard.build(), this.pieceBox, this.veilBox);
  }

  /** What can be done to the ring's whole pattern: dice, a small change, all away. */
  private buildDoing(): HTMLElement {
    const app = this.app;
    const doing = el("div", "doing");
    const { roll, vary, wipe } = this.doing;
    roll.addEventListener("click", () => app.rings.dice(app.selected));
    vary.addEventListener("click", () => app.rings.vary(app.selected));
    wipe.addEventListener("click", () => app.rings.clear(app.selected));
    doing.append(roll, vary, wipe);
    return doing;
  }

  /** The three sounds a ring can have of its own: a painted one, a body, a voice. Each row picks it, and its button opens the window where it is made. */
  private buildOwnSounds(): HTMLElement[] {
    const app = this.app;
    const own = el("div", "own");
    this.own.pick.id = "own-pick";
    this.own.pick.append(this.own.thumb, this.own.label);
    this.own.pick.addEventListener("click", () => app.paint.use());
    const paint = button("button small", "Paint", "Paint this ring's own sound");
    paint.id = "paint";
    paint.addEventListener("click", () => app.paint.open());
    own.append(this.own.pick, paint);

    // And its own body: a thing that rings, built on the workbench.
    const built = el("div", "own");
    this.built.pick.id = "built-pick";
    this.built.pick.append(this.built.thumb, this.built.label);
    this.built.pick.addEventListener("click", () => app.body.use());
    const build = button("button small", "Build", "Build this ring's body");
    build.id = "build";
    build.addEventListener("click", () => app.body.open());
    built.append(this.built.pick, build);

    // And its own voice: a line of text, sung a syllable a hit.
    const sung = el("div", "own");
    const lips = el("span", "thumb lips");
    this.sung.pick.id = "voice-pick";
    this.sung.pick.append(lips, this.sung.label);
    this.sung.pick.addEventListener("click", () => app.voice.use());
    const write = button("button small", "Text", "Write the line this ring sings");
    write.id = "voice-edit";
    write.addEventListener("click", () => app.voice.open());
    sung.append(this.sung.pick, write);
    return [own, built, sung];
  }

  /** The sound pad: a point to drag, and for a voice the field of the vowels. */
  private buildPad(): HTMLElement {
    const app = this.app;
    const parts = this.panel;
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
      app.rings.setTrack(app.selected, { x: clamp((event.clientX - box.left) / box.width, 0, 1), y: clamp(1 - (event.clientY - box.top) / box.height, 0, 1) }, "pad");
      if (performance.now() - this.lastPreview > 170) {
        this.lastPreview = performance.now();
        app.rings.preview(app.selected);
      }
    };
    pad.addEventListener("pointerdown", (event) => {
      app.wake();
      if (event.button === 2) {
        // The right button puts the sound back where a fresh Kreisel has it.
        app.rings.resetPad(app.selected);
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
      app.rings.setTrack(app.selected, { x: clamp(track.x + delta[0], 0, 1), y: clamp(track.y + delta[1], 0, 1) }, "pad");
      app.rings.preview(app.selected);
    });
    return pad;
  }

  /** How long the ring is, turning it, and spreading hits evenly over it. */
  private buildSteps(): HTMLElement {
    const app = this.app;
    const parts = this.panel;
    const ringGroup = el("div", "group");
    const steps = el("div", "line");
    const less = button("button icon small", "−", "One step shorter");
    less.setAttribute("aria-label", "One step shorter");
    less.addEventListener("click", () => app.rings.resize(app.selected, patternOf(app.project, app.selected).len - 1));
    const more = button("button icon small", "+", "One step longer");
    more.setAttribute("aria-label", "One step longer");
    more.addEventListener("click", () => app.rings.resize(app.selected, patternOf(app.project, app.selected).len + 1));
    const quick = el("span", "quick");
    for (const length of [8, 12, 16, 32]) {
      const chip = button("chip tiny", String(length), `${length} steps`);
      chip.addEventListener("click", () => app.rings.resize(app.selected, length));
      quick.append(chip);
    }
    steps.append(el("span", "label", "steps"), less, parts.steps, more, quick);

    const turn = el("div", "line");
    const turnLeft = iconButton("button icon small", ICONS.left, "Rotate one step back", "Rotate back (Shift+←)");
    turnLeft.addEventListener("click", () => app.rings.rotate(app.selected, -1));
    const turnRight = iconButton("button icon small", ICONS.right, "Rotate one step on", "Rotate on (Shift+→ or the mouse wheel over the ring)");
    turnRight.addEventListener("click", () => app.rings.rotate(app.selected, 1));
    turn.append(el("span", "label", "Rotate"), turnLeft, turnRight);

    const spread = el("label", "line");
    parts.spread.type = "range";
    parts.spread.min = "0";
    parts.spread.step = "1";
    parts.spread.title = "Spread this many hits evenly over the ring";
    parts.spread.addEventListener("input", () => app.rings.spread(app.selected, Number(parts.spread.value)));
    parts.spread.addEventListener("change", () => app.store.settle());
    spread.append(el("span", "label", "Spread"), parts.spread, parts.spreadValue);
    ringGroup.append(steps, turn, spread);
    return ringGroup;
  }

  /** The kick's ring has its Nachbeben: painted into the ring, with a character of its own. */
  private buildQuake(): HTMLElement {
    const app = this.app;
    const quake = this.quake;
    const shaking = el("div", "line");
    const paintIt = button("button small", "Paint", "Paint the rumble into the kick's ring: outside it shakes hard, inside not at all (tool Rumble)");
    paintIt.id = "rumble-paint";
    paintIt.addEventListener("click", () => app.rumble.pickUpBrush());
    const throwIt = button("button small", "Dice", "Lay one of the usual shapes around the kicks: offbeat, rolling, tail");
    throwIt.id = "rumble-dice";
    throwIt.addEventListener("click", () => app.rumble.dice());
    const still = button("button small", "Off", "Take the rumble away");
    still.id = "rumble-off";
    still.addEventListener("click", () => app.rumble.shape(-1));
    shaking.append(el("span", "label", "Rumble"), paintIt, throwIt, still);
    const character = el("div", "line pair");
    const characterSlider = (label: string, field: "dirt" | "roll", title: string): void => {
      const half = el("label", "half");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.id = `rumble-${field}`;
      input.title = title;
      this.slider(input, () => app.project[field], (value) => app.rumble.set({ [field]: value }, field), () => app.rumble.reset(field));
      half.append(el("span", "label", label), input);
      character.append(half);
    };
    characterSlider("Dirt", "dirt", "From deep and clean to distorted and dirty");
    characterSlider("roll", "roll", "From a single swell to rolling sixteenths");
    // The kick itself comes first: the Nachbeben is made from the kick as hard as it is here.
    const drive = el("label", "line");
    const hardness = el("input");
    hardness.type = "range";
    hardness.min = "0";
    hardness.max = "100";
    hardness.id = "kick-hard";
    hardness.title = "Distort the kick itself: from clean to clipped flat, with a standing body";
    this.slider(hardness, () => app.project.hard, (value) => app.rumble.set({ hard: value }, "hard"), () => app.rumble.reset("hard"));
    drive.append(el("span", "label", "Hardness"), hardness);
    quake.append(drive, shaking, character);
    return quake;
  }

  /** The ring in the mix: how loud, how much hall and echo (the two share a row), and how hard it is driven. */
  private buildMix(): HTMLElement {
    const app = this.app;
    const mix = el("div", "group");
    const mixSlider = (label: string, field: "level" | "hall" | "echo" | "drive", hint = "", into: HTMLElement = mix): HTMLElement => {
      const line = el("label", "line");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      if (hint) line.title = hint;
      this.slider(input, () => trackOf(app.project, app.selected)[field], (value) => app.rings.setTrack(app.selected, { [field]: value }, field), () => app.rings.resetTrack(app.selected, field));
      line.append(el("span", "label", label), input);
      into.append(line);
      return line;
    };
    mixSlider("Volume", "level");
    const sends = el("div", "lines");
    mixSlider("Reverb", "hall", "", sends);
    mixSlider("Echo", "echo", "", sends);
    mix.append(sends);
    this.driveRow = mixSlider("Drive", "drive", "Pushes the ring into distortion. Sparks from the weather come on top.", this.driving);
    this.driveRow.id = "drive-row";
    this.driving.append(...this.pedalBoard.buildOpener());
    mix.append(this.driving);
    return mix;
  }

  /** The stage: only the wheel, in the dark. Its button sits in a corner beside the wheel. */
  private buildStage(): void {
    byId("stage-toggle").addEventListener("click", () => this.app.toggleStage());
    byId("lights-toggle").addEventListener("click", () => this.app.toggleLights());
  }

  private outside(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("#chord-menu") && target?.id !== "kreisel") this.app.chords.close();
    this.palette.outside(target);
  }

  // ---- showing ----------------------------------------------------------------

  /** Brings the whole page up to what the app holds now. */
  sync(): void {
    const sameRing = this.syncPage();
    this.syncBar();
    this.piecePanel.sync();
    this.syncTracks();
    this.scenesBox.sync();
    this.rowBand.sync();
    this.syncTools();
    // The workbench first: it puts its window away when its body is gone, and the tools go by what is open.
    this.benchWindow.sync();
    this.easelWindow.sync();
    this.syncFx();
    this.syncRingPanel(sameRing);
    this.relayDialog.sync();
    this.syncStatus();
    this.boothWindow.sync();
    this.weatherPanel.sync();
    this.pedalBoard.sync();
    this.sampleBoard.sync();
    this.acidPanel.sync();
    this.chordMenu.sync();
    // The guide's card before the palette and the messages, which keep clear of it; and after everything that decides
    // how the page is laid out (the row under the wheel, the sides of the panel).
    this.guideCard.sync();
    this.palette.sync();
    this.toast.sync();
    this.ring.invalidate();
    this.easel.invalidate();
    this.bench.invalidate();
    this.mouth.invalidate(trackInfo(this.app.selected).color);
  }

  /**
   * What the page as a whole goes by: the colour of the ring in focus, whether it plays, the stage, the tour.
   * Says whether the ring in focus is the one that was in focus before.
   */
  private syncPage(): boolean {
    const app = this.app;
    const project = app.project;
    const selected = app.selected;
    const info = trackInfo(selected);
    const root = document.documentElement;
    root.style.setProperty("--focus", info.color);
    // For the motions that go with the music: whether it plays, and how long a beat is.
    root.dataset.playing = String(app.playing);
    root.style.setProperty("--beat", `${(60 / project.bpm).toFixed(3)}s`);
    // The stage: only the wheel, in the dark. A window that opens takes the Kreisel off it again.
    if (app.stage && (app.paint.isOpen || app.body.isOpen || app.voice.isOpen)) app.toggleStage(false);
    if (app.playing) root.dataset.played = "true";
    root.dataset.stage = String(app.stage);
    if (app.stage !== this.shownStage) {
      this.shownStage = app.stage;
      const toggle = byId("stage-toggle");
      toggle.setAttribute("aria-pressed", String(app.stage));
      toggle.title = app.stage ? "Back from the stage (Esc)" : `Stage: only the wheel, in the dark (${this.keyLabel("KeyO")})`;
      // The wheel reads the colours of the page: they have just changed.
      this.ring.repaint();
    }
    const lights = byId("lights-toggle");
    lights.setAttribute("aria-pressed", String(app.lights));
    lights.title = app.lights ? "Light show: on" : "Light show: off";
    // The guide: a task that was just done (its card comes last, when everything else has its place).
    this.app.guide.check();
    // What belongs to the ring in focus only moves when it changes, not when another ring comes into focus.
    const sameRing = this.shownRing === selected;
    if (!sameRing && this.shownRing !== -1) {
      playMotion(this.head.querySelector(".dot"), "pop");
      playMotion(this.panel.name, "slide-in");
    }
    this.shownRing = selected;
    return sameRing;
  }

  /** The bar at the top: start, tempo, key, steps back, the sliders, the recording. */
  private syncBar(): void {
    const app = this.app;
    const project = app.project;
    const play = byId("play");
    play.setAttribute("aria-pressed", String(app.playing));
    play.querySelector(".label")!.textContent = app.playing ? "Stop" : "Start";
    this.moved(play.querySelector(".glyph"), app.playing, "pop");
    const bpm = byId<HTMLInputElement>("bpm");
    if (document.activeElement !== bpm) bpm.value = String(project.bpm);
    byId<HTMLSelectElement>("root").value = String(project.root);
    byId<HTMLSelectElement>("scale").value = project.scale;
    byId<HTMLButtonElement>("undo").disabled = !app.store.canUndo;
    byId<HTMLButtonElement>("redo").disabled = !app.store.canRedo;
    for (const slider of this.sliders) {
      const amount = slider.read();
      const value = String(Math.round(amount * 100));
      if (slider.input.value !== value) slider.input.value = value;
      // What a screen reader says for the value: a word where there is one, a percentage otherwise.
      const said = slider.say ? slider.say(amount) : `${value} %`;
      if (slider.input.getAttribute("aria-valuetext") !== said) slider.input.setAttribute("aria-valuetext", said);
    }

    const record = byId("record");
    record.setAttribute("aria-pressed", String(app.engine.recording));
    const showTime = (): void => {
      const seconds = Math.floor(app.engine.recordedSeconds);
      record.querySelector(".label")!.textContent = app.engine.recording ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Stop` : "Record";
    };
    showTime();
    if (app.engine.recording && this.recordTimer === null) this.recordTimer = setInterval(showTime, 500);
    if (!app.engine.recording && this.recordTimer !== null) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
  }

  /** The list of rings: which is in focus, which are silent, what each sounds like. */
  private syncTracks(): void {
    const app = this.app;
    const project = app.project;
    const selected = app.selected;
    this.trackRows.forEach((row, track) => {
      const one = trackOf(project, track);
      row.classList.toggle("selected", track === selected && !app.piece.focused && !app.weather.focused);
      row.classList.toggle("silent", !app.audible(track));
      row.classList.toggle("solo", app.rings.solo === track);
      row.querySelector(".sound")!.textContent = soundLabel(track, one);
      row.querySelector(".pick")!.setAttribute("aria-pressed", String(track === selected && !app.piece.focused && !app.weather.focused));
      row.querySelector(".mute")!.setAttribute("aria-pressed", String(!app.audible(track)));
      this.moved(row.querySelector(".mute svg"), !app.audible(track), "pop");
    });
  }

  /** The tools beside the wheel; on the kick's ring the last of them paints the Nachbeben. */
  private syncTools(): void {
    const app = this.app;
    const selected = app.selected;
    const info = trackInfo(selected);
    for (const [tool, node] of this.toolButtons) {
      node.setAttribute("aria-checked", String(tool === app.tool));
      this.moved(node.querySelector("svg"), tool === app.tool, "wiggle", "true");
      node.disabled = tool === "laenge" && !info.melodic && selected !== 0;
    }
    // A drum has no notes to hold: on the kick's ring that tool paints the Nachbeben instead.
    const hold = this.toolButtons.get("laenge");
    if (hold && hold.dataset.shake !== String(selected === 0)) {
      hold.dataset.shake = String(selected === 0);
      hold.querySelector(".name")!.textContent = selected === 0 ? "Rumble" : "Length";
      hold.querySelector("path")?.setAttribute("d", selected === 0 ? "M2 12h3l2-7 3 14 3-10 2 6 1.5-3H22" : "M4 12h16M4 8v8M20 8v8");
      hold.title = selected === 0 ? "Dragging along the kick's ring paints the rumble: strong outside, nothing inside; the right button erases" : "Dragging along the ring holds the note longer";
    }
    this.quake.hidden = selected !== 0;
    if (this.driveRow) this.driveRow.hidden = selected === 0;
    this.driving.hidden = selected === 0;
  }

  /** "Play in" and the effect keys: held, latched, or let go. */
  private syncFx(): void {
    const app = this.app;
    byId("live").setAttribute("aria-pressed", String(app.rings.live));
    for (const [fx, node] of this.fxButtons) {
      node.classList.toggle("held", app.engine.fx[fx]);
      node.classList.toggle("latched", app.latched.has(fx));
      node.setAttribute("aria-pressed", String(app.latched.has(fx)));
    }
  }

  /** The panel of the ring in focus. What belongs to that ring only moves when it changes, not when another ring comes into focus. */
  private syncRingPanel(sameRing: boolean): void {
    const app = this.app;
    const selected = app.selected;
    const info = trackInfo(selected);
    const pattern = patternOf(app.project, selected);
    const settings = trackOf(app.project, selected);
    const parts = this.panel;
    byId("panel").style.setProperty("--c", info.color);
    parts.name.textContent = info.name;
    parts.info.textContent = describe(pattern);
    this.moved(byId("sound-pick"), settings.sound, "pop", undefined, !sameRing);
    parts.puck.style.left = `${settings.x * 100}%`;
    parts.puck.style.bottom = `${settings.y * 100}%`;
    const sings = settings.sound === VOICE_SOUND;
    const sampled = settings.sound === SAMPLE_SOUND;
    // For the acid machine the pad is its filter: how far open, and how much it rings. For a sample: a filter and how long a hit rings.
    const [xLabel, yLabel] = settings.sound === ACID_SOUND ? ["Filter", "Resonance"] : sampled ? ["Filter", "Length"] : [info.xLabel, info.yLabel];
    parts.axisX.textContent = sings ? "" : `${xLabel} →`;
    parts.axisY.textContent = sings ? "" : `${yLabel} ↑`;
    this.vowels.hidden = !sings;
    parts.pad.title = sings ? "The vowel field: the point pulls all vowels towards itself, entirely at the edge, not at all in the middle" : sampled ? "A sample's pad. Across: in the middle the recording is as it is; to the left its highs go, to the right its lows. Up: in the upper half a hit plays out; below, it is cut shorter" : "";
    parts.pad.setAttribute("aria-label", `Sound pad: ${xLabel} ${Math.round(settings.x * 100)} %, ${yLabel} ${Math.round(settings.y * 100)} %. Arrow keys change it.`);
    parts.steps.textContent = String(pattern.len);
    this.moved(parts.steps, pattern.len, "tick", undefined, !sameRing);
    const hits = activeSteps(pattern).length;
    parts.spread.max = String(pattern.len);
    if (document.activeElement !== parts.spread || Number(parts.spread.value) !== hits) parts.spread.value = String(hits);
    parts.spreadValue.textContent = String(hits);
    parts.spread.setAttribute("aria-valuetext", hits === 1 ? "1 hit" : `${hits} hits`);
    this.moved(parts.spreadValue, hits, "tick", undefined, !sameRing);
    for (const node of byId("panel").querySelectorAll<HTMLButtonElement>(".line .button")) {
      if (node.textContent === "−") node.disabled = pattern.len <= MIN_STEPS;
      if (node.textContent === "+") node.disabled = pattern.len >= MAX_STEPS;
    }
  }

  /** The line under the wheel that says in words what is on it. */
  private syncStatus(): void {
    const app = this.app;
    const project = app.project;
    const selected = app.selected;
    const info = trackInfo(selected);
    const pattern = patternOf(project, selected);
    const settings = trackOf(project, selected);
    // A recording in slices with a hit on every step plays through: said so, not as a list of all its steps.
    const sliced = settings.sound === SAMPLE_SOUND && settings.sample?.mode === SLICES;
    const says = app.weather.focused
      ? `Weather: ${describeWeather(currentScene(project))}`
      : app.piece.laying && app.piece.key !== null
      ? app.piece.describeRoster(app.piece.lane, app.piece.key)
      : app.piece.focused
      ? `Piece: ${describePiece(project.piece, project.bpm)}${project.piece.on ? "" : " (off)"}${this.ahead()}`
      : app.relay.veiled(selected) ? `${info.name}: covered (Telephone)`
      : app.paint.isOpen ? `Painted sound ${info.name}: ${describeBild(settings.bild)}`
      : app.body.isOpen ? `Body ${info.name}: ${describeBody(settings.body)}`
      : app.voice.isOpen ? `Voice ${info.name}: ${describeVoice(settings.voice)}`
      : `${info.name}: ${sliced && activeSteps(pattern).length === pattern.len ? `a hit on every step of ${pattern.len}` : describe(pattern)}${settings.sound === SAMPLE_SOUND && settings.sample ? ` · ${describeSample(settings.sample, app.sample.sound?.seconds ?? null, pattern.len)}${app.sample.state === "missing" ? " (not in this browser: silent)" : ""}` : ""}${selected === 0 && hasRumble(currentScene(project), pattern.len) ? ` · ${describeRumble(currentScene(project), pattern)}` : ""}${this.pull(selected)}${this.ahead()}`;
    // Written only when the words differ: a line that is live is spoken again when it is written again.
    const status = byId("status");
    if (status.textContent !== says) status.textContent = says;
  }
}
