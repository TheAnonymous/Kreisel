import { cleanVoice, diceLine, mouthOf, shape, sing, syllables, VOWELS } from "../voice";
import { VOICE_SOUND, trackOf, type Voice, wrap } from "../model";
import type { App } from "./app";
import { WorkshopDesk } from "./workshop";

/*
 * The voice: a ring that sings a typed line, a syllable a hit. The window
 * over the wheel is where the line is written.
 */
export class VoiceDesk extends WorkshopDesk<"voice"> {
  /** Counts the times a line was sung through, so a newer one stops an older one. */
  private lineRun = 0;

  constructor(app: App) {
    super(app, "voice", VOICE_SOUND, "voice");
  }

  protected first(): Voice {
    return cleanVoice({ text: diceLine(this.app.random) });
  }

  /** Changes the voice of the ring in focus; changes with the same `key` in quick succession are one step back. */
  shape(change: Partial<Voice>, key?: string): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const voice = trackOf(this.app.project, track).voice;
    if (!voice) return;
    const next = cleanVoice({ ...voice, ...change });
    if (JSON.stringify(next) === JSON.stringify(voice) && trackOf(this.app.project, track).sound === VOICE_SOUND) return;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), { voice: next, sound: VOICE_SOUND }); }, key ? `${key}${track}` : undefined, key === "text" ? 2500 : undefined);
  }

  dice(): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const voice = trackOf(this.app.project, track).voice;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), { voice: cleanVoice({ ...voice, text: diceLine(this.app.random, voice?.text) }), sound: VOICE_SOUND }); });
    this.singLine();
  }

  /** Sings the whole line once, syllable by syllable, on the ring's note: to hear what was written. */
  singLine(): void {
    const track = this.app.selected;
    const voice = trackOf(this.app.project, track).voice;
    if (!voice || this.app.relay.veiled(track)) return;
    const count = Math.max(1, syllables(voice.text).length);
    this.lineRun += 1;
    const run = this.lineRun;
    for (let number = 0; number < count; number += 1) {
      setTimeout(() => {
        // A newer line, or the Kreisel itself, has taken over.
        if (run !== this.lineRun || this.app.playing) return;
        this.app.rings.strike(track, number);
      }, number * 250);
    }
  }

  /** The mouth of the voice that sounds right now, for drawing it: how open, how wide, how much. */
  mouth(): { open: number; wide: number; amount: number } | null {
    let best: { open: number; wide: number; amount: number } | null = null;
    let soonest = 0.5;
    this.app.project.tracks.forEach((track, index) => {
      if (track.sound !== VOICE_SOUND || !track.voice || !this.app.audible(index)) return;
      const since = this.app.sinceStruck(index);
      if (since < -0.02 || since >= soonest) return;
      soonest = since;
      const line = syllables(track.voice.text);
      const number = this.app.engine.sung[index] ?? 0;
      const which = line.length > 0 ? wrap(number, line.length) : 0;
      const syllable = line[which];
      const sung = syllable ? sing(syllable, line[which + 1] ?? null) : null;
      const formants = shape(sung && !sung.mute ? sung.vowel : (VOWELS.a ?? [750, 1250, 2500]), track.voice, track.x, track.y);
      best = { ...mouthOf(formants), amount: sung?.mute ? 0.15 : Math.max(0, 1 - Math.max(0, since - 0.12) / 0.38) };
    });
    return best;
  }
}
