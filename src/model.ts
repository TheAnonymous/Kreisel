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

/** The ring's built sound: a body that rings when it is struck (see body.ts). */
export const BODY_SOUND = 5;
export const BODY_KIND_COUNT = 5;
export const EXCITER_COUNT = 5;

/**
 * A Klangkörper: a thing that rings. What it is, how big, how tight and of
 * what material it is, and what sets it going where.
 */
export interface Body {
  /** 0 skin, 1 string, 2 bar, 3 tube, 4 bowl. */
  kind: number;
  /** 0..1: small to big. Big is low (on rings without notes) or full, and rings long. */
  size: number;
  /** 0..1: slack to tight. Tight is bright and short. */
  tight: number;
  /** 0..1: wood, then metal, then glass. How long it rings, and how its overtones die. */
  material: number;
  /** 0 soft mallet, 1 hard mallet, 2 plucked, 3 bowed, 4 blown. */
  exciter: number;
  /** 0..1: where it is set going, from its middle to its edge. */
  where: number;
}

/** The ring's sung sound: a voice that sings a line of text, a syllable a hit (see voice.ts). */
export const VOICE_SOUND = 6;
export const MAX_VOICE_TEXT = 80;

export interface Voice {
  /** What it sings, as typed. */
  text: string;
  /** 0..1: the room in the mouth, from small and bright to big and dark. */
  mouth: number;
  /** 0..1: how much breath is in the voice, from clear to whispered. */
  breath: number;
}

export interface Track {
  /** Which sound of the ring's shelf (see sounds/index.ts), or OWN_SOUND for its picture, BODY_SOUND for its body, VOICE_SOUND for its voice. */
  sound: number;
  /** The two macros of the sound pad, 0..1. */
  x: number;
  y: number;
  level: number;
  hall: number;
  echo: number;
  /** "Zerre": how hard the ring is driven into its shaper, 0..1. The sparks of the weather come on top. */
  drive: number;
  mute: boolean;
  /** The ring's own sound, once one was painted. */
  bild: Bild | null;
  /** The ring's own body, once one was built. */
  body: Body | null;
  /** The ring's own voice, once it was given a line to sing. */
  voice: Voice | null;
}

/** Fog, sun, clouds, rain, sparks, hail: effects painted onto the wheel. */
export const WEATHER_COUNT = 6;
export const WEATHER_MAX = 15;
/** The strongest wind: four steps a bar, either way. */
export const WIND_MAX = 16;

/** The most the ground shakes at one step of the Nachbeben. */
export const RUMBLE_MAX = 15;

export interface Scene {
  patterns: Pattern[];
  /** One chord per bar, as a degree of the scale (0 = tonic). */
  chords: number[];
  /** The Nachbeben: how much the ground shakes at each step of the kick's ring, 0..RUMBLE_MAX (always MAX_STEPS of them). */
  rumble: number[];
  /** The weather over the wheel: for each kind of weather and each ring, how much of it lies on each step, 0..WEATHER_MAX. */
  weather: number[][][];
  /** How fast each kind of weather drifts around the wheel, in quarter steps a bar (negative: against the clock). */
  wind: number[];
}

export const MIN_BARS = 4;
/** 256 bars are a little under seven minutes at 150 beats a minute. */
export const MAX_BARS = 256;
/** The highest tension a bar can have. */
export const TENSION_MAX = 31;

/**
 * The piece: the ring around all rings, where one turn is the whole piece.
 * Each bar has a tension (how much is going on) and a scene. The Kreisel
 * arranges by it: rings come in as the tension rises, the sound opens up,
 * and before a steep rise it takes a run-up.
 */
export interface Piece {
  /** Play by the piece instead of looping the scene on the table. */
  on: boolean;
  /** One number per bar, 0..TENSION_MAX. Its length is the piece's length in bars. */
  tension: number[];
  /** The scene each bar plays. */
  scenes: number[];
  /** The rings in the order they come in as the tension rises. */
  order: number[];
}

export const MAX_TURNS = 12;
export const MAX_NAME = 16;

/** One turn of a Kreisel that goes from hand to hand: who took it, and the Kreisel as they passed it on. */
export interface Turn {
  name: string;
  /** The project after the turn, packed as in a link (without its own history). */
  state: unknown;
}

/**
 * "Reihum": the Kreisel travels as a link, everyone adds a turn, and every
 * turn stays in the link to be listened to again.
 */
export interface Relay {
  /** 0 anything goes, 1 one ring a turn, 2 "Stille Post": one ring a turn, hearing only the ring before. */
  rule: number;
  /** Stille Post has been revealed: everyone sees and hears everything. */
  open: boolean;
  turns: Turn[];
}

/**
 * The manner a Kreisel is built in: what its dice throw, what a new piece is
 * shaped like, and which values its controls go back to. "frei" is the
 * Kreisel as it always was; "techno" is hard and acid techno.
 */
export const STYLE_IDS = ["frei", "techno"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export interface Project {
  v: 1;
  style: StyleId;
  bpm: number;
  /** 0..1 */
  swing: number;
  /** 0 = C … 11 = H */
  root: number;
  scale: ScaleId;
  /** How much the kick pushes bass, chords and melody down, 0..1. */
  pump: number;
  /** "Druck": how hard the sum of everything is pressed against the ceiling before the master, 0..1. */
  pressure: number;
  /** How hard the kick is driven before anything else hears it, 0..1: from clean to clipped flat. */
  hard: number;
  /** The Nachbeben's character, both 0..1: from deep and clean to dirty, from one smooth swell to rolling sixteenths. */
  dirt: number;
  roll: number;
  volume: number;
  tracks: Track[];
  scenes: (Scene | null)[];
  /** The scene on the table. */
  scene: number;
  /** Play the filled scenes one after another. */
  chain: boolean;
  /** How often each scene plays its chords in the chain. */
  repeats: number;
  piece: Piece;
  /** The turns of a Kreisel that is passed around; `null` for one that is not. */
  relay: Relay | null;
}

export interface TrackInfo {
  name: string;
  /** Whether the ring plays notes of the key (bass, chords, melody). */
  melodic: boolean;
  xLabel: string;
  yLabel: string;
  /** What moving a step outwards does. */
  pitchLabel: string;
  color: string;
  /** The pitch a picture is painted at: played notes move it from here. 0 for drums, whose pictures are meant as painted. */
  refHz: number;
}

export const TRACK_INFO: Record<TrackKind, TrackInfo> = {
  kick: { name: "Kick", melodic: false, xLabel: "Ton", yLabel: "Länge", pitchLabel: "Stimmung", color: "#e4572e", refHz: 0 },
  snare: { name: "Snare", melodic: false, xLabel: "Ton", yLabel: "Länge", pitchLabel: "Stimmung", color: "#f29a2e", refHz: 0 },
  hat: { name: "Hi-Hat", melodic: false, xLabel: "Helligkeit", yLabel: "Länge", pitchLabel: "Offenheit", color: "#e9bd24", refHz: 0 },
  perc: { name: "Trommel", melodic: false, xLabel: "Ton", yLabel: "Länge", pitchLabel: "Tonhöhe", color: "#5fb85a", refHz: 110 },
  bass: { name: "Bass", melodic: true, xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Tonhöhe", color: "#27a79c", refHz: 55 },
  chord: { name: "Akkorde", melodic: true, xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Lage", color: "#3d7edb", refHz: 220 },
  lead: { name: "Melodie", melodic: true, xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Tonhöhe", color: "#a45de0", refHz: 440 },
};

export const trackInfo = (index: number): TrackInfo => TRACK_INFO[TRACK_KINDS[index] ?? "kick"];

export const SCENE_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function emptyStep(): Step {
  return { on: false, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 1 };
}

export function emptyPattern(len = 16): Pattern {
  return { len, steps: Array.from({ length: MAX_STEPS }, emptyStep) };
}

export function emptyRumble(): number[] {
  return Array.from({ length: MAX_STEPS }, () => 0);
}

export function emptyWeather(): number[][][] {
  return Array.from({ length: WEATHER_COUNT }, () => Array.from({ length: TRACK_COUNT }, () => Array.from({ length: MAX_STEPS }, () => 0)));
}

export function emptyWind(): number[] {
  return Array.from({ length: WEATHER_COUNT }, () => 0);
}

export function emptyScene(): Scene {
  return { patterns: Array.from({ length: TRACK_COUNT }, () => emptyPattern()), chords: [0, 5, 2, 6], rumble: emptyRumble(), weather: emptyWeather(), wind: emptyWind() };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Where `value` lands on a circle of `length` places: 0 up to, but not including, `length`, also for values below 0. */
export const wrap = (value: number, length: number): number => ((value % length) + length) % length;

/** The step at `index` of a pattern (the array always holds MAX_STEPS). */
export function stepAt(pattern: Pattern, index: number): Step {
  const step = pattern.steps[wrap(index, MAX_STEPS)];
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

/** Chords first, then hi-hat, bass, kick, snare, melody and the tuned drum last: how a piece usually builds. */
export const FIRST_ORDER = [5, 2, 4, 0, 1, 6, 3] as const;

/** The piece a project starts with: 32 bars that build, break and build higher. It waits switched off. */
export function firstPiece(scene = 0): Piece {
  const shape = [6, 7, 8, 9, 12, 14, 16, 18, 24, 24, 25, 25, 26, 26, 27, 27, 9, 9, 11, 14, 31, 31, 31, 31, 31, 31, 30, 30, 20, 15, 10, 6];
  return { on: false, tension: shape, scenes: shape.map(() => scene), order: [...FIRST_ORDER] };
}

/** The Werks-Kreisel: A minor, four chords, one ring of twelve against the sixteens. */
export function factoryProject(): Project {
  const scene: Scene = {
    rumble: emptyRumble(),
    weather: emptyWeather(),
    wind: emptyWind(),
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
    style: "frei",
    bpm: 112,
    swing: 0.18,
    root: 9,
    scale: "moll",
    pump: 0.3,
    pressure: 0,
    hard: 0,
    dirt: 0.35,
    roll: 0.2,
    volume: 0.8,
    tracks: [
      { sound: 0, x: 0.5, y: 0.5, level: 0.85, hall: 0, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.78, hall: 0.25, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 0, x: 0.5, y: 0.5, level: 0.7, hall: 0.05, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.6, hall: 0.2, echo: 0.25, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 3, x: 0.45, y: 0.4, level: 0.7, hall: 0, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 2, x: 0.45, y: 0.5, level: 0.7, hall: 0.3, echo: 0.15, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 0, x: 0.55, y: 0.45, level: 0.72, hall: 0.3, echo: 0.4, drive: 0, mute: false, bild: null, body: null, voice: null },
    ],
    scenes: [scene, null, null, null, null, null, null, null],
    scene: 0,
    chain: false,
    repeats: 1,
    piece: firstPiece(),
    relay: null,
  };
}

/** In techno the kick is there first, then hi-hat and clap around it, the tuned drum, the acid line, and stab and melody last. */
export const TECHNO_ORDER = [0, 2, 1, 3, 4, 5, 6] as const;

/**
 * The piece a techno Kreisel starts with, in the sections such a track has:
 * sixteen bars that build from the kick, thirty-two at full height, sixteen
 * that fall back, thirty-two at the top, sixteen that take it apart again.
 * It waits switched off.
 */
export function technoPiece(scene = 0): Piece {
  const climb = (from: number, to: number, bars: number): number[] => Array.from({ length: bars }, (_, bar) => Math.round(from + ((to - from) * bar) / (bars - 1)));
  const hold = (level: number, bars: number): number[] => Array.from({ length: bars }, () => level);
  const shape = [...climb(3, 17, 16), ...hold(27, 16), ...hold(31, 16), ...hold(9, 8), ...climb(9, 20, 8), ...hold(31, 32), ...climb(24, 3, 16)];
  return { on: false, tension: shape, scenes: shape.map(() => scene), order: [...TECHNO_ORDER] };
}

/**
 * The techno Kreisel, which a first visit starts with: 150 beats a minute and
 * no swing, G Phrygian over one chord, the kick on every beat with the ground
 * shaking between, an open hi-hat on the off-beats, a clap on two and four, a
 * low drum on a ring of twelve, and an acid line that slides three times.
 */
export function technoProject(): Project {
  const scene: Scene = {
    // Between two kicks the ground swells and is gone before the next: the Nachbeben's off-beat shape for a kick on every beat.
    rumble: Array.from({ length: MAX_STEPS }, (_, step) => (step < 16 ? ([0, 12, 15, 12][step % 4] ?? 0) : 0)),
    weather: emptyWeather(),
    wind: emptyWind(),
    chords: [0],
    patterns: [
      pattern(16, [0, 4, 8, 12]),
      pattern(16, [[4, 0, 1, 2], [12, 0, 1, 2]]),
      // Sixteenths that leave the kick alone; the off-beats are open and loud.
      pattern(16, [[1, 0, 1, 0], [2, 3, 1, 2], [3, 0, 1, 0], [5, 0, 1, 0], [6, 3, 1, 2], [7, 0, 1, 0], [9, 0, 1, 0], [10, 3, 1, 2], [11, 0, 1, 0], [13, 0, 1, 0], [14, 3, 1, 2], [15, 0, 1, 0, 0, 2]]),
      pattern(12, [[3, -3], [7, 0, 1, 0], [10, -3, 1, 1, 1]]),
      // An octave above the ground the Nachbeben shakes on: the root (7), the small step above it (8) and the octave (14).
      // A note right after another of a different pitch slides into it: the octave down to the root, the root up
      // the small step, and that step back to the root over the bar line.
      pattern(16, [[0, 7], [1, 7, 1, 0], [3, 14, 1, 2], [4, 7], [6, 7], [7, 8, 1, 2], [9, 7], [10, 7, 1, 0], [12, 14, 1, 2], [13, 14], [15, 8]]),
      pattern(16, [[6, 0, 1, 2], [13, 0, 1, 0]]),
      emptyPattern(16),
    ],
  };
  return {
    v: 1,
    style: "techno",
    bpm: 150,
    swing: 0,
    root: 7,
    scale: "phrygisch",
    pump: 0.55,
    pressure: 0.35,
    // The techno Kreisel's kick is a hard one: its body stands about twice as long as the clean kick's.
    hard: 0.55,
    dirt: 0.45,
    roll: 0.2,
    volume: 0.8,
    tracks: [
      // The hard kick, tuned down to the root (49 Hz). What makes a kick hard is its own; the rings after it are driven a little.
      { sound: 1, x: 0.3, y: 0.55, level: 0.9, hall: 0, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null },
      { sound: 1, x: 0.5, y: 0.35, level: 0.7, hall: 0.12, echo: 0, drive: 0.25, mute: false, bild: null, body: null, voice: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.62, hall: 0.03, echo: 0, drive: 0.15, mute: false, bild: null, body: null, voice: null },
      { sound: 0, x: 0.3, y: 0.45, level: 0.55, hall: 0.1, echo: 0.15, drive: 0.3, mute: false, bild: null, body: null, voice: null },
      { sound: 2, x: 0.5, y: 0.35, level: 0.72, hall: 0, echo: 0.12, drive: 0.4, mute: false, bild: null, body: null, voice: null },
      { sound: 1, x: 0.55, y: 0.3, level: 0.5, hall: 0.25, echo: 0.3, drive: 0.35, mute: false, bild: null, body: null, voice: null },
      { sound: 3, x: 0.55, y: 0.4, level: 0.6, hall: 0.1, echo: 0.3, drive: 0.3, mute: false, bild: null, body: null, voice: null },
    ],
    scenes: [scene, null, null, null, null, null, null, null],
    scene: 0,
    chain: false,
    repeats: 1,
    piece: technoPiece(),
    relay: null,
  };
}

/** What a Kreisel of a style starts as, and what its controls go back to. */
export const startProject = (style: StyleId): Project => (style === "techno" ? technoProject() : factoryProject());

/** A scene with nothing on its rings: over one chord in techno, over four otherwise. */
export function emptySceneFor(style: StyleId): Scene {
  return style === "techno" ? { ...emptyScene(), chords: [0] } : emptyScene();
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
