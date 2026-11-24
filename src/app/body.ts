import { cleanBody, diceBody } from "../body";
import { BODY_SOUND, trackOf, type Body } from "../model";
import type { App } from "./app";
import { WorkshopDesk } from "./workshop";

/** What sets a Klangkörper going: the tools of the workbench. */
export const MALLETS: readonly { name: string; hint: string }[] = [
  { name: "Soft", hint: "A soft mallet: round and dark" },
  { name: "Hard", hint: "A hard mallet: bright, with a click" },
  { name: "Pluck", hint: "Plucked with a finger" },
  { name: "Bow", hint: "With the bow: sounds for as long as the note lasts" },
  { name: "Blow", hint: "With breath: sounds for as long as the note lasts" },
];

/*
 * The workbench: a ring's Klangkörper, a thing that rings, built and knocked
 * on. The window over the wheel is the workbench.
 */
export class BodyDesk extends WorkshopDesk<"body"> {
  constructor(app: App) {
    super(app, "body", BODY_SOUND, "body");
  }

  protected first(track: number): Body {
    return diceBody(track, this.app.random);
  }

  protected override opened(): void {
    this.hear();
  }

  /** Changes the body of the ring in focus; changes with the same `key` in quick succession are one step back. */
  shape(change: Partial<Body>, key?: string): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const body = trackOf(this.app.project, track).body;
    if (!body) return;
    const next = cleanBody({ ...body, ...change });
    if (JSON.stringify(next) === JSON.stringify(body) && trackOf(this.app.project, track).sound === BODY_SOUND) return;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), { body: next, sound: BODY_SOUND }); }, key ? `${key}${track}` : undefined, key?.startsWith("koerper") ? Infinity : undefined);
  }

  /** One note on the body as it is now, also while the Kreisel plays: a knock on the workbench is always heard. */
  hear(): void {
    const track = this.app.selected;
    if (this.app.relay.veiled(track)) return;
    this.app.rings.strike(track);
  }

  /** Knocks on the body at `where`; from then on the ring strikes it there. */
  strike(where: number, gesture: string): void {
    this.shape({ where }, gesture);
    this.hear();
  }

  dice(): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), { body: diceBody(track, this.app.random), sound: BODY_SOUND }); });
    this.hear();
  }
}
