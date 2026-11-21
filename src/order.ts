import type { Project, Scene } from "./model";

/*
 * The row ("Folge"): the scenes in the order they play, one entry a round.
 * A round is a scene once through its chords, so A A B A is four rounds and
 * the first scene plays twice before the second comes. The row is laid by
 * hand; nothing in it is implied.
 */

/** How many rounds a row holds. */
export const MAX_ROUNDS = 64;

const isScene = (value: unknown, scenes: readonly (Scene | null)[]): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < scenes.length && scenes[value] !== null;

/** A row as it may stand: only scenes that are there, no longer than it may be, and never empty (then it is one round of `fallback`). */
export function cleanOrder(order: readonly number[], scenes: readonly (Scene | null)[], fallback: number): number[] {
  const kept = Array.isArray(order) ? order.filter((scene) => isScene(scene, scenes)).slice(0, MAX_ROUNDS) : [];
  return kept.length > 0 ? kept : [fallback];
}

/** What a Kreisel from before the row played: every filled scene in turn, each `repeats` times. */
export function orderOfOld(scenes: readonly (Scene | null)[], repeats: number): number[] {
  const order: number[] = [];
  scenes.forEach((scene, index) => {
    if (scene) for (let time = 0; time < repeats; time += 1) order.push(index);
  });
  return order.slice(0, MAX_ROUNDS);
}

/** The row with one more round of `scene` before place `at` (at the end by default). A full row stays as it is. */
export function layRound(order: readonly number[], scene: number, at = order.length): number[] {
  if (order.length >= MAX_ROUNDS) return [...order];
  const place = Math.max(0, Math.min(order.length, Math.round(at)));
  return [...order.slice(0, place), scene, ...order.slice(place)];
}

/** The row without round `index`. Its last round stays: a row is never empty. */
export function removeRound(order: readonly number[], index: number): number[] {
  if (order.length <= 1 || index < 0 || index >= order.length) return [...order];
  return order.filter((_, at) => at !== index);
}

/** The row with round `from` taken out and put back so that it is round `to`. */
export function moveRound(order: readonly number[], from: number, to: number): number[] {
  const scene = order[from];
  if (scene === undefined) return [...order];
  const rest = order.filter((_, at) => at !== from);
  const place = Math.max(0, Math.min(rest.length, Math.round(to)));
  return [...rest.slice(0, place), scene, ...rest.slice(place)];
}

/** The row once `scene` is gone; if that leaves nothing, one round of `fallback`. */
export function withoutScene(order: readonly number[], scene: number, fallback: number): number[] {
  const rest = order.filter((entry) => entry !== scene);
  return rest.length > 0 ? rest : [fallback];
}

/** The round after `round`, round and round; from a round that is not in the row (any more), the first. */
export function nextRound(order: readonly number[], round: number | null): number {
  if (round === null || round < 0 || round >= order.length) return 0;
  return (round + 1) % order.length;
}

/** The round to begin with while `scene` is on the table: its first one, or `null` if the row does not hold it. */
export function firstRound(order: readonly number[], scene: number): number | null {
  const round = order.indexOf(scene);
  return round < 0 ? null : round;
}

/** The next round of `scene` after `round`, looking round and round; `null` if the row does not hold that scene. */
export function roundAfter(order: readonly number[], scene: number, round: number | null): number | null {
  for (let offset = 1; offset <= order.length; offset += 1) {
    const at = ((round ?? -1) + offset + order.length) % order.length;
    if (order[at] === scene) return at;
  }
  return null;
}

/*
 * The row can be changed while it plays. These say where a round is afterwards, so that whoever is in the middle of
 * the row (the player, the mark for where it begins) stays with its round.
 */

/** Where round `round` is once another was laid before place `at`. */
export function roundOnceLaid(round: number, at: number): number {
  return at <= round ? round + 1 : round;
}

/**
 * Where round `round` is once round `gone` was taken out of a row that now holds `left` rounds. From the round that
 * was taken out itself, the answer is the one before it: so what follows is what followed.
 */
export function roundOnceRemoved(round: number, gone: number, left: number): number {
  if (round === gone) return (gone - 1 + left) % left;
  return round > gone ? round - 1 : round;
}

/** Where round `round` is once round `from` was put at place `to`. */
export function roundOnceMoved(round: number, from: number, to: number): number {
  if (round === from) return to;
  const without = round > from ? round - 1 : round;
  return without >= to ? without + 1 : without;
}

/** How many bars the row plays: each of its rounds is a scene once through its chords. */
export function orderBars(project: Project): number {
  return project.order.reduce((sum, scene) => sum + (project.scenes[scene]?.chords.length ?? 0), 0);
}

/** A row in a link: one digit a round. */
export function packOrder(order: readonly number[]): string {
  return order.join("");
}

/** Reads a row from a link; whatever is not a digit of a scene is left out. */
export function unpackOrder(text: unknown): number[] {
  if (typeof text !== "string") return [];
  return [...text].filter((sign) => sign >= "0" && sign <= "7").map(Number);
}
