import { SAMPLE_SOUND, type Project, type Sample } from "../model";
import { plainRecipe, projectOf, recipeSteps } from "../resample";
import { DEEPEST_RECIPE } from "../sample";
import { encodeWav16, type Pcm } from "../sample-files";
import { idOfText, keepRecording, recordingOf } from "../sample-store";
import { RENDER_LEAD, renderBuffer, stepSeconds } from "./engine";
import { decodeSound, readySound, takeSound, type Ready } from "./sample";

/*
 * Getting a ring's recording ready. A sample names its recording; this finds
 * it: among what is ready already, in the browser's store (and decodes it),
 * or, for a recording made of a Kreisel, by playing that Kreisel again.
 * What cannot be found is remembered as missing, so the page can say so and
 * ask for the file.
 *
 * A recipe comes from a link, and a link can be written by anyone. So playing
 * recipes has its limits: a recipe is played only if it is the one its
 * recording is named after (the name is the recipe's hash, which also means
 * that no recipe can be made to name itself), only a few are played for one
 * Kreisel, one after the other, each for two bars at most, and only what a
 * ring itself plays is kept in the browser's store.
 */

/** What is being got ready right now, and what this browser was found not to have. */
const loading = new Map<string, Promise<Ready | null>>();
const missing = new Set<string>();

/** So many recipes are played for one Kreisel that comes onto the table. */
const RENDERS = 12;

/** What a Kreisel's recordings are got ready with: how many recipes may still be played for it, and which recordings are being made right now, from the outermost in. */
export interface Quest {
  budget: { left: number };
  chain: readonly string[];
}

/** A fresh quest: for one Kreisel that comes onto the table, or one thing the user asked for. */
export const quest = (): Quest => ({ budget: { left: RENDERS }, chain: [] });

export type SoundState = "ready" | "loading" | "missing";

/** Whether a recording is ready, on its way, or not in this browser. */
export function soundState(id: string): SoundState {
  return readySound(id) ? "ready" : missing.has(id) ? "missing" : "loading";
}

/** The recording under `id` was just forgotten: it is missing now, and is not looked for again. */
export function lostSound(id: string): void {
  loading.delete(id);
  missing.add(id);
}

/** A recording has just been brought in under `id`: it is no longer missing. */
export function foundSound(id: string): void {
  missing.delete(id);
  loading.delete(id);
}

/** Recipes are played one after the other: a render takes all a laptop has. */
let line: Promise<unknown> = Promise.resolve();

/**
 * What a recipe's Kreisel plays, as sound: its scene from its first step, for as many steps as `recipeSteps` says.
 * What still rings after the last step (reverb, echo) is laid over the beginning, so the recording goes round without
 * a seam. `null` if the recipe is none, goes too deep, or one of its rings plays a recording that is not here (a
 * recording with a silent ring in it would be another recording).
 */
export async function renderRecipe(recipe: string, on: Quest = quest()): Promise<Pcm | null> {
  const written = projectOf(recipe);
  if (!written || on.chain.length >= DEEPEST_RECIPE) return null;
  const project = plainRecipe(written);
  await loadSounds(project, on);
  if (project.tracks.some((track) => !track.mute && track.sound === SAMPLE_SOUND && track.sample && !readySound(track.sample.id))) return null;
  const steps = recipeSteps(project);
  const turn = line.then(() => renderBuffer(project, undefined, undefined, steps));
  line = turn.catch(() => undefined);
  const { buffer } = await turn;
  const from = Math.round(RENDER_LEAD * buffer.sampleRate);
  const round = Math.round(steps * stepSeconds(project) * buffer.sampleRate);
  if (round <= 0 || from + round > buffer.length) return null;
  const channels = [0, 1].map((channel) => {
    const whole = buffer.getChannelData(channel);
    const folded = whole.slice(from, from + round);
    // What rings on after the round is what would ring into its beginning, were it going round already.
    for (let at = from + round; at < whole.length; at += 1) folded[(at - from) % round] = (folded[(at - from) % round] ?? 0) + (whole[at] ?? 0);
    return folded;
  });
  return { channels, sampleRate: buffer.sampleRate };
}

/**
 * Gets a sample's recording ready, or says that this browser does not have it (`null`). Asking twice waits for the
 * same answer.
 */
export function loadSound(sample: Pick<Sample, "id" | "name" | "recipe">, on: Quest = quest()): Promise<Ready | null> {
  const made = readySound(sample.id);
  if (made) return Promise.resolve(made);
  // A recording that is asked for while it is being made (its recipe names it) is not there.
  if (on.chain.includes(sample.id)) return Promise.resolve(null);
  const going = loading.get(sample.id);
  if (going) return going;
  const work = (async (): Promise<Ready | null> => {
    try {
      const kept = await recordingOf(sample.id);
      if (kept) return takeSound(sample.id, await decodeSound(kept.bytes));
      const recipe = sample.recipe;
      // Only the recipe the recording is named after is played, and only while this Kreisel has renders left.
      if (recipe !== undefined && on.budget.left > 0 && (await idOfText(recipe)) === sample.id) {
        on.budget.left -= 1;
        const pcm = await renderRecipe(recipe, { budget: on.budget, chain: [...on.chain, sample.id] });
        if (pcm) {
          // What a ring itself plays is kept, so that it is not played again at every visit; what was only needed on the way is not.
          if (on.chain.length === 0) void keepRecording({ id: sample.id, name: sample.name, kind: "WAV", source: "kreisel", bytes: encodeWav16(pcm).buffer, seconds: (pcm.channels[0]?.length ?? 0) / pcm.sampleRate, added: Date.now(), recipe });
          return takeSound(sample.id, pcm);
        }
      }
    } catch {
      // Not readable after all: it counts as missing.
    }
    missing.add(sample.id);
    return null;
  })();
  loading.set(sample.id, work);
  void work.finally(() => loading.delete(sample.id));
  return work;
}

/** Gets ready every recording the rings of `project` name. What is missing stays missing: those rings are silent. */
export async function loadSounds(project: Project, on: Quest = quest()): Promise<void> {
  await Promise.all(project.tracks.flatMap((track) => (track.sample ? [loadSound(track.sample, on)] : [])));
}
