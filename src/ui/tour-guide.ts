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
      { target: "#kreisel", side: "right", title: "Das ist dein Kreisel", text: "Jeder Ring ist ein Instrument, eine Runde ist sein Muster. Drück auf die Mitte oder die Leertaste, dann läuft er los.", done: () => app.playing },
      { target: "#kreisel", side: "right", title: "Mal einen Schlag", text: "Ein Klick in einen Ring setzt einen Schlag, ein zweiter nimmt ihn wieder weg. Ziehen malt mehrere, nach außen ziehen macht den Ton höher.", done: () => hits() !== before },
      { target: "#tracks", side: "right", title: "Sieben Ringe", text: "Hier wählst du einen Ring. Der Lautsprecher schaltet ihn stumm, der Würfel gibt ihm ein neues Muster.", done: () => app.selected !== ring },
      { target: "#panel", side: "left", title: "Sein Klang", text: "Jeder Ring hat 50 Klänge: Die Pfeile blättern, ein Klick auf den Namen zeigt die ganze Palette. Zieh den Punkt im Klangfeld, und der Klang verändert sich. „Würfeln“ bringt eine neue Idee, „Variieren“ ändert sie nur ein wenig." },
      { target: "#fx", side: "left", title: "Effekte zum Festhalten", text: "Halt eine dieser Tasten, solange es spielt: dumpf, dünn, Stottern, Echo, Pause. Auf der anderen Seite des Rads liegen die Werkzeuge zum Malen." },
      { target: "#scenes", side: "right", title: "Vom Loop zum Stück", text: "Acht Szenen: Eine leere wird beim Anklicken zur Kopie der aktuellen, und schon hast du einen zweiten Teil. „Teilen“ oben packt alles in einen Link." },
      { target: ".more", side: "below", title: "Und überall: die rechte Taste", text: "Ein Rechtsklick zeigt an jeder Stelle, was dort geht. Hier oben findest du die Hilfe und diese Tour wieder; am Namen „Kreisel“ fängst du neu an." },
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
