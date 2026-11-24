import { TRACK_COUNT, type Relay } from "./model";
import { weatherOn } from "./weather";

/*
 * "Reihum": what belongs to a turn. Turns are compared in their packed form
 * (the one that travels in the link), so "what did this turn change" needs
 * no knowledge of the project beyond where a ring's things are kept: its
 * settings in `t`, its patterns in every scene's `p`.
 */

export const RULES = [
  { name: "Free", hint: "Every turn may change anything." },
  { name: "One ring", hint: "Only one ring is touched a turn. Tempo, key, chords and piece are free." },
  { name: "Telephone", hint: "One ring a turn, and you hear only the ring of the person before you. Only at the reveal does everyone hear everything. Best started with an empty Kreisel." },
] as const;

/** Colours for the people of a round: apart from the rings' own, and from each other. */
export const PEOPLE = ["#d7263d", "#1b998b", "#f4a300", "#5d5fef", "#2e86de", "#ef5da8", "#6ab04c", "#8d6e63"] as const;

interface PackedLike {
  t?: unknown;
  c?: unknown;
}

const tracksOf = (state: unknown): unknown[] => {
  const tracks = (state as PackedLike | null)?.t;
  return Array.isArray(tracks) ? tracks : [];
};

/** Ring `ring`'s pattern in every scene of a packed state (`null` where there is no scene). */
const patternsOf = (state: unknown, ring: number): (string | null)[] => {
  const scenes = (state as PackedLike | null)?.c;
  return (Array.isArray(scenes) ? scenes : []).map((scene) => {
    const patterns = (scene as { p?: unknown } | null)?.p;
    return Array.isArray(patterns) ? JSON.stringify(patterns[ring] ?? null) : null;
  });
};

/** The Nachbeben in every scene of a packed state (it belongs to the kick's ring), and its character. */
const rumblesOf = (state: unknown): (string | null)[] => {
  const scenes = (state as PackedLike | null)?.c;
  return (Array.isArray(scenes) ? scenes : []).map((scene) => {
    if (typeof scene !== "object" || scene === null) return null;
    const line = (scene as { q?: unknown }).q;
    return typeof line === "string" ? line : "";
  });
};
const characterOf = (state: unknown): string => JSON.stringify((state as { w?: unknown } | null)?.w ?? null);

/** Whether a packed pattern ([length, step, step …]) has a hit. */
const hasHits = (pattern: string | null): boolean => {
  if (pattern === null) return false;
  const steps: unknown = JSON.parse(pattern);
  return Array.isArray(steps) && steps.slice(1).some((step) => step !== 0);
};

/** The rings that have anything to play in a packed state. */
export function ringsWithContent(state: unknown): number[] {
  return Array.from({ length: TRACK_COUNT }, (_, ring) => ring).filter((ring) => patternsOf(state, ring).some(hasHits));
}

/**
 * The rings a turn touched: their sound or mix changed, or one of their
 * patterns did. A scene that is new counts only where a ring plays something
 * in it that it played in no scene before (copying a scene touches nothing).
 * Without a state before, every ring with content counts.
 */
export function changedRings(before: unknown, after: unknown): number[] {
  if (before === null || before === undefined) return ringsWithContent(after);
  const changed: number[] = [];
  for (let ring = 0; ring < TRACK_COUNT; ring += 1) {
    const settings = JSON.stringify(tracksOf(before)[ring] ?? null) !== JSON.stringify(tracksOf(after)[ring] ?? null);
    const old = patternsOf(before, ring);
    const known = new Set(old);
    const patterns = patternsOf(after, ring).some((pattern, scene) => {
      if (pattern === null) return false;
      const was = old[scene] ?? null;
      return was === null ? !known.has(pattern) && hasHits(pattern) : was !== pattern;
    });
    // The kick's ring also has its Nachbeben: a line in every scene (a copied scene's is not new) and a character.
    const shakes = ring === 0 && (characterOf(before) !== characterOf(after) || rumblesOf(after).some((line, scene) => {
      if (line === null) return false;
      const was = rumblesOf(before)[scene] ?? null;
      return was === null ? line !== "" && !rumblesOf(before).includes(line) : was !== line;
    }));
    // Weather lies on rings: painting some on a ring touches that ring (the wind is nobody's, like the tempo).
    const skies = (state: unknown): (string | null)[] => {
      const scenes = (state as PackedLike | null)?.c;
      return (Array.isArray(scenes) ? scenes : []).map((scene) => (typeof scene === "object" && scene !== null ? weatherOn((scene as { x?: unknown }).x, ring) : null));
    };
    const weather = skies(after).some((sky, scene) => {
      if (sky === null) return false;
      const was = skies(before)[scene] ?? null;
      return was === null ? sky !== "" && !skies(before).includes(sky) : was !== sky;
    });
    if (settings || patterns || shakes || weather) changed.push(ring);
  }
  return changed;
}

/** The colour of the person who took turn `index`: the same person keeps their colour through the round. */
export function turnColor(relay: Relay, index: number): string {
  const names = [...new Set(relay.turns.map((turn) => turn.name.toLowerCase()))];
  const place = names.indexOf(relay.turns[index]?.name.toLowerCase() ?? "");
  return PEOPLE[Math.max(0, place) % PEOPLE.length] ?? PEOPLE[0];
}

/** A name as it may travel in a link: no control characters, not too long, never empty. */
export function cleanName(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : "";
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit);
  return clean || "Someone";
}
