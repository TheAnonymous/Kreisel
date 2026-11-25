import { BAR, type Project, type Scene, type ScaleId, wrap } from "./model";

/*
 * The key: scales, the chords that live in them and where each ring's notes
 * sit. Rings store scale steps, never semitones, so whatever is painted
 * stays in the key, and changing key or scale re-tunes the whole Kreisel.
 */

export const SCALES: Record<ScaleId, { name: string; steps: readonly number[] }> = {
  moll: { name: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  dur: { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  dorisch: { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygisch: { name: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  lydisch: { name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydisch: { name: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
  harmonisch: { name: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
};

export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

/** The twelve notes as the page names them, the black keys as a key signature usually has them. */
export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;


/** Semitones above the key's root for a scale step (7 is the octave, −1 the step below the root). */
export function scaleSemis(scale: ScaleId, degree: number): number {
  const steps = SCALES[scale].steps;
  return (steps[wrap(degree, 7)] ?? 0) + 12 * Math.floor(degree / 7);
}

export function noteName(midi: number): string {
  return NOTE_NAMES[wrap(Math.round(midi), 12)] ?? "C";
}

/** The triad on a scale step: "", "m", "°" or "+". */
export function chordQuality(scale: ScaleId, degree: number): string {
  const third = scaleSemis(scale, degree + 2) - scaleSemis(scale, degree);
  const fifth = scaleSemis(scale, degree + 4) - scaleSemis(scale, degree);
  if (fifth === 6) return "°";
  if (fifth === 8) return "+";
  return third === 3 ? "m" : "";
}

export function chordName(root: number, scale: ScaleId, degree: number): string {
  return `${noteName(root + scaleSemis(scale, degree))}${chordQuality(scale, degree)}`;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

/** The step as a Roman numeral, lower case for minor and diminished chords. */
export function chordRoman(scale: ScaleId, degree: number): string {
  const quality = chordQuality(scale, degree);
  const numeral = ROMAN[wrap(degree, 7)] ?? "I";
  return quality === "m" || quality === "°" ? `${numeral.toLowerCase()}${quality === "°" ? "°" : ""}` : `${numeral}${quality}`;
}

/** The root moved into the octave around `center` (never more than a tritone away). */
export function rootNear(root: number, center: number): number {
  return center + wrap(root - center + 6, 12) - 6;
}

/** Bass notes follow the chord: step 0 is its root, 4 its fifth, 7 the octave. Chords a fifth or more above the tonic fold below it. */
export function bassMidi(project: Project, chord: number, pitch: number): number {
  const base = rootNear(project.root, 36);
  const fold = scaleSemis(project.scale, wrap(chord, 7)) >= 7 ? -12 : 0;
  return base + fold + scaleSemis(project.scale, wrap(chord, 7) + pitch);
}

/** Melody notes are steps of the key, whatever the chord. */
export function leadMidi(project: Project, pitch: number): number {
  return rootNear(project.root, 63) + scaleSemis(project.scale, pitch);
}

/** Tuned drums sit two octaves below the melody. */
export function percMidi(project: Project, pitch: number): number {
  return rootNear(project.root, 46) + scaleSemis(project.scale, pitch);
}

/**
 * The chord's three notes, close together around middle C so that changing
 * chords moves each voice as little as possible. `pitch` turns the voicing
 * over: each step up lifts the lowest note an octave.
 */
export function chordMidis(project: Project, chord: number, pitch: number): number[] {
  const degree = wrap(chord, 7);
  const notes = [0, 2, 4].map((offset) => {
    const midi = project.root + scaleSemis(project.scale, degree + offset);
    return 55 + wrap(midi - 55, 12);
  }).sort((a, b) => a - b);
  for (let turn = 0; turn < Math.abs(pitch); turn += 1) {
    if (pitch > 0) notes.push((notes.shift() ?? 60) + 12);
    else notes.unshift((notes.pop() ?? 60) - 12);
  }
  return notes;
}

/** The chord sounding at `position` (steps since the scene began). */
export function chordAt(scene: Scene, position: number): number {
  const bar = Math.floor(Math.max(0, position) / BAR);
  return scene.chords[bar % Math.max(1, scene.chords.length)] ?? 0;
}

/** What a step's pitch is called on a ring, for hints: the note for tuned rings. */
export function pitchName(project: Project, track: number, pitch: number, chord: number): string {
  if (track === 4) return noteName(bassMidi(project, chord, pitch));
  if (track === 5) return pitch === 0 ? "root position" : `register ${pitch > 0 ? "+" : "−"}${Math.abs(pitch)}`;
  if (track === 6) return noteName(leadMidi(project, pitch));
  if (track === 3) return noteName(percMidi(project, pitch));
  if (track === 2) return pitch > 0 ? `open ${pitch}` : pitch < 0 ? `short ${-pitch}` : "closed";
  return pitch === 0 ? "normal" : `${pitch > 0 ? "+" : "−"}${Math.abs(pitch)}`;
}
