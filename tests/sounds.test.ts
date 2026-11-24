import { describe, expect, it } from "vitest";
import { deserialize, serialize } from "../src/codec";
import { BODY_SOUND, clone, factoryProject, OWN_SOUND, TRACK_COUNT, VOICE_SOUND } from "../src/model";
import { alongPalette, drumOf, FAMILY_COUNT, FAMILY_SIZE, familyNames, familySounds, LAST_SOUND, PALETTE_ORDER, placeOf, SOUND_COUNT, soundAt, soundCalled, soundName, technoSounds, toneOf, trimOf } from "../src/sounds/index";
import { TECHNO } from "../src/sounds/techno";
import { TRIMS } from "../src/sounds/trims";

const OWN = [OWN_SOUND, BODY_SOUND, VOICE_SOUND];
const rings = Array.from({ length: TRACK_COUNT }, (_, track) => track);

describe("the numbers of the sounds", () => {
  it("gives every place on the palette a number of its own, and none that of a ring's own sounds", () => {
    expect(PALETTE_ORDER).toHaveLength(SOUND_COUNT);
    expect(new Set(PALETTE_ORDER).size).toBe(50);
    for (const own of OWN) expect(PALETTE_ORDER).not.toContain(own);
    expect(Math.max(...PALETTE_ORDER)).toBe(LAST_SOUND);
    // Every whole number up to the last is a sound: the palette's fifty and the three of a ring's own.
    expect([...PALETTE_ORDER, ...OWN].sort((a, b) => a - b)).toEqual(Array.from({ length: LAST_SOUND + 1 }, (_, sound) => sound));
  });

  it("leaves the four classics the numbers they always had, at the head of the first four families", () => {
    for (let classic = 0; classic < 4; classic += 1) {
      expect(soundAt(classic, 0)).toBe(classic);
      expect(placeOf(classic)).toEqual({ family: classic, place: 0 });
    }
  });

  it("finds the place of a number and the number of a place", () => {
    for (let family = 0; family < FAMILY_COUNT; family += 1) {
      for (let place = 0; place < FAMILY_SIZE; place += 1) expect(placeOf(soundAt(family, place))).toEqual({ family, place });
    }
    for (const none of [...OWN, -1, 1.5, LAST_SOUND + 1, Number.NaN]) expect(placeOf(none)).toBeNull();
  });

  it("leafs along the palette, round and round, and onto it from a ring's own sound", () => {
    expect(alongPalette(0, 1)).toBe(soundAt(0, 1));
    expect(alongPalette(soundAt(0, 9), 1)).toBe(1);
    expect(alongPalette(0, -1)).toBe(LAST_SOUND);
    expect(alongPalette(LAST_SOUND, 1)).toBe(0);
    let sound = 0;
    const seen = new Set<number>();
    for (let step = 0; step < SOUND_COUNT; step += 1) {
      seen.add(sound);
      sound = alongPalette(sound, 1);
    }
    expect(sound).toBe(0);
    expect(seen.size).toBe(SOUND_COUNT);
    for (const own of OWN) {
      expect(alongPalette(own, 1)).toBe(0);
      expect(alongPalette(own, -1)).toBe(LAST_SOUND);
    }
  });
});

describe("the palettes", () => {
  it("hold five families of ten for every ring, each sound with a name of its own", () => {
    for (const track of rings) {
      const families = familyNames(track);
      expect(families).toHaveLength(FAMILY_COUNT);
      expect(new Set(families).size).toBe(FAMILY_COUNT);
      const names = families.flatMap((_, family) => {
        const sounds = familySounds(track, family);
        expect(sounds).toHaveLength(FAMILY_SIZE);
        expect(sounds.map((one) => one.sound)).toEqual(Array.from({ length: FAMILY_SIZE }, (_, place) => soundAt(family, place)));
        return sounds.map((one) => one.name);
      });
      expect(names.every((name) => name.length > 0 && name.length <= 13)).toBe(true);
      expect(new Set(names).size).toBe(SOUND_COUNT);
      for (const sound of PALETTE_ORDER) expect(soundName(track, sound)).toBe(names[PALETTE_ORDER.indexOf(sound)]);
      for (const own of OWN) expect(soundName(track, own)).toBeNull();
    }
  });

  it("name the first four families after the classics that lead them", () => {
    for (const track of rings) {
      const families = familyNames(track);
      for (let classic = 0; classic < 4; classic += 1) expect(soundName(track, classic)).toBe(families[classic]);
    }
    expect([0, 1, 2, 3].map((sound) => soundName(0, sound))).toEqual(["Round", "Hard", "Deep", "Dust"]);
    expect([0, 1, 2, 3].map((sound) => soundName(6, sound))).toEqual(["Pluck", "Bell", "Pipe", "Saw"]);
  });

  it("have a recipe for every sound but the classics: struck for the drums, played for the rings that play notes", () => {
    for (const track of rings) {
      for (const sound of PALETTE_ORDER) {
        const drum = drumOf(track, sound);
        const tone = toneOf(track, sound);
        if (sound < 4) expect([drum, tone]).toEqual([null, null]);
        else if (track < 4) expect([drum !== null, tone]).toEqual([true, null]);
        else expect([drum, tone !== null]).toEqual([null, true]);
      }
      for (const own of OWN) expect([drumOf(track, own), toneOf(track, own)]).toEqual([null, null]);
    }
  });

  it("only hold recipes that can sound", () => {
    const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
    for (const track of rings) {
      for (const sound of PALETTE_ORDER) {
        const drum = drumOf(track, sound);
        if (drum) {
          expect(drum.parts.length).toBeGreaterThan(0);
          for (const part of drum.parts) {
            expect(positive(part.level)).toBe(true);
            if ("clap" in part) {
              expect(positive(part.clap) && positive(part.tail[0]) && part.tail[1] >= part.tail[0]).toBe(true);
            } else {
              expect(positive(part.decay)).toBe(true);
              if ("tone" in part) expect(positive(part.at)).toBe(true);
              else expect(part.noise.length).toBeGreaterThan(0);
            }
          }
          expect(drum.drive ?? 0).toBeGreaterThanOrEqual(0);
          expect(drum.drive ?? 0).toBeLessThanOrEqual(1);
        }
        const tone = toneOf(track, sound);
        if (tone) {
          expect(tone.oscs.length).toBeGreaterThan(0);
          expect(tone.oscs.length).toBeLessThanOrEqual(4);
          expect(positive(tone.level)).toBe(true);
          expect(tone.amp.slice(1).every((value) => typeof value === "number" && value > 0)).toBe(true);
          if (tone.filter) expect(positive(tone.filter.from) && tone.filter.to > tone.filter.from).toBe(true);
          if (tone.fm) expect(positive(tone.fm.times) && tone.fm.index[1] >= tone.fm.index[0]).toBe(true);
        }
      }
    }
  });
});

describe("the techno group", () => {
  it("is ten of a ring's fifty sounds, each one once", () => {
    expect(TECHNO).toHaveLength(TRACK_COUNT);
    for (const track of rings) {
      const group = technoSounds(track);
      expect(group).toHaveLength(FAMILY_SIZE);
      expect(new Set(group.map((one) => one.sound)).size).toBe(FAMILY_SIZE);
      for (const one of group) {
        // A pick is a place on the palette: it has that sound's number and its name, and none of its own.
        expect(PALETTE_ORDER).toContain(one.sound);
        expect(one.name).toBe(soundName(track, one.sound));
      }
    }
    expect(technoSounds(TRACK_COUNT)).toEqual([]);
  });

  it("holds what the genre asks of each ring", () => {
    const names = (track: number): string[] => technoSounds(track).map((one) => one.name);
    // The hard kick the techno Kreisel starts with leads its group; a clap in layers, a noise snare driven hard.
    expect(names(0)[0]).toBe("Hard");
    expect(names(1)).toEqual(expect.arrayContaining(["Clap", "Crowd", "Pellets"]));
    // A drum machine's metal hat, an open one, ride and crash.
    expect(names(2)).toEqual(expect.arrayContaining(["Machine", "Open", "Ride", "Crash"]));
    expect(names(3)).toEqual(expect.arrayContaining(["Taiko", "Anvil", "Zap"]));
    expect(names(4)).toEqual(expect.arrayContaining(["Acid", "Fuzz", "Sub"]));
    expect(names(5)).toEqual(expect.arrayContaining(["Stab", "Rave"]));
    expect(names(6)).toEqual(expect.arrayContaining(["Scream", "Siren"]));
    // Every sound of the group that is driven by itself says so in its recipe: there are some on every drum ring.
    for (const track of [0, 1, 2, 3]) expect(technoSounds(track).some((one) => (drumOf(track, one.sound)?.drive ?? 0) > 0)).toBe(true);
  });

  it("finds a sound by the name its ring's palette lists it under", () => {
    expect(soundCalled(0, "Round")).toBe(0);
    expect(soundCalled(1, "Crowd")).toBe(soundAt(1, 3));
    expect(soundCalled(2, "Machine")).toBe(soundAt(1, 1));
    for (const track of rings) for (const sound of PALETTE_ORDER) expect(soundCalled(track, soundName(track, sound) ?? "")).toBe(sound);
    // The snare's ring has a "Machine" too, and it is another sound: a name is a ring's own.
    expect(soundCalled(1, "Machine")).not.toBe(soundCalled(2, "Machine"));
    expect(() => soundCalled(2, "Hoover")).toThrow("no sound called Hoover");
  });
});

describe("how loud the sounds are", () => {
  it("has a trim for every sound, and none for the classics", () => {
    expect(TRIMS).toHaveLength(TRACK_COUNT);
    for (const track of rings) {
      expect(TRIMS[track]).toHaveLength(SOUND_COUNT);
      for (const sound of PALETTE_ORDER) {
        const trim = trimOf(track, sound);
        expect(trim).toBeGreaterThanOrEqual(0.1);
        expect(trim).toBeLessThanOrEqual(8);
        if (sound < 4) expect(trim).toBe(1);
      }
      for (const own of OWN) expect(trimOf(track, own)).toBe(1);
    }
  });
});

describe("sounds in a saved Kreisel", () => {
  it("keeps every sound of the palette, and reads a number that is none as the first sound", () => {
    for (const sound of [0, 3, 7, 31, LAST_SOUND]) {
      const project = clone(factoryProject());
      for (const track of project.tracks) track.sound = sound;
      expect(deserialize(serialize(project)).tracks.map((track) => track.sound)).toEqual(Array.from({ length: TRACK_COUNT }, () => sound));
    }
    const project = clone(factoryProject());
    project.tracks[0]!.sound = LAST_SOUND + 1;
    project.tracks[1]!.sound = -2;
    expect(deserialize(serialize(project)).tracks.slice(0, 2).map((track) => track.sound)).toEqual([0, 0]);
  });

  it("still sends a ring back to its first sound when it is to play a sound of its own that it does not have", () => {
    const project = clone(factoryProject());
    project.tracks[2]!.sound = BODY_SOUND;
    expect(deserialize(serialize(project)).tracks[2]!.sound).toBe(0);
  });
});
