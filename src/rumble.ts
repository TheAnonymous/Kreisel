import { clamp, MAX_STEPS, RUMBLE_MAX, stepAt, type Pattern, type Scene } from "./model";
import type { Random } from "./patterns";

/*
 * The Nachbeben: what comes back from the cellar after a kick. The sound is
 * made in audio/rumble.ts; here is the line that says where the ground
 * shakes, step by step around the kick's ring, and the shapes such a line
 * usually has. A shape is laid around the kicks that are there, so it fits
 * four on the floor as well as a broken beat.
 */

/** On the kick's ring the tool that holds notes elsewhere (a drum has none to hold) paints the Nachbeben. */
export const shakes = (track: number, tool: string): boolean => track === 0 && tool === "laenge";

export const RUMBLE_SHAPES = ["Offbeat", "Rollend", "Schweif"] as const;
/** How much each shape rolls: the swell and the tail are one breath, the roll is sixteenths. */
export const SHAPE_ROLL = [0.1, 0.85, 0] as const;

/** For every step of the ring: how many steps ago the last kick was (0 on a kick) and how long the gap is it lies in. */
function gaps(pattern: Pattern): { since: number; gap: number }[] {
  const length = pattern.len;
  const hits: number[] = [];
  for (let step = 0; step < length; step += 1) if (stepAt(pattern, step).on) hits.push(step);
  return Array.from({ length }, (_, step) => {
    // Without a kick there is one gap as long as the ring.
    if (hits.length === 0) return { since: step + 1, gap: length + 1 };
    let last = hits[hits.length - 1]! - length;
    let next = hits[0]! + length;
    for (const hit of hits) {
      if (hit <= step) last = hit;
      if (hit > step) {
        next = hit;
        break;
      }
    }
    return { since: step - last, gap: next - last };
  });
}

/** The line of shape `shape` (see RUMBLE_SHAPES) around the kicks of `pattern`. */
export function rumbleShape(pattern: Pattern, shape: number): number[] {
  const line = Array.from({ length: MAX_STEPS }, () => 0);
  gaps(pattern).forEach(({ since, gap }, step) => {
    // On the kick itself the ground is still: the kick is heard alone.
    if (since === 0) return;
    const share = shape === 0
      // Swells between two kicks and is gone before the next.
      ? Math.sin((Math.PI * since) / gap) ** 0.7
      : shape === 1
        // Everything between the kicks, the steps in turn a little stronger and weaker.
        ? (since % 2 === 1 ? 1 : 0.85)
        // Loudest right after the kick, then it dies away.
        : Math.exp(-(since - 1) / Math.max(1, gap * 0.45));
    line[step] = clamp(Math.round(share * RUMBLE_MAX), 0, RUMBLE_MAX);
  });
  return line;
}

/** A shape with a little chance in it: no two throws shake quite alike. */
export function diceRumble(pattern: Pattern, shape: number, random: Random): number[] {
  return rumbleShape(pattern, shape).map((value, step) => {
    if (value === 0 || step >= pattern.len) return value;
    return clamp(value + Math.round((random() - 0.5) * 3), 2, RUMBLE_MAX);
  });
}

/** Which shape a line is, or −1 if it is none of them (painted by hand, or empty). */
export function shapeOf(pattern: Pattern, line: readonly number[]): number {
  for (let shape = 0; shape < RUMBLE_SHAPES.length; shape += 1) {
    const wanted = rumbleShape(pattern, shape);
    if (wanted.some((value) => value > 0) && wanted.every((value, step) => step >= pattern.len || value === (line[step] ?? 0))) return shape;
  }
  return -1;
}

/** How loud the Nachbeben is at a value of the line, 0..1: the upper half of the line does most of the work. */
export const rumbleShare = (value: number): number => (clamp(value, 0, RUMBLE_MAX) / RUMBLE_MAX) ** 1.4;

export const hasRumble = (scene: Scene, length = MAX_STEPS): boolean => scene.rumble.slice(0, length).some((value) => value > 0);

/**
 * The pitch the ground shakes at: the root of the bar's chord, brought down
 * to where a rumble lives (between about 38 and 76 Hz), whatever octave the
 * bass plays it in.
 */
export function rumbleHz(hz: number): number {
  let pitch = hz > 0 && Number.isFinite(hz) ? hz : 55;
  while (pitch >= 76) pitch /= 2;
  while (pitch < 38) pitch *= 2;
  return pitch;
}

/** The line in a few words, for the status line. */
export function describeRumble(scene: Scene, pattern: Pattern): string {
  const steps = scene.rumble.slice(0, pattern.len);
  const shaking = steps.filter((value) => value > 0).length;
  if (shaking === 0) return "kein Nachbeben";
  const shape = shapeOf(pattern, scene.rumble);
  const most = Math.round((Math.max(...steps) / RUMBLE_MAX) * 100);
  return `Nachbeben${shape >= 0 ? ` (${RUMBLE_SHAPES[shape]})` : ""} auf ${shaking} von ${pattern.len} Schritten, bis ${most} %`;
}

/** A line as it may be: whole numbers in range, exactly MAX_STEPS of them. */
export function cleanRumble(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: MAX_STEPS }, (_, step) => {
    const number: unknown = list[step];
    return typeof number === "number" && Number.isFinite(number) ? clamp(Math.round(number), 0, RUMBLE_MAX) : 0;
  });
}
