import { describe, expect, it } from "vitest";
import { factoryProject } from "../src/model";
import { bassMidi, chordMidis, chordName, chordQuality, chordRoman, leadMidi, noteName, percMidi, scaleSemis } from "../src/music";

describe("scales", () => {
  it("walks a scale across octaves in both directions", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((degree) => scaleSemis("moll", degree))).toEqual([0, 2, 3, 5, 7, 8, 10, 12]);
    expect(scaleSemis("dur", -1)).toBe(-1);
    expect(scaleSemis("dur", 9)).toBe(16);
    expect(scaleSemis("moll", -7)).toBe(-12);
  });

  it("names the chords of A minor", () => {
    const names = [0, 1, 2, 3, 4, 5, 6].map((degree) => chordName(9, "moll", degree));
    expect(names).toEqual(["Am", "B°", "C", "Dm", "Em", "F", "G"]);
    expect(chordRoman("moll", 0)).toBe("i");
    expect(chordRoman("moll", 1)).toBe("ii°");
    expect(chordRoman("moll", 5)).toBe("VI");
    expect(chordQuality("harmonisch", 2)).toBe("+");
    expect(noteName(70)).toBe("Bb");
    expect(noteName(71)).toBe("B");
  });
});

describe("where the rings sit", () => {
  const project = factoryProject();

  it("keeps the bass low and folds high chords below the tonic", () => {
    expect(bassMidi(project, 0, 0)).toBe(33);
    expect(bassMidi(project, 0, 7)).toBe(45);
    // G is ten semitones above A: it is played below instead.
    expect(bassMidi(project, 6, 0)).toBe(31);
    for (let root = 0; root < 12; root += 1) {
      for (let chord = 0; chord < 7; chord += 1) {
        const midi = bassMidi({ ...project, root }, chord, 0);
        expect(midi).toBeGreaterThanOrEqual(24);
        expect(midi).toBeLessThanOrEqual(48);
      }
    }
  });

  it("puts melody and tuned drums on notes of the key", () => {
    expect(leadMidi(project, 0) % 12).toBe(9);
    expect(leadMidi(project, 2) - leadMidi(project, 0)).toBe(3);
    expect(percMidi(project, 0) % 12).toBe(9);
  });

  it("voices chords close together and turns them over", () => {
    for (let chord = 0; chord < 7; chord += 1) {
      const notes = chordMidis(project, chord, 0);
      expect(notes).toHaveLength(3);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(55);
      expect(Math.max(...notes)).toBeLessThan(67);
    }
    const base = chordMidis(project, 0, 0);
    const up = chordMidis(project, 0, 1);
    expect(up[2]).toBe((base[0] ?? 0) + 12);
    expect(chordMidis(project, 0, 3)).toEqual(base.map((note) => note + 12));
    expect(chordMidis(project, 0, -3)).toEqual(base.map((note) => note - 12));
  });
});
