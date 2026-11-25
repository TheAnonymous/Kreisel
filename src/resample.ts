import { packState, unpack } from "./codec";
import { BAR, clamp, clone, currentScene, MAX_STEPS, MIN_STEPS, SAMPLE_SOUND, type Project } from "./model";
import { MAX_RECIPE } from "./sample";

/*
 * Pressing the Kreisel onto a ring. What the wheel plays can become a ring's
 * sample: the scene on the table, once round, as it sounds right now, with
 * its pedals, its weather, its rumble and whoever is muted left out. Sampling
 * one's own machine is how hard techno gets its weight: a kick with its
 * rumble bounced to one hit, a loop driven, bounced and driven again.
 *
 * Such a recording need not travel as sound. The Kreisel it was made of fits
 * in a few hundred characters, and any browser can play that Kreisel again
 * and get the recording. So a ring's sample carries its recipe: the packed
 * Kreisel it was pressed from. A link stays a link.
 */

/**
 * The recipe for what `project` plays now: its scene on the table alone, the piece and the row switched off, and
 * every ring that is not heard (`audible` says which are) muted. `null` if that would be longer than `longest` (too
 * long to carry: a Kreisel whose rings play recordings of Kreisels of recordings …).
 */
export function recipeOf(project: Project, audible: (track: number) => boolean, longest = MAX_RECIPE): string | null {
  const snapshot = clone(project);
  const scene = currentScene(snapshot);
  snapshot.scenes = snapshot.scenes.map((_, index) => (index === 0 ? scene : null));
  snapshot.scene = 0;
  snapshot.chain = false;
  snapshot.order = [0];
  snapshot.piece.on = false;
  snapshot.relay = null;
  snapshot.tracks.forEach((track, index) => {
    track.mute = !audible(index);
    // A recording a ring has but does not play (or is not heard with) is no part of what is made: it stays behind.
    if (track.mute || track.sound !== SAMPLE_SOUND) delete track.sample;
  });
  const recipe = JSON.stringify(packState(snapshot));
  return recipe.length <= longest ? recipe : null;
}

/**
 * How deep a recipe goes: 1 for a Kreisel whose rings play no records, one more for every record of a Kreisel whose
 * rings play records … A recipe that is none is 0.
 */
export function recipeDepth(recipe: string, guard = 8): number {
  const project = guard > 0 ? projectOf(recipe) : null;
  if (!project) return 0;
  return 1 + Math.max(0, ...project.tracks.map((track) => (track.sample?.recipe === undefined ? 0 : recipeDepth(track.sample.recipe, guard - 1))));
}

/** The Kreisel a recipe was written from; `null` if it is none. */
export function projectOf(recipe: string): Project | null {
  try {
    return unpack(JSON.parse(recipe) as unknown, true);
  } catch {
    return null;
  }
}

/**
 * A recipe's Kreisel as it is played for the recording: its scene by itself, whatever the recipe says about a row or
 * a piece (a recipe from a link is as it was written, not as `recipeOf` writes it).
 */
export function plainRecipe(project: Project): Project {
  project.chain = false;
  project.order = [project.scene];
  project.piece.on = false;
  project.relay = null;
  return project;
}

/**
 * How many steps of a recipe's Kreisel the recording holds, from the scene's first step. One ring by itself: one turn
 * of that ring, as many steps as it has. Several rings: one bar, or two if the scene has more than one chord or one
 * of the rings that are heard is longer than a bar. (A ring holds 32 slices at most: two bars.)
 */
export function recipeSteps(project: Project): number {
  const scene = currentScene(project);
  const heard = project.tracks.flatMap((track, index) => (track.mute ? [] : [index]));
  const [only] = heard;
  if (heard.length === 1 && only !== undefined) return clamp(scene.patterns[only]?.len ?? BAR, MIN_STEPS, MAX_STEPS);
  return scene.chords.length > 1 || heard.some((index) => (scene.patterns[index]?.len ?? BAR) > BAR) ? 2 * BAR : BAR;
}

/** Whether a recipe can be played anywhere: every ring that is heard in it plays what comes with it (its own sounds, or a recording that has a recipe too). */
export function selfContained(project: Project): boolean {
  return project.tracks.every((track) => track.mute || track.sound !== SAMPLE_SOUND || track.sample?.recipe !== undefined);
}
