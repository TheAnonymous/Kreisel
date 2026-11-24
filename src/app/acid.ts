import { cleanAcid, firstAcid, lenToTie, nextHit, takesAcid, tiesInto } from "../acid";
import { ACID_SOUND, clamp, currentScene, MAX_NOTE_LENGTH, patternOf, stepAt, trackOf, WEATHER_MAX, type Acid } from "../model";
import type { App } from "./app";

/** Sun is the second kind of weather (see src/weather.ts): what lies under it sounds brighter. */
const SUN = 1;
/** One step a bar, in the quarter steps the wind is counted in: a ring of sixteen steps is round once in sixteen bars. */
const RIDE_WIND = 4;

/*
 * The acid machine of the ring in focus: switching it on, its bite, its
 * decay and its wave, tying one note into the next, and the filter ride.
 */
export class AcidDesk {
  constructor(private readonly app: App) {}

  /** Whether the ring in focus can have a machine: the bass, and the melody. */
  get fits(): boolean {
    return takesAcid(this.app.selected);
  }

  /** The machine of the ring in focus, if it has one. */
  get current(): Acid | null {
    return trackOf(this.app.project, this.app.selected).acid;
  }

  /** The ring in focus plays its machine right now. */
  get on(): boolean {
    return trackOf(this.app.project, this.app.selected).sound === ACID_SOUND;
  }

  /** Switches the ring in focus to its machine. A ring that never had one gets one fresh out of the box, with the filter half open and ringing. */
  use(): void {
    const track = this.app.selected;
    if (!takesAcid(track) || this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const settings = trackOf(project, track);
      if (!settings.acid) Object.assign(settings, { acid: firstAcid(), x: 0.45, y: 0.65 });
      settings.sound = ACID_SOUND;
    });
    this.app.rings.preview(track);
  }

  /** Changes the machine of the ring in focus; changes with the same `key` in quick succession are one step back. */
  shape(change: Partial<Acid>, key?: string): void {
    const track = this.app.selected;
    const acid = trackOf(this.app.project, track).acid;
    if (!acid || this.app.relay.refuse(track)) return;
    const next = cleanAcid({ ...acid, ...change });
    if (next.bite === acid.bite && next.decay === acid.decay && next.square === acid.square) return;
    this.app.store.edit((project) => { trackOf(project, track).acid = next; }, key ? `acid-${key}${track}` : undefined);
    if (change.square !== undefined) this.app.rings.preview(track);
  }

  /** Puts one of the machine's two amounts back where a machine fresh out of the box has it. */
  reset(field: "bite" | "decay"): void {
    this.shape({ [field]: firstAcid()[field] });
  }

  /** Whether the hit at `index` of ring `track` is held into the hit after it, as the ring's sound holds notes at this tempo. */
  tied(track: number, index: number): boolean {
    const pattern = patternOf(this.app.project, track);
    const next = nextHit(pattern, index);
    const step = stepAt(pattern, index);
    return Boolean(step.on && next && tiesInto(trackOf(this.app.project, track).sound, step.len, next.distance, 15 / this.app.project.bpm));
  }

  /**
   * Ties the hit at `index` into the next one, or lets go of it again. Tied,
   * it is as long as it takes to reach into the next hit; let go, it ends
   * where the next one begins at the latest.
   */
  tie(track: number, index: number): void {
    if (this.app.relay.refuse(track)) return;
    const pattern = patternOf(this.app.project, track);
    const next = nextHit(pattern, index);
    if (!stepAt(pattern, index).on || !next) return;
    // Let go, a machine's note may end where the next begins; any other sound's has to end a step before that.
    const loose = trackOf(this.app.project, track).sound === ACID_SOUND ? next.distance : Math.max(1, next.distance - 1);
    const len = this.tied(track, index) ? Math.min(stepAt(pattern, index).len, loose) : lenToTie(next.distance);
    this.app.store.edit((project) => { stepAt(patternOf(project, track), index).len = clamp(len, 1, MAX_NOTE_LENGTH); });
  }

  /**
   * The filter ride: lays a hill of sun over the ring in focus and lets it
   * drift one step a bar, so that the filter opens and closes by itself, once
   * in as many bars as the ring has steps. What was there of sun on this ring
   * is painted over.
   */
  ride(): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const length = patternOf(this.app.project, track).len;
    this.app.store.edit((project) => {
      const scene = currentScene(project);
      const line = scene.weather[SUN]?.[track];
      if (!line) return;
      line.fill(0);
      for (let step = 0; step < length; step += 1) line[step] = Math.round((WEATHER_MAX - 2) * Math.sin((Math.PI * step) / length) ** 2);
      scene.wind[SUN] = RIDE_WIND;
    });
    this.app.say(`Filter ride: sun drifts across the ring and opens the filter, one round in ${length} bars. You can repaint it under “Weather”.`, this.app.takeBack);
  }
}
