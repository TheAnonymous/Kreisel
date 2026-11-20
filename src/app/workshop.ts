import { trackOf, type Track } from "../model";
import type { App, Workshop } from "./app";

/*
 * A ring can have three sounds of its own: a painted picture, a body that
 * rings, a voice. Each is made in a window over the wheel, and all three
 * windows open, close and are picked in the same way. That way is here; what
 * is done in each window is at its own desk.
 */
export abstract class WorkshopDesk<K extends "bild" | "body" | "voice"> {
  /**
   * @param field where a ring keeps this sound
   * @param sound the sound number that plays it
   * @param window the window in which it is made
   */
  constructor(protected readonly app: App, private readonly field: K, private readonly sound: number, private readonly window: Workshop) {}

  /** A first one to start from, for a ring that has none yet. */
  protected abstract first(track: number): NonNullable<Track[K]>;

  /** The window has just opened on `track`: a desk may let the ring be heard. */
  protected opened(_track: number): void {
    // Nothing to hear by default.
  }

  /** This sound of the ring in focus, if it has one. */
  get current(): Track[K] {
    return trackOf(this.app.project, this.app.selected)[this.field];
  }

  /** The window is open over the wheel. */
  get isOpen(): boolean {
    return this.app.workshop === this.window;
  }

  /** Opens the window on the ring in focus; a ring that has no such sound yet gets a first one to start from. */
  open(): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const settings = trackOf(this.app.project, track);
    if (!settings[this.field]) {
      this.app.store.edit((project) => { Object.assign(trackOf(project, track), { [this.field]: this.first(track), sound: this.sound }); });
    } else if (settings.sound !== this.sound) {
      this.app.rings.setTrack(track, { sound: this.sound });
    }
    this.app.openWorkshop(this.window);
    this.opened(track);
  }

  close(): void {
    this.app.closeWorkshop(this.window);
  }

  /** Picks this sound for the ring in focus, or opens its window if it is picked already or not made yet. */
  use(): void {
    const settings = trackOf(this.app.project, this.app.selected);
    if (!settings[this.field] || settings.sound === this.sound) this.open();
    else this.app.rings.setSound(this.app.selected, this.sound);
  }
}
