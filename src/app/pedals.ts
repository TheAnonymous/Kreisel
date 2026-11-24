import { patternOf, trackInfo, trackOf, type Pedals } from "../model";
import { chainsFor, chainWorn, cleanPedals, crestText, describeChain, diceChain, noPedals, pedalsOf, sweeps, takesPedals, wearChain } from "../pedals";
import type { App } from "./app";

/*
 * The pedals of the ring in focus: the board that shows them, changing one
 * of them, putting on one of the ring's chains (by choice or by the dice),
 * taking them all off, and setting where a sweep has its top.
 */
export class PedalDesk {
  /** Whether the board is open (it shows the ring in focus, and stays open when another ring is picked). */
  open = false;
  /** The board was just asked for (by its button or its key): whoever shows it takes the focus there, once. */
  asked = false;

  constructor(private readonly app: App) {}

  /** Whether the ring in focus can have pedals: every ring but the kick. */
  get fits(): boolean {
    return takesPedals(this.app.selected);
  }

  /** The pedals of the ring in focus, or a fresh board where it has none. */
  get current(): Pedals {
    return pedalsOf(trackOf(this.app.project, this.app.selected));
  }

  /** What the ring in focus passes, in order, as one line. */
  get chain(): string {
    return describeChain(trackOf(this.app.project, this.app.selected));
  }

  /** Which of its chains the ring in focus wears; −1 for none of them. */
  get worn(): number {
    return chainWorn(this.app.selected, trackOf(this.app.project, this.app.selected));
  }

  toggle(): void {
    // Only where the board can show: on a ring that takes pedals, in focus and not covered. (Else it would lie in wait and come up, with the focus, at the next ring.)
    if (!this.open && (!this.fits || this.app.focus !== "ring" || this.app.relay.veiled(this.app.selected))) return;
    this.open = !this.open;
    this.asked = this.open;
    if (this.open) this.app.rings.paletteOpen = false;
    this.app.notify();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.app.notify();
  }

  /**
   * Changes the pedals of the ring in focus; changes with the same `key` in quick succession are one step back.
   * A board on which nothing is on any more is taken off the ring.
   */
  set(change: Partial<Pedals>, key?: string): void {
    const track = this.app.selected;
    if (!takesPedals(track) || this.app.relay.refuse(track)) return;
    const before = pedalsOf(trackOf(this.app.project, track));
    const wanted = { ...before, ...change };
    // A modulation that is switched on is heard: one without any depth gets what a fresh board has.
    if (change.mod !== undefined && change.mod > 0 && wanted.depth === 0) wanted.depth = noPedals().depth;
    const next = cleanPedals(wanted);
    this.app.store.edit((project) => {
      const settings = trackOf(project, track);
      if (next) settings.pedals = next;
      else delete settings.pedals;
    }, key ? `pedal-${key}${track}` : undefined);
    // A choice is heard at once; an amount is heard while it is moved, as the ring plays or at the next note.
    if (change.tone !== undefined || change.mod !== undefined || change.first !== undefined) this.app.rings.preview(track);
  }

  /** Puts one of the board's amounts back where a fresh board has it. */
  reset(field: "crush" | "depth" | "crest"): void {
    this.set({ [field]: noPedals()[field] });
  }

  /** Puts chain `index` of the ring in focus on it: its drive, its reverb and echo, and its pedals. */
  wear(index: number): void {
    const track = this.app.selected;
    const preset = chainsFor(track)[index];
    if (!preset || this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => wearChain(trackOf(project, track), preset));
    this.app.rings.preview(track);
    this.app.say(`${trackInfo(track).name}: “${preset.name}”. ${describeChain(trackOf(this.app.project, track))}.`, this.app.takeBack);
  }

  /** One of the ring's chains by the dice: any but the one it wears. */
  dice(track = this.app.selected): void {
    if (!takesPedals(track)) return;
    if (track !== this.app.selected) this.app.select(track);
    this.wear(diceChain(track, chainWorn(track, trackOf(this.app.project, track)), this.app.random));
  }

  /** Takes everything off the ring in focus: no drive, no pedals. Its reverb and echo stay as they are, behind nothing. */
  strip(): void {
    const track = this.app.selected;
    if (!takesPedals(track) || this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const settings = trackOf(project, track);
      settings.drive = 0;
      delete settings.pedals;
    });
    this.app.rings.preview(track);
    this.app.say(`${trackInfo(track).name}: no pedals.`, this.app.takeBack);
  }

  /** Whether ring `track` has a sweep, and so a crest that can be put somewhere. */
  sweeps(track: number): boolean {
    const pedals = trackOf(this.app.project, track).pedals;
    return takesPedals(track) && pedals !== undefined && sweeps(pedals.mod);
  }

  /** Puts the top of ring `track`'s sweep on step `step` of its round. */
  crestAt(track: number, step: number): void {
    const pedals = trackOf(this.app.project, track).pedals;
    if (!pedals || !this.sweeps(track) || this.app.relay.refuse(track)) return;
    const next = cleanPedals({ ...pedals, crest: step });
    if (!next) return;
    this.app.store.edit((project) => { trackOf(project, track).pedals = next; });
    this.app.say(`${trackInfo(track).name}: the sweep now peaks on ${crestText(step, patternOf(this.app.project, track).len)}.`, this.app.takeBack);
  }
}
