import { clamp, currentScene, emptyStep, MAX_CHORDS } from "../model";
import type { App } from "./app";

/*
 * The chords around the hub: one a bar.
 */
export class ChordDesk {
  /** The bar whose chord menu is open. */
  openSlot: number | null = null;

  constructor(private readonly app: App) {}

  open(slot: number): void {
    this.openSlot = this.openSlot === slot ? null : slot;
    this.app.notify();
  }

  close(): void {
    if (this.openSlot === null) return;
    this.openSlot = null;
    this.app.notify();
  }

  set(slot: number, degree: number): void {
    this.app.store.edit((project) => { currentScene(project).chords[slot] = clamp(degree, 0, 6); });
    void this.app.engine.audition(5, { ...emptyStep(), on: true, len: 4 }, degree);
  }

  /** A new bar before `slot`, with the chord that is there. */
  insertBar(slot: number): void {
    const chords = currentScene(this.app.project).chords;
    if (chords.length >= MAX_CHORDS || chords[slot] === undefined) return;
    this.app.store.edit((project) => {
      const list = currentScene(project).chords;
      list.splice(slot, 0, list[slot] ?? 0);
    });
  }

  removeBar(slot: number): void {
    const chords = currentScene(this.app.project).chords;
    if (chords.length <= 1 || chords[slot] === undefined) return;
    this.app.store.edit((project) => { currentScene(project).chords.splice(slot, 1); });
    this.close();
  }

  setBars(count: number): void {
    const target = clamp(count, 1, MAX_CHORDS);
    this.app.store.edit((project) => {
      const chords = currentScene(project).chords;
      while (chords.length < target) chords.push(chords[chords.length - 1] ?? 0);
      chords.length = target;
    });
    if (this.openSlot !== null) this.openSlot = Math.min(this.openSlot, target - 1);
  }
}
