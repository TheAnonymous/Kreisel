import { FX, TOOLS, type App, type Deed, type Tool } from "../app/app";
import type { FxName } from "../audio/engine";
import { describeBild } from "../bild";
import { describeBody } from "../body";
import { describeRumble, hasRumble } from "../rumble";
import { describeVoice, FIELD_LETTERS } from "../voice";
import { describeWeather } from "../weather";
import { ACID_SOUND, clamp, currentScene, VOICE_SOUND, MAX_STEPS, MIN_STEPS, patternOf, SCENE_COUNT, SCENE_NAMES, TRACK_COUNT, trackInfo, trackOf, type ScaleId } from "../model";
import { NOTE_NAMES, SCALE_IDS, SCALES } from "../music";
import { activeSteps, describe } from "../patterns";
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
import { TourGuide } from "./tour-guide";
import { HelpDialog } from "./help";
import { ChordMenu } from "./chord-menu";
import { ToastView } from "./toast";
import { PiecePanel } from "./piece-panel";
import { AcidPanel } from "./acid-panel";
import { WeatherPanel } from "./weather-panel";
import { EaselWindow } from "./easel-window";
import { BoothWindow } from "./booth-window";
import { BenchWindow } from "./bench-window";
import { SoundPalette, soundLabel } from "./sound-palette";

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
interface Slider {
  input: HTMLInputElement;
  read(): number;
}

export class Panels {
  /** What stands on each key on this keyboard (QWERTZ until the browser says otherwise). */
  private labels = new Map<string, string>([["KeyZ", "Y"], ["KeyY", "Z"]]);
  private readonly sliders: Slider[] = [];
  /** Opens the menu that hangs under one of the bar's buttons (set by whoever holds the menu). */
  onBarMenu: (opener: HTMLElement, which: BarMenu, byKeyboard: boolean) => void = () => undefined;
  readonly trackRows: HTMLLIElement[] = [];
  private readonly sceneButtons: HTMLButtonElement[] = [];
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
  private readonly doing = { roll: button("button small", "Würfeln", "Eine neue Idee für diesen Ring (N)"), vary: button("button small", "Variieren", "Nur ein wenig verändern (Umschalt+N)"), wipe: button("button small", "Leeren", "Alle Schläge dieses Rings entfernen (Umschalt+Entf)") };
  private readonly head = el("header", "panel-head");

  // ---- the parts of the page that have a file of their own ----
  private readonly relayDialog: RelayDialog;
  private readonly tourGuide: TourGuide;
  private readonly help: HelpDialog;
  private readonly chordMenu: ChordMenu;
  private readonly toast: ToastView;
  private readonly piecePanel: PiecePanel;
  private readonly weatherPanel: WeatherPanel;
  private readonly acidPanel: AcidPanel;
  private readonly easelWindow: EaselWindow;
  private readonly boothWindow: BoothWindow;
  private readonly benchWindow: BenchWindow;
  private readonly palette: SoundPalette;

  constructor(private readonly app: App, private readonly ring: RingView, private readonly easel: EaselView, private readonly bench: BenchView, private readonly mouth: BoothView) {
    this.relayDialog = new RelayDialog(this, app);
    this.tourGuide = new TourGuide(this, app);
    this.help = new HelpDialog(this);
    this.chordMenu = new ChordMenu(app, ring);
    this.toast = new ToastView(app);
    this.piecePanel = new PiecePanel(this, app);
    this.weatherPanel = new WeatherPanel(this, app);
    this.acidPanel = new AcidPanel(this, app);
    this.easelWindow = new EaselWindow(this, app, easel);
    this.boothWindow = new BoothWindow(this, app, mouth);
    this.benchWindow = new BenchWindow(this, app, bench);
    this.palette = new SoundPalette(app);
    this.buildBar();
    this.buildTracks();
    this.buildScenes();
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
    this.tourGuide.build();
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
    for (const nodes of [this.easelWindow.brushButtons, this.benchWindow.malletButtons, this.weatherPanel.cloudButtons]) {
      nodes.forEach((node, index) => {
        const key = node.querySelector(".key");
        if (key) key.textContent = this.keyLabel(WEATHER_CODES[index] ?? "");
      });
    }
    this.help.build();
  }

  // ---- building ---------------------------------------------------------------

  slider(input: HTMLInputElement, read: () => number, write: (value: number) => void, reset?: () => void): void {
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

    const chain = byId<HTMLInputElement>("chain");
    chain.addEventListener("change", () => app.setGlobal({ chain: chain.checked }));
    const repeats = byId<HTMLSelectElement>("repeats");
    repeats.addEventListener("change", () => app.setGlobal({ repeats: Number(repeats.value) }));
  }

  showHelp(): void {
    this.help.show();
  }

  startTour(): void {
    this.tourGuide.start();
  }

  showRelay(): void {
    this.relayDialog.show();
  }

  /** Ends the tour if it runs, and says whether it did. */
  endTour(): boolean {
    return this.tourGuide.end();
  }

  private buildTracks(): void {
    const list = byId("tracks");
    // The weather lies over all the rings: it comes before them.
    const sky = this.weatherRow;
    const choose = button("pick", "", "Das Wetter wählen: Effekte auf das Rad malen (Taste 9)");
    choose.append(el("span", "dot"), el("span", "name", "Wetter"), el("span", "sound"));
    choose.addEventListener("click", () => this.app.weather.focus());
    const throwIt = iconButton("roll", ICONS.dice, "Wetter würfeln", "Ein neues Wetter würfeln");
    throwIt.addEventListener("click", () => this.app.weather.dice());
    sky.append(choose, throwIt);
    onContext(sky, (x, y, byKeyboard) => this.app.openContext({ kind: "weather" }, x, y, byKeyboard));
    list.append(sky);
    // The piece is the outermost ring: it comes first.
    const row = this.pieceRow;
    const pick = button("pick", "", "Den Stück-Ring wählen (Taste 8)");
    pick.append(el("span", "dot"), el("span", "name", "Stück"), el("span", "sound"));
    pick.addEventListener("click", () => this.app.piece.focus());
    const toggle = button("piece-toggle", "", "Nach dem Stück spielen oder nur die Szene im Kreis");
    toggle.addEventListener("click", () => this.app.piece.toggle());
    const roll = iconButton("roll", ICONS.dice, "Stück würfeln", "Einen neuen Verlauf würfeln");
    roll.addEventListener("click", () => this.app.piece.dice());
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
        if (event.shiftKey) this.app.rings.toggleSolo(track);
        else this.app.rings.toggleMute(track);
      });
      const roll = iconButton("roll", ICONS.dice, `${info.name} würfeln`, "Neu würfeln (N)");
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

  private buildScenes(): void {
    const holder = byId("scenes");
    for (let index = 0; index < SCENE_COUNT; index += 1) {
      const scene = button("scene", SCENE_NAMES[index] ?? "");
      scene.addEventListener("click", (event) => {
        if (event.shiftKey) this.app.scenes.clear(index);
        else this.app.scenes.pick(index);
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
    live.addEventListener("click", () => this.app.rings.toggleLive());
    holder.append(live);
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

  /** The panel of the ring in focus, and the cloth over a ring that someone else has built (Stille Post). */
  private buildPanel(): void {
    this.head.append(el("span", "dot"), this.panel.name);
    this.ringBox.append(this.head, this.panel.info, this.buildDoing(), this.palette.buildRow(), ...this.buildOwnSounds(), this.buildPad(), this.acidPanel.build(), this.buildSteps(), this.buildQuake(), this.buildMix());
    this.veilBox.append(
      el("header", "panel-head"),
      el("p", "veil-text", "Stille Post: Dieser Ring ist verdeckt. Jemand hat hier schon gebaut, aber du hörst und siehst nur den Ring der Person vor dir. Bau deinen eigenen dazu: Nimm einen Ring, der noch leer ist. Wenn alle fertig sind, deckt ihr im Reihum-Fenster auf."),
    );
    this.veilBox.querySelector("header")!.append(el("span", "dot"), el("h2"));
    byId("panel").append(this.ringBox, this.pieceBox, this.veilBox);
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
    const paint = button("button small", "Malen", "Den eigenen Klang dieses Rings malen");
    paint.id = "paint";
    paint.addEventListener("click", () => app.paint.open());
    own.append(this.own.pick, paint);

    // And its own body: a thing that rings, built on the workbench.
    const built = el("div", "own");
    this.built.pick.id = "built-pick";
    this.built.pick.append(this.built.thumb, this.built.label);
    this.built.pick.addEventListener("click", () => app.body.use());
    const build = button("button small", "Bauen", "Den Klangkörper dieses Rings bauen");
    build.id = "build";
    build.addEventListener("click", () => app.body.open());
    built.append(this.built.pick, build);

    // And its own voice: a line of text, sung a syllable a hit.
    const sung = el("div", "own");
    const lips = el("span", "thumb lips");
    this.sung.pick.id = "voice-pick";
    this.sung.pick.append(lips, this.sung.label);
    this.sung.pick.addEventListener("click", () => app.voice.use());
    const write = button("button small", "Text", "Die Zeile schreiben, die dieser Ring singt");
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
    const less = button("button icon small", "−", "Einen Schritt kürzer");
    less.setAttribute("aria-label", "Einen Schritt kürzer");
    less.addEventListener("click", () => app.rings.resize(app.selected, patternOf(app.project, app.selected).len - 1));
    const more = button("button icon small", "+", "Einen Schritt länger");
    more.setAttribute("aria-label", "Einen Schritt länger");
    more.addEventListener("click", () => app.rings.resize(app.selected, patternOf(app.project, app.selected).len + 1));
    const quick = el("span", "quick");
    for (const length of [8, 12, 16, 32]) {
      const chip = button("chip tiny", String(length), `${length} Schritte`);
      chip.addEventListener("click", () => app.rings.resize(app.selected, length));
      quick.append(chip);
    }
    steps.append(el("span", "label", "Schritte"), less, parts.steps, more, quick);

    const turn = el("div", "line");
    const turnLeft = iconButton("button icon small", ICONS.left, "Einen Schritt zurückdrehen", "Zurückdrehen (Umschalt+←)");
    turnLeft.addEventListener("click", () => app.rings.rotate(app.selected, -1));
    const turnRight = iconButton("button icon small", ICONS.right, "Einen Schritt weiterdrehen", "Weiterdrehen (Umschalt+→ oder Mausrad über dem Ring)");
    turnRight.addEventListener("click", () => app.rings.rotate(app.selected, 1));
    turn.append(el("span", "label", "Drehen"), turnLeft, turnRight);

    const spread = el("label", "line");
    parts.spread.type = "range";
    parts.spread.min = "0";
    parts.spread.step = "1";
    parts.spread.title = "So viele Schläge gleichmäßig über den Ring verteilen";
    parts.spread.addEventListener("input", () => app.rings.spread(app.selected, Number(parts.spread.value)));
    parts.spread.addEventListener("change", () => app.store.settle());
    spread.append(el("span", "label", "Verteilen"), parts.spread, parts.spreadValue);
    ringGroup.append(steps, turn, spread);
    return ringGroup;
  }

  /** The kick's ring has its Nachbeben: painted into the ring, with a character of its own. */
  private buildQuake(): HTMLElement {
    const app = this.app;
    const quake = this.quake;
    const shaking = el("div", "line");
    const paintIt = button("button small", "Malen", "Das Nachbeben in den Kick-Ring malen: außen bebt es stark, innen gar nicht (Werkzeug Beben)");
    paintIt.id = "rumble-paint";
    paintIt.addEventListener("click", () => app.rumble.pickUpBrush());
    const throwIt = button("button small", "Würfeln", "Eine der üblichen Formen um die Kicks legen: Offbeat, rollend, Schweif");
    throwIt.id = "rumble-dice";
    throwIt.addEventListener("click", () => app.rumble.dice());
    const still = button("button small", "Aus", "Das Nachbeben wegnehmen");
    still.id = "rumble-off";
    still.addEventListener("click", () => app.rumble.shape(-1));
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
      this.slider(input, () => app.project[field], (value) => app.rumble.set({ [field]: value }, field), () => app.rumble.reset(field));
      half.append(el("span", "label", label), input);
      character.append(half);
    };
    characterSlider("Dreck", "dirt", "Von tief und sauber bis verzerrt und dreckig");
    characterSlider("Rollen", "roll", "Von einem einzigen Schwellen bis zu rollenden Sechzehnteln");
    // The kick itself comes first: the Nachbeben is made from the kick as hard as it is here.
    const drive = el("label", "line");
    const hardness = el("input");
    hardness.type = "range";
    hardness.min = "0";
    hardness.max = "100";
    hardness.id = "kick-hard";
    hardness.title = "Die Kick selbst verzerren: von sauber bis flach geklippt, mit stehendem Körper";
    this.slider(hardness, () => app.project.hard, (value) => app.rumble.set({ hard: value }, "hard"), () => app.rumble.reset("hard"));
    drive.append(el("span", "label", "Härte"), hardness);
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
    mixSlider("Lautstärke", "level");
    const sends = el("div", "lines");
    mixSlider("Hall", "hall", "", sends);
    mixSlider("Echo", "echo", "", sends);
    mix.append(sends);
    this.driveRow = mixSlider("Zerre", "drive", "Treibt den Ring in die Verzerrung. Funken aus dem Wetter kommen obendrauf.");
    this.driveRow.id = "drive-row";
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
    this.syncScenes();
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
    this.acidPanel.sync();
    this.chordMenu.sync();
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
      toggle.title = app.stage ? "Zurück von der Bühne (Esc)" : `Bühne: nur das Rad, im Dunkeln (${this.keyLabel("KeyO")})`;
      // The wheel reads the colours of the page: they have just changed.
      this.ring.repaint();
    }
    const lights = byId("lights-toggle");
    lights.setAttribute("aria-pressed", String(app.lights));
    lights.title = app.lights ? "Lichtspiel: an" : "Lichtspiel: aus";
    this.tourGuide.check();
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

  private syncScenes(): void {
    const app = this.app;
    const project = app.project;
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
      hold.querySelector(".name")!.textContent = selected === 0 ? "Beben" : "Länge";
      hold.querySelector("path")?.setAttribute("d", selected === 0 ? "M2 12h3l2-7 3 14 3-10 2 6 1.5-3H22" : "M4 12h16M4 8v8M20 8v8");
      hold.title = selected === 0 ? "Am Kick-Ring entlang ziehen malt das Nachbeben: außen stark, innen nichts; die rechte Taste radiert" : "Am Ring entlang ziehen hält den Ton länger";
    }
    this.quake.hidden = selected !== 0;
    if (this.driveRow) this.driveRow.hidden = selected === 0;
  }

  /** "Einspielen" and the effect keys: held, latched, or let go. */
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
    // For the acid machine the pad is its filter: how far open, and how much it rings.
    const [xLabel, yLabel] = settings.sound === ACID_SOUND ? ["Filter", "Resonanz"] : [info.xLabel, info.yLabel];
    parts.axisX.textContent = sings ? "" : `${xLabel} →`;
    parts.axisY.textContent = sings ? "" : `${yLabel} ↑`;
    this.vowels.hidden = !sings;
    parts.pad.title = sings ? "Das Vokalfeld: Der Punkt zieht alle Vokale zu sich, am Rand ganz, in der Mitte gar nicht" : "";
    parts.pad.setAttribute("aria-label", `Klangfeld: ${xLabel} ${Math.round(settings.x * 100)} %, ${yLabel} ${Math.round(settings.y * 100)} %. Pfeiltasten verändern.`);
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
  }

  /** The line under the wheel that says in words what is on it. */
  private syncStatus(): void {
    const app = this.app;
    const project = app.project;
    const selected = app.selected;
    const info = trackInfo(selected);
    const pattern = patternOf(project, selected);
    const settings = trackOf(project, selected);
    byId("status").textContent = app.weather.focused
      ? `Wetter: ${describeWeather(currentScene(project))}`
      : app.piece.focused
      ? `Stück: ${describePiece(project.piece, project.bpm)}${project.piece.on ? "" : " (aus)"}`
      : app.relay.veiled(selected) ? `${info.name}: verdeckt (Stille Post)`
      : app.paint.isOpen ? `Klangmalerei ${info.name}: ${describeBild(settings.bild)}`
      : app.body.isOpen ? `Klangkörper ${info.name}: ${describeBody(settings.body)}`
      : app.voice.isOpen ? `Stimme ${info.name}: ${describeVoice(settings.voice)}`
      : `${info.name}: ${describe(pattern)}${selected === 0 && hasRumble(currentScene(project), pattern.len) ? ` · ${describeRumble(currentScene(project), pattern)}` : ""}`;
  }
}
