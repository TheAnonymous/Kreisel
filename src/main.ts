import "./style.css";
import { App } from "./app/app";
import { hear, type Heard } from "./audio/hear";
import { hearWhole, type Whole } from "./audio/whole";
import { serialize } from "./codec";
import { PALETTE_ORDER } from "./sounds/index";
import { bindKeys } from "./ui/keys";
import { BenchView } from "./ui/bench";
import { BoothView } from "./ui/booth";
import { EaselView } from "./ui/easel";
import { barMenu } from "./ui/bar-menus";
import { ContextMenu } from "./ui/menu";
import { buildMenu } from "./ui/menus";
import { Panels } from "./ui/panels";
import { RingView } from "./ui/ring";

const app = new App();
const canvas = document.getElementById("kreisel");
const tip = document.getElementById("tip");
if (!(canvas instanceof HTMLCanvasElement) || !tip) throw new Error("page without a Kreisel");

const sheet = document.getElementById("bild");
if (!(sheet instanceof HTMLCanvasElement)) throw new Error("page without a paint box");

const stand = document.getElementById("koerper");
if (!(stand instanceof HTMLCanvasElement)) throw new Error("page without a workbench");

const aura = document.getElementById("licht");
const ring = new RingView(canvas, app, tip, aura instanceof HTMLCanvasElement ? aura : null);
const easel = new EaselView(sheet, app);
const bench = new BenchView(stand, app);
const lips = document.getElementById("mund");
if (!(lips instanceof HTMLCanvasElement)) throw new Error("page without a mouth");
const mouth = new BoothView(lips, app);
const panels = new Panels(app, ring, easel, bench, mouth);

// The right button (or a long press) shows what can be done with the place it is on.
const context = document.getElementById("context");
if (!context) throw new Error("page without a menu");
const menu = new ContextMenu(context);
const doors = { relay: () => panels.showRelay(), help: () => panels.showHelp(), tour: () => panels.startTour(), get stageKey() { return panels.keyLabel("KeyO"); } };
app.onContext = (target, x, y, byKeyboard) => {
  app.chords.close();
  menu.open(x, y, () => buildMenu(app, target, doors), byKeyboard);
};
// The same menu hangs under the bar's buttons: the Kreisel's name, the speaker, "Teilen", "Aufnehmen", the help.
panels.onBarMenu = (opener, which, byKeyboard) => {
  app.chords.close();
  menu.openUnder(opener, () => barMenu(app, which, doors), byKeyboard);
};
app.subscribe(() => menu.refresh());

bindKeys(app, panels, () => {
  if (app.piece.focused) {
    const bar = app.piece.key ?? app.piece.start;
    if (app.piece.laying) {
      const at = ring.rosterPosition(app.piece.lane, bar);
      app.openContext({ kind: "roster", bar }, at.x, at.y, true);
      return;
    }
    const at = ring.barPosition(bar, 0.5);
    app.openContext({ kind: "piece", bar }, at.x, at.y, true);
  } else {
    const at = ring.stepPosition(app.selected, app.keyCursor ?? 0);
    app.openContext({ kind: "ring", track: app.selected, step: app.keyCursor }, at.x, at.y, true);
  }
});

void app.files.openLink(location.hash);
window.addEventListener("hashchange", () => void app.files.openLink(location.hash));

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("sw.js").catch(() => undefined);
  });
}

/** For the browser tests and the curious: the app from the console. */
declare global {
  interface Window {
    kreisel: {
      app: App;
      version: string;
      state(): string;
      level(): number;
      where(track: number, step: number): { x: number; y: number };
      /** Where a point of the open paint box is on the page: time and height, both 0..1. */
      sheet(t: number, y: number): { x: number; y: number };
      /** Where a bar of the piece's ring is on the page, at a tension of 0..1. */
      bar(bar: number, height: number): { x: number; y: number };
      /** Where a bar of the piece is in a ring's lane while the rings show the roster. */
      lane(track: number, bar: number): { x: number; y: number };
      /** Where a chord field is on the page. */
      slot(slot: number): { x: number; y: number };
      /** Where a place on the body on the workbench is on the page (0 its middle, 1 its edge), and where its two grips are. */
      knock(where: number): { x: number; y: number };
      grip(what: "size" | "tight"): { x: number; y: number };
      /** Where on the page a share (0..1) of the Nachbeben is painted at a step of the kick's ring. */
      quake(step: number, share: number): { x: number; y: number };
      /** How much on the wheel is in motion right now: hits popping in, hits shrinking away, rings sliding. */
      motion(): { popping: number; shrinking: number; sliding: number };
      /** What the light show has in the air right now. */
      light(): { sparks: number; waves: number; glowing: boolean };
      /** One hit of a ring's ready-made sound by itself, measured; x and y are where the pad's point stands (the middle unless said). */
      hear(track: number, sound: number, x?: number, y?: number): Promise<Heard>;
      /** The whole Kreisel on the table, rendered faster than it plays (as a saved file would hold it), and what can be measured on it. */
      whole(): Promise<Whole>;
      /** The numbers of a ring's fifty ready-made sounds, in the order of its palette. */
      palette: readonly number[];
    };
  }
}
window.kreisel = {
  app,
  version: typeof import.meta.env.VITE_APP_COMMIT === "string" ? import.meta.env.VITE_APP_COMMIT : "dev",
  state: () => serialize(app.project),
  level: () => app.level(),
  where: (track, step) => ring.stepPosition(track, step),
  sheet: (t, y) => easel.position(t, y),
  bar: (bar, height) => ring.barPosition(bar, height),
  lane: (track, bar) => ring.rosterPosition(track, bar),
  slot: (slot) => ring.slotPosition(slot),
  knock: (where) => bench.position(where),
  grip: (what) => bench.grip(what),
  quake: (step, share) => ring.rumblePosition(step, share),
  motion: () => ring.motion(),
  light: () => ring.light(),
  hear: (track, sound, x, y) => hear(app.project, track, sound, x, y),
  whole: () => hearWhole(structuredClone(app.project)),
  palette: PALETTE_ORDER,
};
