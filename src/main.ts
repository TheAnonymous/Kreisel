import "./style.css";
import { App } from "./app";
import { serialize } from "./codec";
import { bindKeys } from "./ui/keys";
import { Panels } from "./ui/panels";
import { RingView } from "./ui/ring";

const app = new App();
const canvas = document.getElementById("kreisel");
const tip = document.getElementById("tip");
if (!(canvas instanceof HTMLCanvasElement) || !tip) throw new Error("page without a Kreisel");

const ring = new RingView(canvas, app, tip);
const panels = new Panels(app, ring);
bindKeys(app, panels);

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
    kreisel: { app: App; version: string; state(): string; level(): number; where(track: number, step: number): { x: number; y: number } };
  }
}
window.kreisel = {
  app,
  version: typeof import.meta.env.VITE_APP_COMMIT === "string" ? import.meta.env.VITE_APP_COMMIT : "dev",
  state: () => serialize(app.project),
  level: () => app.level(),
  where: (track, step) => ring.stepPosition(track, step),
};
