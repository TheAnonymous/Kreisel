import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, pack, unpack } from "../src/codec";
import { ACID_SOUND, currentScene, emptySceneFor, factoryProject, FIRST_ORDER, MASTER_ORDER, masterPiece, MAX_BARS, patternOf, PITCH_MAX, PITCH_MIN, startProject, stepAt, TECHNO_ORDER, technoPiece, technoProject, TENSION_MAX, TRACK_COUNT, wrap, type Pattern, type Piece } from "../src/model";
import { nextHit, slidesInto } from "../src/acid";
import { ACID_ROOT, activeSteps, dice, seeded } from "../src/patterns";
import { barCount, dicePiece, planBar, resizePiece, soundPiece, technoSections } from "../src/piece";
import { shapeOf } from "../src/rumble";
import { hatChokes, isCymbal, isOpenHat, OPEN_HAT } from "../src/hat";
import { soundCalled, soundName, technoSounds } from "../src/sounds/index";

/** Seeds far apart: neighbouring ones start the generator off alike. */
const SEEDS = Array.from({ length: 60 }, (_, index) => index * 7919 + 13);

/** The notes the acid machine slides into at 150 beats a minute: the note before is held into them and differs in pitch. The ring is a circle. */
const slides = (pattern: Pattern): number[] => activeSteps(pattern).filter((index) => slidesInto(pattern, index, ACID_SOUND, 0.1)).map((index) => nextHit(pattern, index)?.index ?? -1).sort((a, b) => a - b);

/** The notes that follow another of a different pitch without a rest: where the older bass sounds glide, and the machine only if the first is held. */
const touching = (pattern: Pattern): number[] => activeSteps(pattern).filter((index) => {
  const before = stepAt(pattern, wrap(index - 1, pattern.len));
  return activeSteps(pattern).length > 1 && before.on && before.pitch !== stepAt(pattern, index).pitch;
});

const playing = (piece: Piece, bar: number): number[] => planBar(piece, bar).gates.flatMap((gate, ring) => (gate > 0 ? [ring] : []));

describe("the techno Kreisel", () => {
  const project = technoProject();
  const scene = currentScene(project);

  it("is fast and straight, in a dark scale over one chord", () => {
    expect([project.style, project.bpm, project.swing, project.scale, scene.chords]).toEqual(["techno", 150, 0, "phrygisch", [0]]);
    expect(project.pump).toBeGreaterThan(factoryProject().pump);
  });

  it("has the kick on every beat, an open hi-hat between, a clap on two and four", () => {
    expect(activeSteps(patternOf(project, 0))).toEqual([0, 4, 8, 12]);
    expect(activeSteps(patternOf(project, 1))).toEqual([4, 12]);
    const hat = patternOf(project, 2);
    for (const offbeat of [2, 6, 10, 14]) expect([stepAt(hat, offbeat).on, stepAt(hat, offbeat).vel, stepAt(hat, offbeat).pitch > 0]).toEqual([true, 2, true]);
    // The hi-hat leaves the kick alone.
    for (const beat of [0, 4, 8, 12]) expect(stepAt(hat, beat).on).toBe(false);
    expect(patternOf(project, 3).len).toBe(12);
    expect(activeSteps(patternOf(project, 6))).toEqual([]);
  });

  it("claps with many hands and has a drum machine's hi-hat, both from the techno group of their rings", () => {
    expect([1, 2].map((track) => soundName(track, project.tracks[track]?.sound ?? -1))).toEqual(["Menge", "Maschine"]);
    for (const track of [0, 1, 2, 3]) expect(technoSounds(track).map((one) => one.sound)).toContain(project.tracks[track]?.sound);
    // The Werks-Kreisel plays what it always played.
    expect(factoryProject().tracks.map((track) => track.sound)).toEqual([0, 1, 0, 1, 3, 2, 0]);
  });

  it("has a hi-hat that is one voice: every open hit is followed by a closed one that cuts it off", () => {
    expect([hatChokes("techno"), hatChokes("frei")]).toEqual([true, false]);
    expect([isOpenHat(3), isOpenHat(1), isOpenHat(0), isOpenHat(-2)]).toEqual([true, true, false, false]);
    const hat = patternOf(project, 2);
    for (const offbeat of [2, 6, 10, 14]) {
      const after = stepAt(hat, offbeat + 1);
      // Open far enough to ring into the closed hit that follows.
      expect([stepAt(hat, offbeat).pitch, after.on, isOpenHat(after.pitch)]).toEqual([OPEN_HAT, true, false]);
    }
    expect(OPEN_HAT).toBeGreaterThan(3);
  });

  it("lets the ground shake between the kicks, in the Nachbeben's off-beat shape", () => {
    expect(shapeOf(patternOf(project, 0), scene.rumble)).toBe(0);
  });

  it("has an acid line of three notes that slides three times, once over the bar line", () => {
    const acid = patternOf(project, 4);
    // It is played by the acid machine, and every slide is a note held into the next.
    expect(project.tracks[4]?.sound).toBe(ACID_SOUND);
    expect(project.tracks[4]?.acid).toEqual({ bite: 0.6, decay: 0.35, square: false });
    expect(touching(acid)).toEqual([0, 4, 7]);
    expect([3, 6, 15].map((index) => stepAt(acid, index).len)).toEqual([2, 2, 2]);
    expect([...new Set(activeSteps(acid).map((index) => stepAt(acid, index).pitch))].sort((a, b) => a - b)).toEqual([ACID_ROOT, ACID_ROOT + 1, ACID_ROOT + 7]);
    expect(slides(acid)).toEqual([0, 4, 7]);
    expect(activeSteps(acid).filter((index) => stepAt(acid, index).vel === 2)).toEqual([3, 7, 12]);
  });

  it("builds from the kick: its piece has the kick in first and is a whole track (see master.test.ts)", () => {
    expect(project.piece).toEqual(masterPiece());
    expect(project.piece.order).toEqual([...MASTER_ORDER]);
    expect(project.piece.on).toBe(false);
    expect(barCount(project.piece)).toBe(160);
    expect(playing(project.piece, 0)).toEqual([0]);
    expect(playing(project.piece, 128)).toHaveLength(TRACK_COUNT);
    // The full sections take a run-up, the breaks throw the echo.
    expect([31, 71, 119, 127].map((bar) => planBar(project.piece, bar).rise)).toEqual([true, true, true, true]);
    expect([63, 103].map((bar) => planBar(project.piece, bar).fall)).toEqual([true, true]);
  });

  it("has a plain form for an empty Kreisel: the kick in first, a break, the top, an outro", () => {
    const plain = technoPiece();
    expect([plain.order, plain.on, barCount(plain)]).toEqual([[...TECHNO_ORDER], false, 112]);
    expect(playing(plain, 0)).toEqual([0]);
    expect(playing(plain, 16)).toHaveLength(TRACK_COUNT);
    expect([planBar(plain, 15).rise, planBar(plain, 47).fall, planBar(plain, 63).rise]).toEqual([true, true, true]);
  });

  it("travels in a link with its style; a link from before there were styles is free", async () => {
    expect(await decodeLink(await encodeLink(project))).toEqual(project);
    expect(pack(project).g).toBe("techno");
    const old = pack(factoryProject());
    expect("g" in old).toBe(false);
    expect(unpack(old).style).toBe("frei");
    expect(unpack({ ...old, g: "polka" }).style).toBe("frei");
  });

  it("leaves the Werks-Kreisel as it was", () => {
    const werk = factoryProject();
    expect([werk.style, werk.bpm, werk.swing, werk.scale, currentScene(werk).chords, werk.piece.order]).toEqual(["frei", 112, 0.18, "moll", [0, 5, 2, 6], [...FIRST_ORDER]]);
  });

  it("is what a techno Kreisel goes back to, and empties over one chord", () => {
    expect(startProject("techno")).toEqual(technoProject());
    expect(startProject("frei")).toEqual(factoryProject());
    expect(emptySceneFor("techno").chords).toEqual([0]);
    expect(emptySceneFor("frei").chords).toEqual([0, 5, 2, 6]);
  });
});

describe("techno dice", () => {
  it("put the kick on every beat, whatever the length of the ring", () => {
    for (const seed of SEEDS) {
      for (const len of [16, 32, 12, 7]) {
        const kick = dice(0, len, seeded(seed), "techno");
        for (let beat = 0; beat < len; beat += 4) expect([stepAt(kick, beat).on, stepAt(kick, beat).vel, stepAt(kick, beat).chance]).toEqual([true, 1, 0]);
        // What else there is, is quiet and comes after the last beat.
        for (const index of activeSteps(kick).filter((step) => step % 4 !== 0)) expect([stepAt(kick, index).vel, index > len - 4]).toEqual([0, true]);
      }
    }
  });

  it("open the hi-hat between the kicks and clap on four", () => {
    for (const seed of SEEDS) {
      const hat = dice(2, 16, seeded(seed), "techno");
      for (const offbeat of [2, 6, 10, 14]) expect([stepAt(hat, offbeat).on, stepAt(hat, offbeat).vel, stepAt(hat, offbeat).pitch]).toEqual([true, 2, OPEN_HAT]);
      const clap = dice(1, 16, seeded(seed), "techno");
      expect(stepAt(clap, 12).on).toBe(true);
      expect(activeSteps(clap).every((index) => [4, 12, 15].includes(index))).toBe(true);
    }
  });

  it("let a cymbal on the hi-hat's ring keep time instead: between the kicks, on the eighths or on the beats, and never open", () => {
    const ride = soundCalled(2, "Ride");
    expect([isCymbal(ride), isCymbal(soundCalled(2, "Crash")), isCymbal(soundCalled(2, "Maschine")), isCymbal(0), isCymbal(4)]).toEqual([true, true, false, false, false]);
    const figures = new Set<string>();
    for (const seed of SEEDS) {
      const pattern = dice(2, 16, seeded(seed), "techno", ride);
      const hits = activeSteps(pattern);
      figures.add(hits.join(" "));
      for (const index of hits) expect([isOpenHat(stepAt(pattern, index).pitch), stepAt(pattern, index).ratchet, stepAt(pattern, index).chance]).toEqual([false, 1, 0]);
      // The same hi-hat sound that is no cymbal gets the open hat between the kicks, as before.
      expect(dice(2, 16, seeded(seed), "techno", soundCalled(2, "Maschine"))).toEqual(dice(2, 16, seeded(seed), "techno"));
      // Other styles and other rings do not ask what the ring plays.
      expect(dice(2, 16, seeded(seed), "frei", ride)).toEqual(dice(2, 16, seeded(seed), "frei"));
      expect(dice(1, 16, seeded(seed), "techno", ride)).toEqual(dice(1, 16, seeded(seed), "techno"));
    }
    expect([...figures].sort()).toEqual(["0 2 4 6 8 10 12 14", "0 4 8 12", "2 6 10 14"]);
    // A ring too short to have a place between the kicks still gets a hit.
    for (const seed of SEEDS) expect(activeSteps(dice(2, 2, seeded(seed), "techno", ride)).length).toBeGreaterThan(0);
  });

  it("throw acid lines of few notes that rest, slide and accent", () => {
    let roots = 0;
    let notes = 0;
    let sliding = 0;
    for (const seed of SEEDS) {
      const acid = dice(4, 16, seeded(seed), "techno");
      const hits = activeSteps(acid);
      const pitches = hits.map((index) => stepAt(acid, index).pitch);
      expect(stepAt(acid, 0).on).toBe(true);
      // About two steps in three, with rests.
      expect(hits.length).toBeGreaterThanOrEqual(6);
      expect(hits.length).toBeLessThan(16);
      // No hole of more than two steps, no run of more than five (within the bar).
      const drawn = Array.from({ length: 16 }, (_, index) => (stepAt(acid, index).on ? "x" : ".")).join("");
      expect(drawn).not.toMatch(/\.\.\.|xxxxxx/);
      // At most five different notes, all of them the root, its octaves or within the octave above it.
      expect(new Set(pitches).size).toBeLessThanOrEqual(5);
      for (const pitch of pitches) expect([ACID_ROOT - 7, ACID_ROOT, ACID_ROOT + 1, ACID_ROOT + 2, ACID_ROOT + 4, ACID_ROOT + 6, ACID_ROOT + 7]).toContain(pitch);
      // It slides, but not all the time; and where notes of different pitch touch, the first is held into the second, so that the machine slides there too.
      const together = hits.some((index) => stepAt(acid, wrap(index - 1, 16)).on);
      expect(slides(acid).length).toBeLessThanOrEqual(3);
      if (together) expect(slides(acid).length).toBeGreaterThanOrEqual(1);
      expect(slides(acid)).toEqual(touching(acid).sort((a, b) => a - b));
      // Two to four accents, and the notes slid into get theirs before any other does.
      const accents = hits.filter((index) => stepAt(acid, index).vel === 2);
      expect(accents.length).toBeGreaterThanOrEqual(2);
      expect(accents.length).toBeLessThanOrEqual(4);
      expect(slides(acid).filter((index) => accents.includes(index))).toHaveLength(Math.min(slides(acid).length, accents.length));
      roots += pitches.filter((pitch) => pitch === ACID_ROOT).length;
      notes += pitches.length;
      sliding += slides(acid).length > 0 ? 1 : 0;
    }
    // The root is the note heard most, and nearly every line slides.
    expect(roots / notes).toBeGreaterThan(0.45);
    expect(sliding / SEEDS.length).toBeGreaterThan(0.9);
  });

  it("give every ring something to play at every length, within its range", () => {
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      for (let len = 2; len <= 32; len += 1) {
        const pattern = dice(track, len, seeded(len * 31 + track), "techno");
        const hits = activeSteps(pattern);
        expect(hits.length).toBeGreaterThan(0);
        for (const index of hits) {
          expect(index).toBeLessThan(len);
          expect(stepAt(pattern, index).pitch).toBeGreaterThanOrEqual(PITCH_MIN);
          expect(stepAt(pattern, index).pitch).toBeLessThanOrEqual(PITCH_MAX);
        }
      }
    }
  });

  it("are the same for the same seed, and leave the free dice as they were", () => {
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      expect(dice(track, 16, seeded(42), "techno")).toEqual(dice(track, 16, seeded(42), "techno"));
      expect(dice(track, 16, seeded(42))).toEqual(dice(track, 16, seeded(42), "frei"));
    }
    expect(dice(0, 16, seeded(9001), "techno")).not.toEqual(dice(0, 16, seeded(9001)));
  });
});

describe("a techno form", () => {
  const piece = (bars: number): Piece => ({ on: true, tension: Array.from({ length: bars }, () => 0), scenes: Array.from({ length: bars }, () => 0), order: [...TECHNO_ORDER] });

  it("is cut into sections of 16 and 32 bars: an intro, full ones with breaks between, an outro", () => {
    expect(technoSections(112, seeded(1)).map(({ role, bars }) => `${role} ${bars}`)).toEqual(["intro 16", "full 32", "break 16", "full 32", "outro 16"]);
    expect(technoSections(64, seeded(1)).map(({ role, bars }) => `${role} ${bars}`)).toEqual(["intro 16", "full 32", "outro 16"]);
    expect(technoSections(32, seeded(1)).map(({ role, bars }) => `${role} ${bars}`)).toEqual(["intro 8", "full 16", "outro 8"]);
    expect(technoSections(16, seeded(1)).map(({ role, bars }) => `${role} ${bars}`)).toEqual(["intro 8", "outro 8"]);
    for (let bars = 16; bars <= MAX_BARS; bars += 4) {
      const sections = technoSections(bars, seeded(bars));
      const unit = bars >= 64 ? 16 : 8;
      expect(sections.reduce((sum, section) => sum + section.bars, 0)).toBe(bars);
      expect([sections[0]?.role, sections.at(-1)?.role]).toEqual(["intro", "outro"]);
      sections.forEach((section, index) => {
        // A break stands between two full sections and is the short kind.
        if (section.role === "break") expect([sections[index - 1]?.role, sections[index + 1]?.role, section.bars]).toEqual(["full", "full", unit]);
        expect(section.bars).toBeGreaterThanOrEqual(unit);
        expect(section.bars).toBeLessThan(unit * 3);
      });
    }
  });

  it("climbs out of the kick, lands on full sections with a run-up and falls into breaks", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const line = piece(112);
      dicePiece(line, seeded(seed), "techno");
      expect(barCount(line)).toBe(112);
      expect(playing(line, 0)).toEqual([0]);
      // By the end of the intro kick, hi-hat, clap and the low drum play.
      expect(playing(line, 15)).toEqual([0, 1, 2, 3]);
      expect(planBar(line, 15).rise).toBe(true);
      expect(playing(line, 16)).toHaveLength(TRACK_COUNT);
      expect(planBar(line, 47).fall).toBe(true);
      expect(planBar(line, 63).rise).toBe(true);
      // A full section lifts at its half.
      expect(line.tension[32]).toBeGreaterThanOrEqual(line.tension[31] ?? TENSION_MAX);
      // The outro ends where the intro began: on the kick alone.
      expect(playing(line, 111)).toEqual([0]);
    }
  });

  it("stays the free form in a free Kreisel and in a piece too short for sections", () => {
    const free = piece(64);
    const techno = piece(64);
    dicePiece(free, seeded(5));
    dicePiece(techno, seeded(5), "techno");
    expect(techno.tension).not.toEqual(free.tension);
    const short = piece(8);
    const shortFree = piece(8);
    dicePiece(short, seeded(5), "techno");
    dicePiece(shortFree, seeded(5));
    expect(short.tension).toEqual(shortFree.tension);
  });

  it("can be 256 bars long, and a link carries all of them", async () => {
    expect(MAX_BARS).toBe(256);
    const long = technoProject();
    resizePiece(long.piece, 300);
    expect(barCount(long.piece)).toBe(256);
    dicePiece(long.piece, seeded(3), "techno");
    expect((await decodeLink(await encodeLink(long))).piece).toEqual(long.piece);
    expect(barCount(soundPiece(true, Array.from({ length: 400 }, () => 5), [], [], 0))).toBe(256);
    expect(technoPiece().tension.every((value) => value >= 0 && value <= TENSION_MAX)).toBe(true);
  });
});
