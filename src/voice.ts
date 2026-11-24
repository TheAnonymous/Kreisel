import { clamp, MAX_VOICE_TEXT, type Pattern, type Voice } from "./model";
import type { Random } from "./patterns";

/*
 * The voice: a ring that sings. A line of text is cut into syllables, a
 * syllable into sounds: a vowel (three formants, the resonances of the mouth)
 * with the consonants before and after it (hisses, pops, hums). Every hit of
 * the ring sings the next syllable. It is German as it is written, by a few
 * rules of thumb: a robot choir, not a speaker. Everything here is plain
 * arithmetic; audio/voice.ts turns it into sound.
 */

export type Formants = readonly [number, number, number];

/** The vowels as the three lowest resonances of the mouth, in Hz. The second row are the short ones (as in "Bett", "Middle"). */
export const VOWELS: Record<string, Formants> = {
  a: [750, 1250, 2500],
  e: [400, 2050, 2700],
  i: [280, 2250, 3000],
  o: [420, 820, 2600],
  u: [310, 850, 2300],
  ä: [580, 1800, 2500],
  ö: [400, 1500, 2300],
  ü: [290, 1700, 2200],
  E: [530, 1840, 2480],
  I: [390, 1990, 2550],
  O: [570, 880, 2410],
  U: [440, 1020, 2240],
  // The murmured e of "bitte", and what an r turns into after a vowel.
  "@": [500, 1500, 2500],
  R: [640, 1300, 2500],
};

const VOWEL_LETTERS = "aeiouäöüy";
const isVowel = (letter: string): boolean => letter !== "" && VOWEL_LETTERS.includes(letter);
/** Two letters that are one vowel sound. */
const DOUBLE_VOWELS = ["ei", "ai", "ey", "ay", "au", "eu", "äu", "oi", "ie", "aa", "ee", "oo"];
/** Letters that are one consonant sound. */
const CLUSTERS = ["sch", "ch", "ck", "ph", "th", "qu", "tz", "pf", "dt"];
/** Consonants that begin a syllable together. */
const ONSETS = new Set(["bl", "br", "dr", "fl", "fr", "gl", "gr", "kl", "kr", "pl", "pr", "tr", "zw", "kn", "gn", "st", "sp", "schl", "schm", "schn", "schr", "schw", "str", "spr", "pfl", "pfr"]);

export const MAX_SYLLABLES = 32;

/** The text as it may be sung: letters, spaces and hyphens, not too long. */
export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[^\p{L}\s\-·']/gu, " ").replace(/\s+/g, " ").trimStart().slice(0, MAX_VOICE_TEXT);
}

export function cleanVoice(value: Partial<Record<keyof Voice, unknown>>): Voice {
  const share = (number: unknown, fallback: number): number => (typeof number === "number" && Number.isFinite(number) ? Math.round(clamp(number, 0, 1) * 100) / 100 : fallback);
  return { text: cleanText(value.text), mouth: share(value.mouth, 0.5), breath: share(value.breath, 0.15) };
}

interface Unit {
  /** The letters as typed. */
  text: string;
  vowel: boolean;
}

/** A word as vowel sounds and consonant sounds, each with its letters. */
function units(word: string): Unit[] {
  const low = word.toLowerCase();
  const list: Unit[] = [];
  let at = 0;
  while (at < low.length) {
    const letter = low[at] ?? "";
    if (isVowel(letter)) {
      // A y before a vowel at the start is a consonant ("ja" written "ya").
      if (letter === "y" && at === 0 && isVowel(low[at + 1] ?? "")) {
        list.push({ text: word.slice(at, at + 1), vowel: false });
        at += 1;
        continue;
      }
      let length = DOUBLE_VOWELS.includes(low.slice(at, at + 2)) ? 2 : 1;
      // An h after a vowel only makes it long ("Bahn", "froh").
      if (low[at + length] === "h" && !isVowel(low[at + length + 1] ?? "")) length += 1;
      list.push({ text: word.slice(at, at + length), vowel: true });
      at += length;
    } else {
      const cluster = CLUSTERS.find((letters) => low.startsWith(letters, at));
      const length = cluster ? cluster.length : 1;
      list.push({ text: word.slice(at, at + length), vowel: false });
      at += length;
    }
  }
  return list;
}

/** A word cut into syllables: every vowel sound takes the consonants before it that can begin a syllable. */
function cutWord(word: string): string[] {
  const list = units(word);
  const vowels = list.map((unit, index) => (unit.vowel ? index : -1)).filter((index) => index >= 0);
  if (vowels.length <= 1) return [word];
  const cuts: number[] = [];
  for (let which = 1; which < vowels.length; which += 1) {
    const from = (vowels[which - 1] ?? 0) + 1;
    const to = vowels[which] ?? from;
    const between = to - from;
    // As many of the consonants in between as can begin a syllable go to the next one; the rest end this one.
    let take = Math.min(between, 1);
    for (const count of [3, 2]) {
      if (between >= count && ONSETS.has(list.slice(to - count, to).map((unit) => unit.text.toLowerCase()).join(""))) {
        take = count;
        break;
      }
    }
    cuts.push(to - take);
  }
  const syllables: string[] = [];
  let start = 0;
  for (const cut of [...cuts, list.length]) {
    syllables.push(list.slice(start, cut).map((unit) => unit.text).join(""));
    start = cut;
  }
  return syllables;
}

export interface Syllable {
  /** The letters as typed. */
  text: string;
  /** Its place in its word. */
  first: boolean;
  last: boolean;
}

/** The text as the syllables it is sung in. A hyphen cuts where it stands; a space ends a word. */
export function syllables(text: string): Syllable[] {
  const all: Syllable[] = [];
  for (const word of cleanText(text).split(" ")) {
    const parts = word.split(/[-·]/).filter((part) => part.replace(/'/g, "") !== "");
    const cut = parts.flatMap((part) => cutWord(part.replace(/'/g, "")));
    cut.forEach((syllable, index) => all.push({ text: syllable, first: index === 0, last: index === cut.length - 1 }));
  }
  return all.slice(0, MAX_SYLLABLES);
}

/** The line as it is cut, for showing: "Kaf·fee·pau·se jetzt". */
export function spell(text: string): string {
  return syllables(text).map((syllable, index) => (index === 0 ? "" : syllable.first ? " " : "·") + syllable.text).join("");
}

// ---- sounds -----------------------------------------------------------------------

/** A hiss or a pop: noise through one filter. A pop comes after a moment of silence. */
export interface Noise {
  type: "bandpass" | "highpass" | "lowpass";
  hz: number;
  q: number;
  level: number;
  ms: number;
  /** A plosive: its closure before the burst, in ms. */
  hold?: number;
}

/** A consonant that is hummed: the mouth nearly closed, the voice going on. */
export interface Hum {
  f: Formants;
  level: number;
  ms: number;
  /** A rolled r. */
  roll?: boolean;
}

export type Sound = { noise: Noise } | { hum: Hum } | { breath: number };

const hiss = (type: Noise["type"], hz: number, q: number, level: number, ms: number): Sound => ({ noise: { type, hz, q, level, ms } });
const pop = (type: Noise["type"], hz: number, q: number, level: number, voiced: boolean): Sound => ({ noise: { type, hz, q, level, ms: voiced ? 12 : 28, hold: voiced ? 14 : 24 } });
const hum = (f: Formants, level: number, ms: number, roll = false): Sound => ({ hum: { f, level, ms, roll } });

const S = hiss("highpass", 5200, 0.7, 0.5, 70);
const SCH = hiss("bandpass", 2700, 1.2, 0.6, 80);
const F = hiss("highpass", 2600, 0.7, 0.22, 60);
const P = pop("lowpass", 800, 0.7, 0.5, false);
const T = pop("highpass", 3800, 0.7, 0.5, false);
const K = pop("bandpass", 1700, 2, 0.55, false);
const W = hum([320, 900, 2300], 0.5, 45);

/** The sounds of a consonant as it is written; `back` says whether a dark vowel came before (for "ch"), `after` whether it comes after its vowel. */
function consonant(letters: string, back: boolean, after: boolean): Sound[] {
  switch (letters) {
    case "s": case "ß": return [S];
    case "z": case "tz": return [T, S];
    case "sch": return [SCH];
    case "f": case "v": case "ph": return [F];
    case "w": return [W];
    case "ch": return [hiss("bandpass", back ? 1500 : 3400, back ? 1.5 : 1.8, 0.4, 70)];
    case "h": return [{ breath: 55 }];
    case "p": return [P];
    case "b": return [pop("lowpass", 600, 0.7, 0.35, true)];
    case "t": case "dt": case "th": return [T];
    case "d": return [pop("highpass", 3000, 0.7, 0.3, true)];
    case "k": case "ck": case "c": case "q": return [K];
    case "g": return [pop("bandpass", 1400, 2, 0.35, true)];
    case "qu": return [K, W];
    case "x": return [K, S];
    case "pf": return [P, F];
    case "m": return [hum([260, 1000, 2200], 0.45, 55)];
    case "n": return [hum([260, 1500, 2600], 0.45, 50)];
    case "l": return [hum([360, 1300, 2700], 0.6, 45)];
    // After its vowel an r is hardly more than a darker vowel; before it, it rolls.
    case "r": return [after ? hum(VOWELS.R ?? [640, 1300, 2500], 0.7, 60) : hum([480, 1300, 1800], 0.5, 50, true)];
    case "j": case "y": return [hum([280, 2200, 2900], 0.6, 40)];
    default: return [];
  }
}

export interface Sung {
  /** What comes before the vowel, the vowel (one sound, or two it glides between), and what comes after. */
  before: Sound[];
  vowel: Formants;
  glide: Formants | null;
  after: Sound[];
  /** A syllable without a vowel ("pst"): only its consonants, on the beat. */
  mute: boolean;
}

const DARK = "aouAOU";
/** What may follow the murmured e of an ending: "bitte", "singen", "Kreisel", "Atem", "alles", "Weather" ... */
const ENDINGS = ["", "n", "l", "m", "s", "t", "r", "rn", "ln", "nd", "st"];

/** Whether a syllable is an ending whose e is only murmured: the last of several, a plain e, and little after it. */
function murmurs(syllable: Syllable): boolean {
  if (!syllable.last || syllable.first) return false;
  const list = units(syllable.text);
  const core = list.findIndex((unit) => unit.vowel);
  return core >= 0 && list[core]?.text.toLowerCase() === "e" && ENDINGS.includes(list.slice(core + 1).map((unit) => unit.text.toLowerCase()).join(""));
}

/** A syllable as the sounds it is sung with; `next` is the syllable that follows in the same word (a doubled consonant is sung once). */
export function sing(syllable: Syllable, next: Syllable | null = null): Sung {
  const list = units(syllable.text);
  const core = list.findIndex((unit) => unit.vowel);
  const onset = (core < 0 ? list : list.slice(0, core)).map((unit) => unit.text.toLowerCase());
  const coda = (core < 0 ? [] : list.slice(core + 1)).map((unit) => unit.text.toLowerCase());
  const letters = core < 0 ? "" : (list[core]?.text.toLowerCase() ?? "").replace(/h$/, "");
  const long = core >= 0 && (list[core]?.text.length ?? 1) > letters.length;

  let vowel: Formants = VOWELS["@"] ?? [500, 1500, 2500];
  let glide: Formants | null = null;
  let dark = false;
  if (letters === "ei" || letters === "ai" || letters === "ey" || letters === "ay") {
    vowel = VOWELS.a ?? vowel;
    glide = VOWELS.I ?? null;
  } else if (letters === "au") {
    vowel = VOWELS.a ?? vowel;
    glide = VOWELS.U ?? null;
    dark = true;
  } else if (letters === "eu" || letters === "äu" || letters === "oi") {
    vowel = VOWELS.O ?? vowel;
    glide = VOWELS.ü ?? null;
  } else if (letters !== "") {
    const letter = letters === "ie" ? "i" : letters === "y" ? "ü" : (letters[0] ?? "a");
    // An open syllable or a doubled letter keeps the vowel long; a closed one makes it short.
    const short = coda.length > 0 && !long && letters.length === 1;
    // The e of an ending ("bitte", "singen", "Kreisel") is only murmured, and that of "be-" and "ge-" before the
    // word proper ("Gespräch", "bekommen"); but a word keeps one full vowel ("Rumble", "geben").
    const murmured = letter === "e" && letters.length === 1 && !long
      && (murmurs(syllable)
        || (syllable.first && !syllable.last && coda.length === 0 && ["b", "g"].includes(onset.join("")) && !(next && murmurs(next))));
    vowel = murmured ? (coda[0] === "r" ? (VOWELS.R ?? vowel) : (VOWELS["@"] ?? vowel))
      : (short && "eiou".includes(letter) ? VOWELS[letter.toUpperCase()] : VOWELS[letter]) ?? vowel;
    dark = DARK.includes(letter);
  }

  // "st" and "sp" at the start of a word are "scht" and "schp".
  const before: Sound[] = [];
  onset.forEach((unit, index) => {
    if (unit === "s" && index === 0 && syllable.first && (onset[1] === "t" || onset[1] === "p")) before.push(SCH);
    else before.push(...consonant(unit, false, false));
  });
  const after: Sound[] = [];
  const upcoming = next && !next.first ? (units(next.text)[0]?.text.toLowerCase() ?? "") : "";
  coda.forEach((unit, index) => {
    // A consonant written twice across the cut ("Kaf-fee") is sung once, with the next syllable; a doubled letter is one sound.
    if (index === coda.length - 1 && unit === upcoming) return;
    if (index > 0 && unit === coda[index - 1] && unit.length === 1) return;
    // "ng" is one hum.
    if (unit === "g" && coda[index - 1] === "n") return;
    if (unit === "n" && coda[index + 1] === "g") {
      after.push(hum([260, 2000, 2700], 0.4, 55));
      return;
    }
    after.push(...consonant(unit, dark, true));
  });
  // Without a vowel there is nothing to sing: the consonants come on the beat.
  if (core < 0) return { before: [], vowel, glide: null, after: before, mute: true };
  return { before, vowel, glide, after, mute: false };
}

// ---- the mouth ------------------------------------------------------------------------

/** The vowels on the sound pad, as on a vowel chart: i top left, u top right, a at the bottom. */
const FIELD: readonly (readonly [x: number, y: number, vowel: string])[] = [[0.05, 0.95, "i"], [0.1, 0.5, "e"], [0.5, 0.05, "a"], [0.9, 0.5, "o"], [0.95, 0.95, "u"]];
export const FIELD_LETTERS = FIELD.map(([x, y, vowel]) => ({ x, y, vowel }));

/** The vowel a place on the sound pad means. */
export function fieldVowel(x: number, y: number): Formants {
  const sums = [0, 0, 0];
  let weights = 0;
  for (const [px, py, name] of FIELD) {
    const weight = 1 / (Math.hypot(x - px, y - py) ** 2 + 0.004);
    const formants = VOWELS[name] ?? [500, 1500, 2500];
    formants.forEach((hz, index) => { sums[index] = (sums[index] ?? 0) + Math.log(hz) * weight; });
    weights += weight;
  }
  return [Math.exp((sums[0] ?? 0) / weights), Math.exp((sums[1] ?? 0) / weights), Math.exp((sums[2] ?? 0) / weights)];
}

/** How strongly the sound pad pulls every vowel towards its place: not at all in the middle, wholly at the edge. */
export const fieldPull = (x: number, y: number): number => clamp(Math.hypot(x - 0.5, y - 0.5) / 0.4, 0, 1) ** 1.3;

/** A vowel as this voice sings it: pulled towards the pad's place, and higher or lower with the room in the mouth. */
export function shape(formants: Formants, voice: Voice, x: number, y: number): Formants {
  const pull = fieldPull(x, y);
  const towards = fieldVowel(x, y);
  const room = 1.22 * (0.82 / 1.22) ** voice.mouth;
  return [0, 1, 2].map((index) => {
    const own = formants[index] ?? 500;
    return own * ((towards[index] ?? own) / own) ** pull * room;
  }) as unknown as Formants;
}

/** How open and how wide a mouth is that makes these formants, both 0..1 (for drawing it). */
export function mouthOf(formants: Formants): { open: number; wide: number } {
  return { open: clamp((formants[0] - 260) / 520, 0, 1), wide: clamp((formants[1] - 750) / 1500, 0, 1) };
}

// ---- a syllable in time -----------------------------------------------------------------

export interface Plan {
  /** Seconds before the beat at which the syllable begins (its consonants come first; the vowel is on the beat). */
  lead: number;
  /** Where the mouth is and how loud the voice, as points in time (seconds from the beat; before it they are negative). */
  line: { at: number; f: Formants; level: number }[];
  noises: (Noise & { at: number })[];
  /** Breath through the mouth: an h. */
  breaths: { at: number; ms: number }[];
  rolls: { at: number; ms: number }[];
  /** When the syllable has ended. */
  end: number;
}

const length = (sound: Sound): number => ("noise" in sound ? (sound.noise.hold ?? 0) + sound.noise.ms : "hum" in sound ? sound.hum.ms : sound.breath) / 1000;

/** Lays a syllable's sounds out in time: `seconds` is how long the note is held from the beat on. */
export function plan(sung: Sung, seconds: number, tune: (formants: Formants) => Formants = (formants) => formants): Plan {
  const result: Plan = { lead: 0, line: [], noises: [], breaths: [], rolls: [], end: 0 };
  const vowel = tune(sung.vowel);
  const place = (sounds: readonly Sound[], from: number, squeeze: number): number => {
    let at = from;
    for (const sound of sounds) {
      const time = length(sound) * squeeze;
      if ("noise" in sound) {
        const hold = ((sound.noise.hold ?? 0) / 1000) * squeeze;
        // While the lips are closed the voice is silent.
        if (hold > 0) result.line.push({ at, f: vowel, level: 0 });
        result.noises.push({ ...sound.noise, ms: sound.noise.ms * squeeze, at: at + hold });
        if (hold === 0) result.line.push({ at, f: vowel, level: 0 });
      } else if ("hum" in sound) {
        result.line.push({ at, f: tune(sound.hum.f), level: sound.hum.level });
        if (sound.hum.roll) result.rolls.push({ at, ms: time * 1000 });
      } else {
        result.line.push({ at, f: vowel, level: 0 });
        result.breaths.push({ at, ms: time * 1000 });
      }
      at += time;
    }
    return at;
  };
  // What comes before the vowel is sung ahead of the beat, at most a seventh of a second.
  const ahead = sung.before.reduce((sum, sound) => sum + length(sound), 0);
  const lead = Math.min(ahead, 0.14);
  result.lead = lead;
  place(sung.before, -lead, ahead > 0 ? lead / ahead : 1);
  // What comes after it takes its time from the end of the note, but leaves the vowel at least half of it.
  const behind = sung.after.reduce((sum, sound) => sum + length(sound), 0);
  const held = Math.max(0.05, seconds);
  const tail = sung.mute ? behind : Math.min(behind, held * 0.5 + 0.02);
  const until = sung.mute ? 0 : Math.max(0.04, held - tail);
  result.line.push({ at: 0, f: vowel, level: sung.mute ? 0 : 1 });
  if (sung.glide) {
    // A double vowel stays on its first sound for a moment and then slides to the second.
    result.line.push({ at: until * 0.35, f: vowel, level: 1 });
    result.line.push({ at: Math.max(until * 0.4, until - 0.03), f: tune(sung.glide), level: 0.9 });
  }
  const done = place(sung.after, until, behind > 0 ? tail / behind : 1);
  result.line.push({ at: done, f: result.line[result.line.length - 1]?.f ?? vowel, level: 0 });
  result.line.sort((a, b) => a.at - b.at);
  result.end = done + 0.06;
  return result;
}

// ---- which syllable a hit sings ---------------------------------------------------------------

/** The number of the hit that ring plays at step `position` of its round after `local` steps of playing: every hit sings the next syllable. */
export function hitNumber(pattern: Pattern, position: number, local: number): number {
  let round = 0;
  let before = 0;
  for (let step = 0; step < pattern.len; step += 1) {
    if (!pattern.steps[step]?.on) continue;
    round += 1;
    if (step < position) before += 1;
  }
  return Math.floor(Math.max(0, local) / pattern.len) * round + before;
}

/** Lines to start from. */
const LINES = ["Coffee is on", "Spin Kreisel spin", "All is spinning", "Bring back the bass", "La la la la", "Oh no", "All night long", "I am a robot", "Kick clap kick clap", "Clap with us", "Hello world", "Just a bit longer"];

export function diceLine(random: Random, not = ""): string {
  const others = LINES.filter((line) => line !== not);
  return others[Math.floor(random() * others.length) % others.length] ?? "La la la";
}

/** The voice in a few words, for the status line. */
export function describeVoice(voice: Voice | null): string {
  if (!voice) return "no voice yet";
  const count = syllables(voice.text).length;
  return count === 0 ? "sings only the vowel from the sound pad" : `“${spell(voice.text)}”, ${count} ${count === 1 ? "syllable" : "syllables"}`;
}
