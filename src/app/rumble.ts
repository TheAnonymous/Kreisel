import { diceRumble, RUMBLE_SHAPES, rumbleShape, SHAPE_ROLL, shapeOf } from "../rumble";
import { clamp, currentScene, emptyRumble, startProject, patternOf, RUMBLE_MAX, type Project } from "../model";
import { activeSteps } from "../patterns";
import type { App } from "./app";

/*
 * The Nachbeben: the rumble that is painted into the kick's ring.
 */
export class RumbleDesk {
  /** The shape the Nachbeben's dice threw last. */
  private lastShape = -1;

  constructor(private readonly app: App) {}

  /** Paints how much the ground shakes at a step of the kick's ring, 0..1. */
  paint(step: number, share: number, gesture: string): void {
    if (this.app.relay.refuse(0)) return;
    if (step < 0 || step >= patternOf(this.app.project, 0).len) return;
    const value = clamp(Math.round(share * RUMBLE_MAX), 0, RUMBLE_MAX);
    if (currentScene(this.app.project).rumble[step] === value) return;
    this.app.store.edit((project) => { currentScene(project).rumble[step] = value; }, gesture, Infinity);
  }

  /** Lays one of the usual shapes around the kicks and sets how much it rolls; −1 takes the Nachbeben away. */
  shape(shape: number): void {
    if (this.app.relay.refuse(0)) return;
    const kicks = activeSteps(patternOf(this.app.project, 0)).length;
    this.app.store.edit((project) => {
      const scene = currentScene(project);
      scene.rumble = shape < 0 ? emptyRumble() : rumbleShape(patternOf(project, 0), shape);
      if (shape >= 0) project.roll = SHAPE_ROLL[shape] ?? project.roll;
    });
    if (shape >= 0) this.hint(kicks);
  }

  /** The dice: the next of the usual shapes, a little different every time. */
  dice(): void {
    if (this.app.relay.refuse(0)) return;
    const pattern = patternOf(this.app.project, 0);
    const now = shapeOf(pattern, currentScene(this.app.project).rumble);
    this.lastShape = ((now >= 0 ? now : this.lastShape) + 1) % RUMBLE_SHAPES.length;
    const shape = this.lastShape;
    this.app.store.edit((project) => {
      currentScene(project).rumble = diceRumble(patternOf(project, 0), shape, this.app.random);
      project.roll = SHAPE_ROLL[shape] ?? project.roll;
    });
    this.hint(activeSteps(pattern).length, `Rumble: ${RUMBLE_SHAPES[shape]}.`);
  }

  private hint(kicks: number, text = ""): void {
    if (kicks === 0) this.app.say("Without a kick nothing shakes: put hits into the kick's ring first.");
    else if (!this.app.playing) this.app.say(`${text ? `${text} ` : ""}Start the Kreisel, then you hear the rumble between the kicks.`);
    else if (text) this.app.say(text);
  }

  /** How hard the kick is driven, and the Nachbeben's character: how dirty it is, how much it rolls. */
  set(change: Partial<Pick<Project, "hard" | "dirt" | "roll">>, key?: string): void {
    if (this.app.relay.refuse(0)) return;
    this.app.store.edit((project) => {
      if (change.hard !== undefined) project.hard = clamp(change.hard, 0, 1);
      if (change.dirt !== undefined) project.dirt = clamp(change.dirt, 0, 1);
      if (change.roll !== undefined) project.roll = clamp(change.roll, 0, 1);
    }, key);
  }

  reset(field: "hard" | "dirt" | "roll"): void {
    this.set({ [field]: startProject(this.app.project.style)[field] });
  }

  /** Picks the kick's ring and the tool that paints its Nachbeben. */
  pickUpBrush(): void {
    this.app.select(0);
    this.app.setTool("laenge");
    this.app.say("Drag once around the kick's ring with the mouse: outside it shakes hard, inside not at all. The right button erases.");
  }

  /** The keyboard on the Nachbeben: a step up or down at the cursor. */
  nudge(by: number): void {
    const step = this.app.keyCursor;
    if (step === null) return;
    const now = currentScene(this.app.project).rumble[step] ?? 0;
    this.paint(step, clamp(now + by * 2, 0, RUMBLE_MAX) / RUMBLE_MAX, "beben-taste");
  }
}
