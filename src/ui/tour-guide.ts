import type { App } from "../app/app";
import { currentScene } from "../model";
import { activeSteps } from "../patterns";
import { Tour, type TourStep } from "./tour";
import { byId } from "./dom";
import type { Panels } from "./panels";

/*
 * The first steps: the seven places of the page the tour shows (see tour.ts for how it shows them), when it comes by itself, and how it is asked for.
 */
export class TourGuide {
  private tour: Tour | null = null;
  /** Starts the tour from its first step (set when the page is built). */
  start: () => void = () => undefined;

  constructor(private readonly panels: Panels, private readonly app: App) {}

  /** The first steps, shown where they happen: on the first visit, and from the menu whenever it is asked for. */
  build(): void {
    const app = this.app;
    const hits = (): number => currentScene(app.project).patterns.reduce((sum, pattern) => sum + activeSteps(pattern).length, 0);
    let before = 0;
    let ring = 0;
    const steps: TourStep[] = [
      { target: "#kreisel", side: "right", title: "This is your Kreisel", text: "Every ring is an instrument, one round is its pattern. Press the middle or the space bar, and off it goes.", done: () => app.playing },
      { target: "#kreisel", side: "right", title: "Paint a hit", text: "A click in a ring places a hit, a second one takes it away again. Dragging paints several, dragging outwards makes the note higher.", done: () => hits() !== before },
      { target: "#tracks", side: "right", title: "Seven rings", text: "Here you pick a ring. The speaker mutes it, the dice give it a new pattern.", done: () => app.selected !== ring },
      { target: "#panel", side: "left", title: "Its sound", text: "Every ring has 50 sounds: the arrows leaf through them, a click on the name shows the whole palette. Drag the point in the sound pad, and the sound changes. “Dice” brings a new idea, “Vary” changes it only a little." },
      { target: "#fx", side: "left", title: "Effects to hold", text: "Hold one of these keys while it plays: dull, thin, stutter, echo, pause. On the other side of the wheel are the tools for painting." },
      { target: "#scenes", side: "right", title: "From loop to piece", text: "Eight scenes, each a little wheel: an empty one becomes a copy of the current one when clicked, and you already have a second part. Switch to “Row” below, then you lay out under the big wheel in which order they play. “Share” at the top packs everything into a link." },
      { target: ".more", side: "below", title: "And everywhere: the right button", text: "A right click shows what can be done at any place. Up here you find the help and this tour again; at the name “Kreisel” you start anew." },
    ];
    const tour = new Tour(byId("tour"), steps, () => {
      try {
        localStorage.setItem("kreisel.hinweis", "1");
      } catch {
        // It will come again next time.
      }
    });
    this.tour = tour;
    this.start = () => {
      // A step that asks for something to be tried starts from how things are now.
      before = hits();
      ring = app.selected;
      if (app.stage) app.toggleStage(false);
      tour.start();
    };
    byId("tour-next").addEventListener("click", () => {
      before = hits();
      ring = app.selected;
    });
    let seen = false;
    try {
      seen = localStorage.getItem("kreisel.hinweis") === "1";
    } catch {
      // No storage: show it.
    }
    // A moment later, when the wheel has dealt its hits.
    if (!seen) setTimeout(() => { if (!app.paint.isOpen && !app.body.isOpen && !app.voice.isOpen) this.start(); }, 700);
  }

  /** The app has changed: a step that asked for something to be done moves on when it was. */
  check(): void {
    this.tour?.check();
  }

  /** Ends the tour if it runs, and says whether it did. */
  end(): boolean {
    const running = this.tour?.running ?? false;
    this.tour?.end();
    return running;
  }
}
