import { BAR, clamp, emptyWeather, emptyWind, MAX_STEPS, TRACK_COUNT, trackInfo, WEATHER_COUNT, WEATHER_MAX, WIND_MAX, type Scene, wrap } from "./model";
import type { Random } from "./patterns";

/*
 * Weather: effects painted onto the wheel. The wheel has two directions a
 * straight sequencer lacks: how far out a place is says which instrument,
 * its angle says when. So a patch of weather is "these rings, in this part
 * of their round". Each kind of weather can drift around the wheel with a
 * wind of its own, which is all the automation there is: the patch a ring
 * plays under moves on, bar after bar.
 */

export const WEATHER_NAMES = ["Fog", "Sun", "Clouds", "Rain", "Sparks", "Hail"] as const;
export const WEATHER_HINTS = [
  "Fog: what lies under it sounds duller",
  "Sun: what lies under it sounds brighter",
  "Clouds: reverb",
  "Rain: echo",
  "Sparks: drive",
  "Hail: chops the sound up",
] as const;
/** The colour each kind of weather is drawn in. */
export const WEATHER_COLORS = ["#7f93a8", "#f2b705", "#b9b3c9", "#3d7edb", "#e4572e", "#2a2233"] as const;

/** One pass of the brush adds this much; three passes are all there is. */
export const WEATHER_STROKE = 5;

/** The winds a slider can set, in quarter steps a bar. */
export const WINDS = [-16, -8, -4, -2, -1, 0, 1, 2, 4, 8, 16] as const;


/** How a wind is called. */
export function windName(wind: number): string {
  if (wind === 0) return "calm";
  const speed = Math.abs(wind) / 4;
  const steps = speed === 0.25 ? "¼ step" : speed === 0.5 ? "½ step" : speed === 1 ? "1 step" : `${speed} steps`;
  return `${steps} a bar ${wind > 0 ? "↻" : "↺"}`;
}

/** The tides a kind of weather can have: the bars over which it swells and ebbs once, 0 for none. Odd lengths (12, 20) run against the phrases. */
export const TIDES = [0, 4, 8, 12, 16, 20, 32, 64] as const;

/**
 * How much of a weather is there after `local` steps of playing under a tide of `bars` bars: nothing where the tide
 * turns (as the scene begins), all of it halfway through. Without a tide all of it is always there.
 */
export const tideShare = (local: number, bars: number): number => (bars > 0 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * local) / (bars * BAR)) : 1);

/** Tides as far as a claim plainly says them: a length a tide can have for each kind of weather. Nothing where no weather has one. */
export function cleanTide(value: unknown): number[] | undefined {
  const list = Array.isArray(value) ? value : [];
  const tide = emptyWind().map((_, kind) => TIDES.find((bars) => bars === list[kind]) ?? 0);
  return tide.some((bars) => bars > 0) ? tide : undefined;
}

/** How many whole steps a kind of weather has drifted after `local` steps of playing (what is heard). */
export const windOffset = (local: number, wind: number): number => Math.floor((local * wind) / (4 * BAR));
/** The same without the rounding (what is seen: the clouds do not jump). */
export const windDrift = (local: number, wind: number): number => (local * wind) / (4 * BAR);

/** How much of weather `kind` lies on ring `ring` at step `position` of its round, 0..1, after `local` steps of playing. */
export function weatherAt(scene: Scene, kind: number, ring: number, position: number, local: number): number {
  const length = scene.patterns[ring]?.len ?? 16;
  const value = scene.weather[kind]?.[ring]?.[wrap(position - windOffset(local, scene.wind[kind] ?? 0), length)] ?? 0;
  return (value / WEATHER_MAX) * tideShare(local, scene.tide?.[kind] ?? 0);
}

/** All six kinds at once. */
export function weatherOver(scene: Scene, ring: number, position: number, local: number): number[] {
  return Array.from({ length: WEATHER_COUNT }, (_, kind) => weatherAt(scene, kind, ring, position, local));
}

/** Sun against fog: how much brighter (above 0) or duller (below) it is, −1..1. */
export const brightness = (over: readonly number[]): number => (over[1] ?? 0) - (over[0] ?? 0);

/** A sound's own brightness (the sound pad's x, on rings where it means that) under sun or fog. */
export function shaded(x: number, bright: number): number {
  return clamp(bright >= 0 ? x + (1 - x) * bright * 0.85 : x * (1 + bright * 0.85), 0, 1);
}

/** Whether sun and fog reach into ring `ring`'s sound itself (its brightness), not only what comes after it. */
export const shadesSound = (ring: number): boolean => trackInfo(ring).xLabel === "Brightness";

export function hasWeather(scene: Scene, kind?: number, ring?: number): boolean {
  return scene.weather.some((rings, which) => (kind === undefined || kind === which)
    && rings.some((line, where) => (ring === undefined || ring === where) && line.slice(0, scene.patterns[where]?.len ?? MAX_STEPS).some((value) => value > 0)));
}

/** The weather in a few words, for the status line. */
export function describeWeather(scene: Scene): string {
  const parts: string[] = [];
  for (let kind = 0; kind < WEATHER_COUNT; kind += 1) {
    const rings = Array.from({ length: TRACK_COUNT }, (_, ring) => ring).filter((ring) => hasWeather(scene, kind, ring));
    if (rings.length === 0) continue;
    const where = rings.length === TRACK_COUNT ? "everywhere" : rings.length === 1 ? `on ${trackInfo(rings[0] ?? 0).name}` : `on ${rings.length} rings`;
    const wind = scene.wind[kind] ?? 0;
    parts.push(`${WEATHER_NAMES[kind]} ${where}${wind === 0 ? "" : `, drifting ${windName(wind)}`}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "clear sky";
}

/** Weather as it may be: whole numbers in range, every kind, every ring, every step. */
export function cleanWeather(value: unknown): number[][][] {
  const kinds: unknown[] = Array.isArray(value) ? value : [];
  return emptyWeather().map((rings, kind) => {
    const given: unknown = kinds[kind];
    return rings.map((line, ring) => {
      const steps: unknown = Array.isArray(given) ? given[ring] : undefined;
      return line.map((_, step) => {
        const number: unknown = Array.isArray(steps) ? steps[step] : undefined;
        return typeof number === "number" && Number.isFinite(number) ? clamp(Math.round(number), 0, WEATHER_MAX) : 0;
      });
    });
  });
}

export function cleanWind(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  return emptyWind().map((_, kind) => {
    const number: unknown = list[kind];
    return typeof number === "number" && Number.isFinite(number) ? clamp(Math.round(number), -WIND_MAX, WIND_MAX) : 0;
  });
}

/**
 * Weather for the link: one entry for every ring a kind of weather lies on
 * (the kind, the ring, then a hex digit a step, without the clear steps at
 * the end), joined by commas. A clear sky is nothing at all.
 */
export function packWeather(weather: readonly (readonly (readonly number[])[])[]): string {
  const entries: string[] = [];
  weather.forEach((rings, kind) => rings.forEach((line, ring) => {
    const digits = line.map((value) => clamp(Math.round(value), 0, WEATHER_MAX).toString(16)).join("").replace(/0+$/, "");
    if (digits) entries.push(`${kind}${ring}${digits}`);
  }));
  return entries.join(",");
}

export function unpackWeather(value: unknown): number[][][] {
  const weather = emptyWeather();
  if (typeof value !== "string" || value.length > WEATHER_COUNT * TRACK_COUNT * (MAX_STEPS + 3)) return weather;
  for (const entry of value.split(",")) {
    if (!/^[0-5][0-6][0-9a-f]{1,32}$/.test(entry)) continue;
    const line = weather[Number(entry[0])]?.[Number(entry[1])];
    if (!line) continue;
    [...entry.slice(2)].forEach((digit, step) => { line[step] = Number.parseInt(digit, 16); });
  }
  return weather;
}

/** The entries of packed weather that lie on ring `ring`: what Reihum compares. */
export function weatherOn(packed: unknown, ring: number): string {
  if (typeof packed !== "string") return "";
  return packed.split(",").filter((entry) => entry[1] === String(ring)).join(",");
}

/** A sky to start from: two or three patches where they usually do good, some of them on the move. */
export function diceWeather(lengths: readonly number[], random: Random): { weather: number[][][]; wind: number[] } {
  const weather = emptyWeather();
  const wind = emptyWind();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length) % items.length] as T;
  const patch = (kind: number, rings: readonly number[], from: number, share: number, strength: number): void => {
    for (const ring of rings) {
      const length = lengths[ring] ?? 16;
      const start = Math.round(from * length);
      const count = Math.max(1, Math.round(share * length));
      for (let step = 0; step < count; step += 1) {
        const line = weather[kind]?.[ring];
        if (line) line[wrap(start + step, length)] = strength;
      }
    }
  };
  // Fog or sun over the rings that play notes, drifting: the sound opens and closes over the bars.
  const light = pick([0, 1]);
  patch(light, pick([[4], [4, 5], [5, 6], [4, 5, 6]]), random(), 0.3 + random() * 0.3, pick([10, 15]));
  wind[light] = pick([1, 2, 4, -1, -2]);
  // Rain or clouds at the end of the round, on the drums that carry it.
  const wet = pick([2, 3]);
  patch(wet, pick([[1], [1, 2], [3], [1, 3]]), 0.7 + random() * 0.1, 0.2 + random() * 0.1, pick([10, 15]));
  // And sometimes sparks or hail somewhere.
  if (random() < 0.6) {
    const rough = pick([4, 5]);
    patch(rough, [pick([0, 2, 4, 6])], random(), 0.12 + random() * 0.15, 10);
    wind[rough] = pick([0, 0, 4, -4, 8]);
  }
  return { weather, wind };
}
