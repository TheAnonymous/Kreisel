import { canRecord, startTake, type Take } from "../audio/record";
import { decodeSound, forgetSound, readySound, soundOf, spareSounds, takeSound, type Ready } from "../audio/sample";
import { foundSound, loadSound, lostSound, quest, renderRecipe, soundState, type SoundState } from "../audio/sample-bank";
import { BUNDLE_ENDING, isBundle, packBundle, unpackBundle } from "../bundle";
import { decodeLink, encodeLink } from "../codec";
import { clone, currentScene, emptyRumble, emptyStep, patternOf, SAMPLE_SOUND, trackInfo, trackOf, type Project, type Sample } from "../model";
import { NOTE_NAMES } from "../music";
import { activeSteps } from "../patterns";
import { projectOf, recipeDepth, recipeOf, recipeSteps, selfContained } from "../resample";
import { cleanSample, DEEPEST_RECIPE, firstSample, MAX_RECIPE, MAX_SECONDS, secondsText, SLICES } from "../sample";
import { pitchOf, semitonesFrom, shapeOf, soundSpan } from "../sample-analysis";
import { encodeWav16, sampleName, sniff, type Pcm } from "../sample-files";
import { askToKeep, dropRecording, idOf, idOfText, keepRecording, listRecordings, recordingOf, type Listed, type Recording } from "../sample-store";
import type { App } from "./app";
import { download } from "./files";

/**
 * A file bigger than this is not read: it is no sample but an album. A file that packs its sound small (MP3, Ogg,
 * Opus, AAC) gets less: eight megabytes of it are a quarter of an hour, which decoded would be half a gigabyte. A
 * Kreisel's own file holds several recordings and may be as big as a few of them together.
 */
const BIGGEST = 24 * 1024 * 1024;
const BIGGEST_PACKED = 8 * 1024 * 1024;
const BIGGEST_BUNDLE = 96 * 1024 * 1024;
const PACKED: ReadonlySet<string> = new Set(["mp3", "ogg-vorbis", "ogg-opus", "ogg", "mp4", "aac", "webm"]);
/** A recording quieter than this at its loudest is silence. */
const SILENT = 1e-4;
/** A pitch found this surely is tuned to. */
const SURE = 0.8;

/** How loud a stretch of sound is over all of its length: the root mean square of all its channels. */
function loudness(pcm: Pcm): number {
  let sum = 0;
  let count = 0;
  for (const channel of pcm.channels) {
    for (const value of channel) sum += value * value;
    count += channel.length;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** What giving a recording to a ring does to the Kreisel, and what is said about it. */
interface Laid {
  sample: Sample;
  change(project: Project): void;
  said: string;
}

/** How a recording is laid on a ring. */
interface Laying {
  /** What is said of where it comes from: "WAV", "a take", "this ring, resampled". */
  about: string;
  /** The ring's own hits stay where they are (a ring resampled onto itself), instead of a hit on every step. */
  keepHits?: boolean;
  /** The ring starts clean: what was on it is in the recording now. */
  clean?: boolean;
  /** Its recipe stays on the sample, so that it travels in a link. */
  carry?: boolean;
}

/*
 * The sample of the ring in focus: the side of the panel it is made on,
 * bringing a recording in (a file, the microphone, the Kreisel itself),
 * shaping how it is played, and the recordings this browser keeps.
 *
 * Two of the page's words differ from the names here: playing a recording
 * whole at every hit is the mode HIT here and "One-shot" on the page, and
 * `press` (the Kreisel's own sound laid on a ring) is "Resample" there.
 */
export class SampleDesk {
  /** The recordings this browser keeps, the newest first. */
  kept: Listed[] = [];
  /** The recording that is being made at the microphone. */
  take: Take | null = null;
  /** What takes a moment right now, in words; `null` when nothing does. */
  busy: string | null = null;
  /** Whether the sampler's side of the ring's panel is turned up (it shows the ring in focus, and stays when another ring is picked). */
  open = false;
  /** It was just asked for (by its button or its key): whoever shows it takes the focus there, once. */
  asked = false;
  /** The recordings that were got ready already, so that each is asked for once. */
  private readonly sought = new Set<string>();
  /** The microphone was asked for and has not answered yet. */
  private starting = false;
  /** The recordings a Kreisel plays that this browser was found not to have: said once, together, a moment after the Kreisel came. */
  private readonly gone: string[] = [];

  constructor(private readonly app: App) {}

  /** The sample of the ring in focus, if it has one. */
  get current(): Sample | undefined {
    return trackOf(this.app.project, this.app.selected).sample;
  }

  /** Whether the ring in focus has a sample, and whether its recording is ready, on its way, or not in this browser. */
  get state(): "none" | SoundState {
    const sample = this.current;
    return sample ? soundState(sample.id) : "none";
  }

  /** The recording of the ring in focus, when it is ready. */
  get sound(): Ready | undefined {
    const sample = this.current;
    return sample ? readySound(sample.id) : undefined;
  }

  /** Whether this browser can record at all. */
  get canRecord(): boolean {
    return canRecord();
  }

  /** Turns the ring's panel over to its sampler, or back. */
  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    // It belongs to a ring: the one last in focus, also while the piece or the weather is.
    if (this.app.focus !== "ring") this.app.select(this.app.selected);
    // Only where it can show: on a ring that is not covered.
    if (this.app.focus !== "ring" || this.app.relay.veiled(this.app.selected)) return;
    this.open = true;
    this.asked = true;
    this.app.pedals.open = false;
    this.app.rings.paletteOpen = false;
    void this.list();
    this.app.notify();
  }

  close(): void {
    if (!this.open) return;
    this.shut();
    this.app.notify();
  }

  /** Puts the sampler's side away without a word to the page (whoever turns the panel to something else says it). A take that was running is not kept: nobody is there to end it. */
  shut(): void {
    this.open = false;
    const take = this.take;
    if (!take) return;
    this.take = null;
    void take.stop();
    this.say("The take was not kept.");
  }

  /** Picks the sample for the ring in focus, or turns the panel over to the sampler if it is picked already or there is none yet. */
  use(): void {
    const settings = trackOf(this.app.project, this.app.selected);
    if (settings.sample && settings.sound !== SAMPLE_SOUND) this.app.rings.setSound(this.app.selected, SAMPLE_SOUND);
    else if (!this.open) this.toggle();
  }

  /**
   * The Kreisel has changed: every recording its rings name is got ready, once. (A ring's sample only names its
   * recording; the sound is in the browser's store, or is made again from its recipe.) Both the Kreisel on the table
   * and the one in view count: while an earlier turn of a round is looked at, its rings play too.
   */
  refresh(): void {
    const tracks = [...new Set([this.app.store.project, this.app.project])].flatMap((project) => project.tracks);
    const named = new Set(tracks.flatMap((track) => (track.sample ? [track.sample.id] : [])));
    // What no ring names any more is let go (all but the last few), and looked for again if a ring names it once more.
    for (const id of spareSounds(named)) this.sought.delete(id);
    // One Kreisel, one allowance of recipes that are played for it.
    const on = quest();
    for (const track of tracks) {
      const sample = track.sample;
      if (!sample || this.sought.has(sample.id) || readySound(sample.id)) continue;
      this.sought.add(sample.id);
      void loadSound(sample, on).then((made) => {
        if (!made && track.sound === SAMPLE_SOUND) this.lost(sample.name);
        this.app.notify();
      });
    }
  }

  private lost(name: string): void {
    if (this.gone.length === 0) {
      setTimeout(() => {
        const names = this.gone.splice(0);
        const told = names.slice(0, 3).map((one) => `“${one}”`).join(", ");
        this.say(`This Kreisel plays ${names.length === 1 ? `a recording this browser does not have (${told})` : `${names.length} recordings this browser does not have (${told}${names.length > 3 ? " …" : ""})`}: ${names.length === 1 ? "that ring is" : "those rings are"} silent. Load the sound again in the ring's sampler, or open the Kreisel's own file.`);
      }, 1500);
    }
    if (!this.gone.includes(name)) this.gone.push(name);
  }

  /** The names of the recordings the Kreisel's rings play that a link cannot bring along: files and takes, not what was resampled from the Kreisel. */
  loose(): string[] {
    return [...new Set(this.app.project.tracks.flatMap((track) => (track.sample && track.sound === SAMPLE_SOUND && track.sample.recipe === undefined ? [track.sample.name] : [])))];
  }

  private say(text: string, undo = false): void {
    this.app.say(text, undo ? this.app.takeBack : undefined);
  }

  private async working<T>(what: string, work: () => Promise<T>): Promise<T | null> {
    if (this.busy !== null) return null;
    this.busy = what;
    this.app.notify();
    try {
      return await work();
    } catch (error) {
      this.say(error instanceof Error && error.message ? error.message : "That did not work.");
      return null;
    } finally {
      this.busy = null;
      this.app.notify();
    }
  }

  /**
   * Brings a file in: a sound for the ring in focus, or a Kreisel's own file with its recordings. `note` is said
   * with it ("the first of 3 files").
   */
  async bring(file: Blob, name = "sample", note = ""): Promise<void> {
    const called = sampleName(name);
    const tooBig = (): void => this.say(`“${called}” is too big for a ring (${Math.round(file.size / 1_048_576)} MB). A sample is a few seconds of sound: cut out the part you want and load that.`);
    try {
      if (isBundle(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) {
        if (file.size > BIGGEST_BUNDLE) this.say(`“${called}” is too big to open (${Math.round(file.size / 1_048_576)} MB).`);
        else await this.openBundle(await file.arrayBuffer());
        return;
      }
      if (file.size > BIGGEST) {
        tooBig();
        return;
      }
      const bytes = await file.arrayBuffer();
      const kind = sniff(new Uint8Array(bytes));
      if (PACKED.has(kind.format) && file.size > BIGGEST_PACKED) {
        tooBig();
        return;
      }
      await this.adopt(bytes, called, "file", note ? `${kind.label}, ${note}` : kind.label);
    } catch {
      this.say(`“${called}” could not be read.`);
    }
  }

  /** The first sound among files that were picked. */
  async bringFiles(files: Iterable<File>): Promise<void> {
    const [first, ...more] = files;
    if (first) await this.bring(first, first.name, more.length > 0 ? `the first of ${more.length + 1} files` : "");
  }

  /** Reads a sound, keeps it, and gives it to the ring that was in focus when it came. */
  private async adopt(bytes: ArrayBuffer, name: string, source: Recording["source"], about: string): Promise<void> {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const table = this.app.store.project;
    await this.working("Reading the sound …", async () => {
      let pcm: Pcm;
      try {
        pcm = await decodeSound(bytes);
      } catch (error) {
        throw new Error(`“${name}” could not be loaded. ${error instanceof Error ? error.message : ""}`.trim());
      }
      const id = await idOf(bytes);
      const back = soundState(id) === "missing";
      const made = takeSound(id, pcm);
      foundSound(id);
      const how = await keepRecording({ id, name, kind: about.split(",")[0] ?? about, source, bytes, seconds: made.seconds, added: Date.now() });
      void askToKeep();
      await this.list();
      // Another Kreisel has come onto the table meanwhile: the recording is kept, and nothing of that Kreisel is touched.
      if (this.app.store.project !== table) throw new Error(`“${name}” is kept, but the Kreisel changed while it was read: nothing was put on a ring.`);
      // A recording that was missing is back: the rings that name it play again as they were set, the one in focus too.
      if (back && trackOf(this.app.project, track).sample?.id === id) {
        this.say(`“${name}” is back: ${trackInfo(track).name} plays it again as it was set.`);
        return;
      }
      const cut = (pcm.channels[0]?.length ?? 0) / pcm.sampleRate > MAX_SECONDS;
      this.give(track, firstSample(id, name), made, { about: `${about}${cut ? `, cut to its first ${MAX_SECONDS} seconds` : ""}` }, how === "kept" ? "" : " This browser keeps it only until the page is closed.");
    });
  }

  /**
   * How a ready recording is laid on a ring so that it plays at once and in time. A single sound is a one-shot: the
   * silence before and after it is left out, and on a ring that plays notes a clear pitch is tuned to the key. A loop
   * lies around the ring in slices: the ring is made as long as the loop has steps and gets a hit on every step, so
   * that it plays through. A recording resampled from the Kreisel is exactly its steps, nothing left out.
   */
  private lay(track: number, fresh: Sample, made: Ready, how: Laying): Laid | null {
    const project = this.app.project;
    const info = trackInfo(track);
    const mono = soundOf(made);
    const rate = made.buffer.sampleRate;
    const pattern = patternOf(project, track);
    const recipe = fresh.recipe === undefined ? null : projectOf(fresh.recipe);
    const shape = recipe ? { from: 0, to: mono.length, loop: null } : shapeOf(mono, rate, project.bpm);
    const sample = { ...fresh, from: shape.from / mono.length, to: shape.to / mono.length };
    let said = "plays as a one-shot";
    let steps: number | null = null;
    if (recipe) {
      steps = recipeSteps(recipe);
      sample.mode = SLICES;
      said = `lies around the ring in ${steps} slices`;
    } else if (shape.loop) {
      // A loop: so many bars. A ring holds two bars at most: of a longer loop its first two are taken.
      const bars = Math.min(2, shape.loop.bars);
      sample.mode = SLICES;
      sample.to = sample.from + ((sample.to - sample.from) * bars) / shape.loop.bars;
      steps = bars * 16;
      said = `lies around the ring in ${steps} slices (${shape.loop.bars > bars ? `the first ${bars} of its ${shape.loop.bars} bars` : bars === 1 ? "1 bar" : `${bars} bars`}${Math.abs(shape.loop.bpm - project.bpm) > 1 ? `; its own tempo is about ${Math.round(shape.loop.bpm)}` : ""})`;
    } else if (info.melodic) {
      const pitch = pitchOf(mono.subarray(shape.from, shape.to), rate);
      if (pitch && pitch.clarity >= SURE) {
        sample.tune = -Math.round(semitonesFrom(pitch.hz, project.root) * 100) / 100;
        said = `plays as a one-shot, tuned to ${NOTE_NAMES[project.root] ?? "the key"}`;
      }
    }
    const next = cleanSample(sample);
    if (!next) return null;
    if (how.carry === false) delete next.recipe;
    const length = steps;
    const hits = activeSteps(pattern).length;
    const everyStep = length !== null && (!how.keepHits || hits === 0);
    // What happens to the ring's own hits is said: nobody should find a pattern gone without a word.
    if (length !== null && everyStep && hits > 0 && (hits !== length || pattern.len !== length)) said += `; the ring's own hits gave way to a hit on every step`;
    else if (length !== null && !everyStep) said += "; the ring's hits drop the needle where they lie";
    const seconds = ((next.to - next.from) * mono.length) / rate;
    return {
      sample: next,
      said: `${info.name}: “${next.name}” (${how.about}, ${secondsText(seconds)}) ${said}.`,
      change: (edited) => {
        const settings = trackOf(edited, track);
        settings.sample = { ...next };
        settings.sound = SAMPLE_SOUND;
        // A recording is first heard as it is: the pad in the middle (no filter) and in its upper half (it plays out).
        settings.x = 0.5;
        settings.y = Math.max(settings.y, 0.5);
        if (how.clean) {
          // The ring's drive, pedals, reverb, echo and weather are in the recording already: the ring starts clean.
          Object.assign(settings, { drive: 0, hall: 0, echo: 0 });
          delete settings.pedals;
          const scene = currentScene(edited);
          for (const kind of scene.weather) kind[track]?.fill(0);
          // The kick's has its hardness and its Nachbeben in it: bounced to one sound, as the genre does it.
          if (track === 0) {
            edited.hard = 0;
            scene.rumble = emptyRumble();
          }
        }
        if (length === null) return;
        const ring = patternOf(edited, track);
        ring.len = length;
        // A hit on every step: the recording plays through, and taking hits away chops it. A ring resampled onto itself
        // keeps its hits where they lie, but plain: how loud, how often and how high each was is in the recording, and
        // in slices a hit's place across the ring would pick another slice.
        ring.steps.forEach((step, index) => Object.assign(step, index < length && (everyStep || step.on) ? { ...emptyStep(), on: true } : emptyStep()));
      },
    };
  }

  /** Gives a ready recording to a ring, as one step that can be taken back. */
  private give(track: number, fresh: Sample, made: Ready, how: Laying, after = ""): void {
    const laid = this.lay(track, fresh, made, how);
    if (!laid) return;
    this.app.store.edit(laid.change);
    this.app.rings.preview(track);
    this.say(`${laid.said}${after}`, true);
  }

  /** Changes how the sample of the ring in focus is played; changes with the same `key` in quick succession are one step back. */
  shape(change: Partial<Sample>, key?: string): void {
    const track = this.app.selected;
    const sample = trackOf(this.app.project, track).sample;
    if (!sample || this.app.relay.refuse(track)) return;
    const next = cleanSample({ ...sample, ...change });
    if (!next) return;
    this.app.store.edit((project) => { trackOf(project, track).sample = next; }, key ? `sample-${key}${track}` : undefined);
    // A choice is heard at once; an amount is heard at the next hit, or when the slider is let go.
    if (key === undefined) this.app.rings.preview(track);
  }

  /** Puts one of the sample's amounts back where a fresh one has it. */
  reset(field: "tune" | "gain" | "from" | "to" | "stretch"): void {
    this.shape({ [field]: firstSample("", "")[field] });
  }

  /** Leaves out the silence before and after the sound. */
  trim(): void {
    const made = this.sound;
    const sample = this.current;
    if (!made || !sample) return;
    const mono = soundOf(made);
    const span = soundSpan(mono, made.buffer.sampleRate);
    const [from, to] = [span.from / mono.length, span.to / mono.length];
    if (Math.abs(from - sample.from) < 1e-4 && Math.abs(to - sample.to) < 1e-4) {
      this.say("There is no silence left to trim.");
      return;
    }
    this.shape({ from, to });
    this.say(`Trimmed: it plays from ${secondsText(from * made.seconds)} to ${secondsText(to * made.seconds)}.`, true);
  }

  /** Tunes the sample to the key: its own pitch is found and moved onto the nearest note of the key's name. */
  tuneToKey(): void {
    const made = this.sound;
    const sample = this.current;
    if (!made || !sample) return;
    const mono = soundOf(made);
    const pitch = pitchOf(mono.subarray(Math.round(sample.from * mono.length), Math.round(sample.to * mono.length)), made.buffer.sampleRate);
    const note = NOTE_NAMES[this.app.project.root] ?? "the key";
    if (!pitch || pitch.clarity < SURE) {
      this.say(`“${sample.name}” has no clear pitch to tune (a drum, a noise, or several notes at once). Tune it by ear with the slider.`);
      return;
    }
    const tune = -Math.round(semitonesFrom(pitch.hz, this.app.project.root) * 100) / 100;
    this.shape({ tune });
    this.say(`Tuned to ${note}: ${Math.abs(tune) < 0.005 ? "it was in tune already" : `${Math.abs(tune).toFixed(2)} semitones ${tune > 0 ? "up" : "down"}`}.`, true);
  }

  /** A hit on every step of the ring in focus: the recording plays through from its first slice to its last. */
  layOut(): void {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const pattern = patternOf(project, track);
      pattern.steps.forEach((step, index) => Object.assign(step, index < pattern.len ? { ...emptyStep(), on: true } : emptyStep()));
    });
    this.say("A hit on every step: the recording plays through. Take hits away to chop it.", true);
  }

  /** Takes the recording off the ring in focus: the ring plays its first sound again, and the browser keeps the recording. */
  remove(): void {
    const track = this.app.selected;
    const sample = trackOf(this.app.project, track).sample;
    if (!sample || this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const settings = trackOf(project, track);
      delete settings.sample;
      if (settings.sound === SAMPLE_SOUND) settings.sound = 0;
    });
    this.app.rings.preview(track);
    this.say(`“${sample.name}” is off ${trackInfo(track).name}. The browser still keeps it.`, true);
  }

  /** Starts a recording at the microphone, or ends the one that runs and gives it to the ring in focus. */
  async record(): Promise<void> {
    const take = this.take;
    if (take) {
      this.take = null;
      this.app.notify();
      const blob = await take.stop();
      if (!blob || take.seconds() < 0.15) {
        this.say("Nothing was recorded.");
        return;
      }
      const number = this.kept.filter((item) => item.source === "microphone").length + 1;
      await this.adopt(await blob.arrayBuffer(), `take ${number}`, "microphone", "a take");
      return;
    }
    // One press, one take: a second press while the browser still asks for the microphone starts nothing more.
    if (this.starting || this.busy !== null) return;
    if (!canRecord()) {
      this.say("This browser gives no microphone here.");
      return;
    }
    // What the Kreisel plays would be in the recording: it stops.
    if (this.app.playing) this.app.engine.stop();
    this.starting = true;
    try {
      // A take that runs to its longest ends itself, if it is still the one that runs.
      const begun: Take = await startTake(() => { if (this.take === begun) void this.record(); });
      // The sampler was put away while the browser asked: nobody is there to end the take.
      if (!this.open) {
        void begun.stop();
        return;
      }
      this.take = begun;
      this.app.notify();
      this.say("Recording. Make your sound, then press “Stop”.");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      this.say(name === "NotAllowedError" || name === "SecurityError" ? "Without a microphone nothing can be recorded. Allow it in the address bar, then it works." : "The microphone could not be opened.");
    } finally {
      this.starting = false;
    }
  }

  /**
   * Resamples: what the Kreisel plays is laid on the ring in focus as a recording, as it sounds now. With `alone`,
   * the ring itself, one turn of it, with its pedals and its weather (the ring frozen: its hits stay where they lie);
   * otherwise everything that is heard, for a bar or two (whoever is muted is left out), with a hit on every step.
   * The ring that takes it starts clean (what was on it is in the recording now), and the recording is made as loud
   * on the ring as what it was made from. Its sample carries the recipe, so it travels in a link.
   */
  async press(alone: boolean): Promise<void> {
    const track = this.app.selected;
    if (this.app.relay.refuse(track)) return;
    const table = this.app.store.project;
    const what = alone ? trackInfo(track).name : "The wheel";
    const recipe = recipeOf(this.app.project, (ring) => (alone ? ring === track : this.app.audible(ring)), Number.POSITIVE_INFINITY);
    await this.working("Resampling …", async () => {
      const pcm = recipe ? await renderRecipe(recipe) : null;
      if (!pcm || !recipe) throw new Error("This could not be resampled: one of the rings plays a recording this browser does not have.");
      if (!pcm.channels.some((channel) => channel.some((value) => Math.abs(value) > SILENT))) throw new Error(`${what} plays nothing in this scene: there is nothing to resample.`);
      // A recipe travels in the link. One that is too long for that, goes deeper than a recording is made again (a
      // resample of a resample of a resample …) or needs a file's sound stays behind: then the recording is kept by
      // this browser under the name of its own sound, like a file's.
      const source = projectOf(recipe);
      const travels = recipe.length <= MAX_RECIPE && recipeDepth(recipe) <= DEEPEST_RECIPE && source !== null && selfContained(source);
      const bytes = encodeWav16(pcm).buffer;
      const id = travels ? await idOfText(recipe) : await idOf(bytes);
      const made = takeSound(id, pcm);
      foundSound(id);
      const name = `resample ${this.kept.filter((item) => item.source === "kreisel").length + 1}`;
      await keepRecording({ id, name, kind: "WAV", source: "kreisel", bytes, seconds: made.seconds, added: Date.now(), ...(travels ? { recipe } : {}) });
      await this.list();
      if (this.app.store.project !== table) throw new Error(`“${name}” is kept, but the Kreisel changed while it was made: nothing was put on a ring.`);
      // Laid by its recipe (so many steps, nothing left out) either way; only a recipe that travels stays on the sample.
      const laid = this.lay(track, { ...firstSample(id, name, SLICES), recipe }, made, { about: `${alone ? "this ring" : "the wheel"}, resampled`, keepHits: alone, clean: true, carry: travels });
      if (!laid) return;
      // As loud on the ring as what it was made from: the ring with the recording is played by itself once, on a copy
      // of the Kreisel, and the sample's level is set by what comes out. Then all of it is one step.
      const draft = clone(this.app.project);
      laid.change(draft);
      const alike = recipeOf(draft, (ring) => ring === track, Number.POSITIVE_INFINITY);
      const heard = alike ? await renderRecipe(alike) : null;
      const [was, now] = [loudness(pcm), heard ? loudness(heard) : 0];
      const level = now > 1e-5 && was > 1e-5 ? cleanSample({ ...laid.sample, gain: laid.sample.gain * (was / now) }) : undefined;
      if (this.app.store.project !== table) throw new Error(`“${name}” is kept, but the Kreisel changed while it was made: nothing was put on a ring.`);
      this.app.store.edit((project) => {
        laid.change(project);
        if (level) trackOf(project, track).sample = level;
      });
      this.app.rings.preview(track);
      this.say(`${laid.said}${travels ? "" : " A link cannot carry this one (a file's sound is in it, or it goes too deep): this browser keeps it."}`, true);
    });
  }

  /** Reads which recordings this browser keeps. */
  async list(): Promise<void> {
    this.kept = await listRecordings();
    this.app.notify();
  }

  /** Gives a kept recording to the ring in focus. */
  async useKept(id: string): Promise<void> {
    const track = this.app.selected;
    const listed = this.kept.find((item) => item.id === id);
    if (!listed || this.app.relay.refuse(track)) return;
    const settings = trackOf(this.app.project, track);
    // The ring plays it already: nothing to give, and nothing of how it is set is to be lost.
    if (settings.sample?.id === id && settings.sound === SAMPLE_SOUND && soundState(id) === "ready") {
      this.say(`${trackInfo(track).name} plays “${listed.name}” already.`);
      return;
    }
    const table = this.app.store.project;
    await this.working("Reading the sound …", async () => {
      const made = await loadSound({ id, name: listed.name });
      if (!made) throw new Error(`“${listed.name}” could not be read.`);
      if (this.app.store.project !== table) return;
      // What was resampled from the Kreisel keeps its recipe: on whichever ring it lies, it travels in the link.
      this.give(track, listed.recipe === undefined ? firstSample(id, listed.name) : { ...firstSample(id, listed.name, SLICES), recipe: listed.recipe }, made, { about: listed.source === "kreisel" ? "resampled from the Kreisel" : listed.source === "microphone" ? "a take" : listed.kind });
    });
  }

  /** Which recordings this browser keeps right now, by their ids: for whoever wants to tell later what came since. */
  async keptIds(): Promise<string[]> {
    return (await listRecordings()).map((item) => item.id);
  }

  /**
   * Forgets, without a word, what was resampled from the Kreisel since `before` was noted and is played by no ring of
   * the Kreisel on the table: a lesson of the guide resamples on a copy, and what it made goes with the copy.
   */
  async forgetSince(before: readonly string[]): Promise<void> {
    const played = new Set(this.app.project.tracks.flatMap((track) => (track.sample ? [track.sample.id] : [])));
    for (const item of await listRecordings()) {
      if (item.source !== "kreisel" || before.includes(item.id) || played.has(item.id)) continue;
      await dropRecording(item.id);
      forgetSound(item.id);
    }
    await this.list();
  }

  /** Forgets a kept recording. Rings that play it fall silent; for a moment it can be taken back. */
  async dropKept(id: string): Promise<void> {
    const recording = await recordingOf(id);
    await dropRecording(id);
    forgetSound(id);
    lostSound(id);
    await this.list();
    const plays = this.app.project.tracks.filter((track) => track.sample?.id === id && track.sound === SAMPLE_SOUND).length;
    this.app.say(`“${recording?.name ?? "The recording"}” is forgotten.${plays === 0 ? "" : plays === 1 ? " The ring that played it is silent now." : ` The ${plays} rings that played it are silent now.`}`, recording ? {
      label: "Undo",
      run: () => {
        void keepRecording(recording).then(() => {
          foundSound(id);
          this.sought.delete(id);
          this.refresh();
          return this.list();
        });
      },
    } : undefined);
  }

  /** Saves the Kreisel as one file with the recordings its rings play: the way to pass on what a link cannot carry. */
  async saveBundle(): Promise<void> {
    await this.working("Packing the file …", async () => {
      const project = this.app.store.project;
      const ids = [...new Set(project.tracks.flatMap((track) => (track.sample ? [track.sample.id] : [])))];
      const recordings = (await Promise.all(ids.map((id) => recordingOf(id)))).filter((recording): recording is Recording => recording !== null);
      download(new Blob([packBundle({ link: await encodeLink(project), recordings })]), `kreisel${BUNDLE_ENDING}`);
      const without = ids.length - recordings.length;
      this.say(`Saved as a file with ${recordings.length === 1 ? "1 recording" : `${recordings.length} recordings`}${without > 0 ? ` (${without} ${without === 1 ? "is" : "are"} not in this browser and could not be packed)` : ""}. Whoever opens it gets the Kreisel and its sound.`);
    });
  }

  /**
   * Opens a Kreisel's own file: its recordings are kept, then the Kreisel comes onto the table (the one that was there
   * can be taken back). Such a file can be written by anyone, so only what holds is kept: the Kreisel has to open,
   * and of the file's sounds only those its rings name, each only if it is the sound its name says (the name is the
   * hash of its bytes; what was resampled from a Kreisel is named after its recipe and is made again from that).
   */
  async openBundle(bytes: ArrayBuffer): Promise<void> {
    const bundle = unpackBundle(new Uint8Array(bytes));
    let project: Project | null = null;
    try {
      project = bundle ? await decodeLink(bundle.link) : null;
    } catch {
      project = null;
    }
    if (!bundle || !project) {
      this.say("This file could not be opened: it is damaged.");
      return;
    }
    const named = new Set(project.tracks.flatMap((track) => (track.sample ? [track.sample.id] : [])));
    for (const recording of bundle.recordings) {
      if (!named.has(recording.id) || (await idOf(recording.bytes)) !== recording.id) continue;
      await keepRecording(recording);
      foundSound(recording.id);
      this.sought.delete(recording.id);
    }
    await this.app.files.openLink(`#k=${bundle.link}`);
    await this.list();
  }
}
