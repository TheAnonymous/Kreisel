import "./style.css";
import { App } from "./app";
import { serialize } from "./codec";
import { bindKeys } from "./ui/keys";
import { BenchView } from "./ui/bench";
import { BoothView } from "./ui/booth";
import { EaselView } from "./ui/easel";
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
const doors = { relay: () => panels.showRelay(), help: () => panels.showHelp() };
app.onContext = (target, x, y, byKeyboard) => {
  panels.closeMenu();
  app.closeChord();
  menu.open(x, y, () => buildMenu(app, target, doors), byKeyboard);
};
app.subscribe(() => menu.refresh());

bindKeys(app, panels, () => {
  if (app.pieceFocus) {
    const bar = app.pieceKey ?? app.pieceStart;
    const at = ring.barPosition(bar, 0.5);
    app.openContext({ kind: "piece", bar }, at.x, at.y, true);
  } else {
    const at = ring.stepPosition(app.selected, app.keyCursor ?? 0);
    app.openContext({ kind: "ring", track: app.selected, step: app.keyCursor }, at.x, at.y, true);
  }
});

void app.openLink(location.hash);
window.addEventListener("hashchange", () => void app.openLink(location.hash));

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
  slot: (slot) => ring.slotPosition(slot),
  knock: (where) => bench.position(where),
  grip: (what) => bench.grip(what),
  quake: (step, share) => ring.rumblePosition(step, share),
  motion: () => ring.motion(),
  light: () => ring.light(),
};
