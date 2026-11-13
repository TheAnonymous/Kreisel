/*
 * What a Kreisel is made of. Seven rings (tracks), each with a pattern of up
 * to 32 steps per scene; a key, a chord progression and the mix. Everything
 * here is plain data, so it can be saved, shared as a link and undone.
 */

export const TRACK_KINDS = ["kick", "snare", "hat", "perc", "bass", "chord", "lead"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export const TRACK_COUNT = TRACK_KINDS.length;
export const MAX_STEPS = 32;
export const MIN_STEPS = 2;
export const SCENE_COUNT = 8;
export const MAX_CHORDS = 8;
/** Steps of one bar: the chord changes with every bar. */
export const BAR = 16;
export const PITCH_MIN = -7;
export const PITCH_MAX = 14;
export const MAX_NOTE_LENGTH = 16;

export type ScaleId = "moll" | "dur" | "dorisch" | "phrygisch" | "lydisch" | "mixolydisch" | "harmonisch";

export interface Step {
  on: boolean;
  /** 0 quiet, 1 normal, 2 accent. */
  vel: number;
  /** 0 always, 1 = 75 %, 2 = 50 %, 3 = 25 %. */
  chance: number;
  /** How many times the step strikes (1 to 4). */
  ratchet: number;
  /** Scale steps: the melody for tuned rings, the tuning (or openness) of a drum. */
  pitch: number;
  /** Steps the note is held (tuned rings). */
  len: number;
}

export interface Pattern {
  /** How many steps the ring has; the rest of `steps` waits unseen. */
  len: number;
  steps: Step[];
}

/** A ring's own sound is sound number four: the picture painted for it. */
export const OWN_SOUND = 4;
export const MAX_STROKES = 8;
export const MAX_STROKE_POINTS = 32;
/** A picture's time runs from 0 to TIME_MAX, its pitch from 0 (27.5 Hz) to HEIGHT_MAX (nine octaves up). */
export const TIME_MAX = 255;
export const HEIGHT_MAX = 65_535;

/** One stroke of the brush: a tone (or a hiss) that moves through pitch as time passes. */
export interface Stroke {
  /** 0 hums (a sine), 1 saws (a sawtooth), 2 hisses (noise around that pitch). */
  kind: number;
  /** How much paint the brush held: 0 thin and quiet, 2 thick and loud. */
  size: number;
  /** Painted from right to left: the stroke grows louder instead of running dry. */
  swell: boolean;
  /** t0, y0, t1, y1 …, with time never running backwards. */
  points: number[];
}

/** A painted sound: time from left to right, pitch from bottom to top. */
export interface Bild {
  strokes: Stroke[];
  /** Where a held note stands still until it ends (rings that play notes); `null` rings out like a struck sound. */
  hold: number | null;
}

export interface Track {
  /** Which of the ring's four sounds, or OWN_SOUND for its picture. */
  sound: number;
  /** The two macros of the sound pad, 0..1. */
  x: number;
  y: number;
  level: number;
  hall: number;
  echo: number;
  mute: boolean;
  /** The ring's own sound, once one was painted. */
  bild: Bild | null;
}

export interface Scene {
  patterns: Pattern[];
  /** One chord per bar, as a degree of the scale (0 = tonic). */
  chords: number[];
}

export interface Project {
  v: 1;
  bpm: number;
  /** 0..1 */
  swing: number;
  /** 0 = C … 11 = H */
  root: number;
  scale: ScaleId;
  /** How much the kick pushes bass, chords and melody down, 0..1. */
  pump: number;
  volume: number;
  tracks: Track[];
  scenes: (Scene | null)[];
  /** The scene on the table. */
  scene: number;
  /** Play the filled scenes one after another. */
  chain: boolean;
  /** How often each scene plays its chords in the chain. */
  repeats: number;
}

export interface TrackInfo {
  name: string;
  /** Whether the ring plays notes of the key (bass, chords, melody). */
  melodic: boolean;
  sounds: readonly [string, string, string, string];
  xLabel: string;
  yLabel: string;
  /** What moving a step outwards does. */
  pitchLabel: string;
  color: string;
  /** The pitch a picture is painted at: played notes move it from here. 0 for drums, whose pictures are meant as painted. */
  refHz: number;
}

export const TRACK_INFO: Record<TrackKind, TrackInfo> = {
  kick: { name: "Kick", melodic: false, sounds: ["Rund", "Hart", "Tief", "Staub"], xLabel: "Ton", yLabel: "Länge", pitchLabel: "Stimmung", color: "#e4572e", refHz: 0 },
  snare: { name: "Snare", melodic: false, sounds: ["Snare", "Klatsch", "Rand", "Schnipp"], xLabel: "Ton", yLabel: "Länge", pitchLabel: "Stimmung", color: "#f29a2e", refHz: 0 },
  hat: { name: "Hi-Hat", melodic: false, sounds: ["Seide", "Blech", "Shaker", "Zisch"], xLabel: "Helligkeit", yLabel: "Länge", pitchLabel: "Offenheit", color: "#e9bd24", refHz: 0 },
  perc: { name: "Trommel", melodic: false, sounds: ["Tom", "Conga", "Kuhglocke", "Holz"], xLabel: "Ton", yLabel: "Länge", pitchLabel: "Tonhöhe", color: "#5fb85a", refHz: 110 },
  bass: { name: "Bass", melodic: true, sounds: ["Sub", "Säge", "Acid", "Gummi"], xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Tonhöhe", color: "#27a79c", refHz: 55 },
  chord: { name: "Akkorde", melodic: true, sounds: ["Fläche", "Stab", "E-Piano", "Orgel"], xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Lage", color: "#3d7edb", refHz: 220 },
  lead: { name: "Melodie", melodic: true, sounds: ["Zupf", "Glocke", "Pfeife", "Säge"], xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Tonhöhe", color: "#a45de0", refHz: 440 },
};

export const trackInfo = (index: number): TrackInfo => TRACK_INFO[TRACK_KINDS[index] ?? "kick"];

export const SCENE_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function emptyStep(): Step {
  return { on: false, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 1 };
}

export function emptyPattern(len = 16): Pattern {
  return { len, steps: Array.from({ length: MAX_STEPS }, emptyStep) };
}

export function emptyScene(): Scene {
  return { patterns: Array.from({ length: TRACK_COUNT }, () => emptyPattern()), chords: [0, 5, 2, 6] };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** The step at `index` of a pattern (the array always holds MAX_STEPS). */
export function stepAt(pattern: Pattern, index: number): Step {
  const step = pattern.steps[((index % MAX_STEPS) + MAX_STEPS) % MAX_STEPS];
  if (!step) throw new Error("pattern without steps");
  return step;
}

type Note = number | [index: number, pitch?: number, len?: number, vel?: number, chance?: number, ratchet?: number];

function pattern(len: number, notes: readonly Note[]): Pattern {
  const result = emptyPattern(len);
  for (const note of notes) {
    const [index, pitch = 0, noteLen = 1, vel = 1, chance = 0, ratchet = 1] = typeof note === "number" ? [note] : note;
    Object.assign(stepAt(result, index), { on: true, pitch, len: noteLen, vel, chance, ratchet });
  }
  return result;
}

/** The groove a first visit starts with: A minor, four chords, one ring of twelve against the sixteens. */
export function factoryProject(): Project {
  const scene: Scene = {
    chords: [0, 5, 2, 6],
    patterns: [
      pattern(16, [[0, 0, 1, 2], 4, [8, 0, 1, 2], 12]),
      pattern(16, [4, [12, 0, 1, 2]]),
      pattern(16, [[0, 0, 1, 0], 2, [4, 0, 1, 0], 6, [8, 0, 1, 0], 10, [12, 0, 1, 0], [14, 3, 1, 1]]),
      pattern(12, [[0, 0, 1, 1], [3, 2, 1, 0], [7, 4, 1, 1], [10, 2, 1, 0, 2]]),
      pattern(16, [[0, 0, 2, 2], [3, 0], [6, 7], [8, 0, 2], [11, 0, 1, 0], [14, 4]]),
      pattern(16, [[0, 0, 3, 2], [6, 0, 2], [11, 1, 3]]),
      pattern(16, [[0, 4, 2], [3, 2], [6, 4], [8, 7, 2, 2], [10, 6], [12, 4, 2], [14, 2, 1, 0]]),
    ],
  };
  return {
    v: 1,
    bpm: 112,
    swing: 0.18,
    root: 9,
    scale: "moll",
    pump: 0.3,
    volume: 0.8,
    tracks: [
      { sound: 0, x: 0.5, y: 0.5, level: 0.85, hall: 0, echo: 0, mute: false, bild: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.78, hall: 0.25, echo: 0, mute: false, bild: null },
      { sound: 0, x: 0.5, y: 0.5, level: 0.7, hall: 0.05, echo: 0, mute: false, bild: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.6, hall: 0.2, echo: 0.25, mute: false, bild: null },
      { sound: 3, x: 0.45, y: 0.4, level: 0.7, hall: 0, echo: 0, mute: false, bild: null },
      { sound: 2, x: 0.45, y: 0.5, level: 0.7, hall: 0.3, echo: 0.15, mute: false, bild: null },
      { sound: 0, x: 0.55, y: 0.45, level: 0.72, hall: 0.3, echo: 0.4, mute: false, bild: null },
    ],
    scenes: [scene, null, null, null, null, null, null, null],
    scene: 0,
    chain: false,
    repeats: 1,
  };
}

/** The scene on the table (there is always one). */
export function currentScene(project: Project): Scene {
  const scene = project.scenes[project.scene] ?? project.scenes.find((candidate) => candidate !== null);
  if (!scene) throw new Error("project without scenes");
  return scene;
}

export function patternOf(project: Project, track: number): Pattern {
  const found = currentScene(project).patterns[track];
  if (!found) throw new Error("scene without that ring");
  return found;
}

export function trackOf(project: Project, track: number): Track {
  const found = project.tracks[track];
  if (!found) throw new Error("project without that ring");
  return found;
}
