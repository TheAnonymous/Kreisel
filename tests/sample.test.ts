import { describe, expect, it } from "vitest";
import { isBundle, packBundle, unpackBundle } from "../src/bundle";
import { decodeLink, encodeLink, pack, unpack } from "../src/codec";
import { currentScene, factoryProject, SAMPLE_SOUND, technoProject, type Sample } from "../src/model";
import { plainRecipe, projectOf, recipeDepth, recipeOf, recipeSteps, selfContained } from "../src/resample";
import { cleanName, cleanSample, describeSample, firstSample, hitSemitones, HIT, homeMidi, MAX_RECIPE, packSample, padFilter, padLength, padSteps, PLAY_KEYS, playedSpan, rateOf, rootHz, secondsText, sliceOf, sliceOffset, sliceRate, sliceSpan, SLICES, SPEED, STRETCH, stretchOf, tuneText, unpackSample } from "../src/sample";
import { dropRecording, idOf, idOfText, keepRecording, listRecordings, recordingOf, type Recording } from "../src/sample-store";

const ID = "0123456789abcdef";
const sample = (change: Partial<Sample> = {}): Sample => ({ ...firstSample(ID, "amen"), ...change });

describe("A ring's sample", () => {
  it("is all of its recording, as it is, when it has just come in", () => {
    expect(firstSample(ID, "kick")).toEqual({ id: ID, name: "kick", mode: HIT, fit: 0, from: 0, to: 1, tune: 0, back: false, turn: 0, gain: 1, stretch: 1 });
    expect(cleanSample(firstSample(ID, "kick"))).toEqual(firstSample(ID, "kick"));
  });

  it("is no sample without the name of a recording, and is put right whatever else is claimed", () => {
    expect(cleanSample(null)).toBeUndefined();
    expect(cleanSample({})).toBeUndefined();
    expect(cleanSample({ id: "kick" })).toBeUndefined();
    expect(cleanSample({ id: ID.toUpperCase() })).toBeUndefined();
    expect(cleanSample({ id: ID, name: "  A.B\u0007C  ", mode: 7, fit: "x", from: 2, to: -1, tune: 99, back: 1, turn: 35.4, gain: 9 })).toEqual({ id: ID, name: "A B C", mode: HIT, fit: 0, from: 0.999, to: 1, tune: 24, back: false, turn: 3, gain: 2, stretch: 1 });
    // A part that ends before it begins is the shortest part there is, at its beginning.
    const turned = cleanSample({ id: ID, from: 0.6, to: 0.2 })!;
    expect(turned.from).toBe(0.6);
    expect(turned.to).toBeCloseTo(0.601);
    expect(cleanSample({ id: ID, name: "" })!.name).toBe("sample");
    expect(cleanName("a very long name that goes on and on")).toHaveLength(24);
  });

  it("travels in a link after everything else a ring has: which recording and how it is played, never the sound", async () => {
    const project = factoryProject();
    const worn = sample({ mode: SLICES, fit: SPEED, from: 0.125, to: 0.75, tune: -3.5, back: true, turn: 5, gain: 1.4, stretch: 2.5, name: "amen break" });
    Object.assign(project.tracks[3]!, { sample: worn, sound: SAMPLE_SOUND });
    const packed = pack(project);
    expect(packed.t[3]).toHaveLength(14);
    expect(packed.t[3]![13]).toBe(`1.1.125000.750000.2050.1.140.5.250.${ID}.amen break`);
    expect(packed.t[2]).toHaveLength(7);
    const back = await decodeLink(await encodeLink(project));
    expect(back.tracks[3]!.sample).toEqual(worn);
    expect(back.tracks[3]!.sound).toBe(SAMPLE_SOUND);
    expect(back.tracks.filter((track) => track.sample !== undefined)).toHaveLength(1);
    // With pedals, drive and an acid machine before it, the ring keeps them all.
    const techno = technoProject();
    techno.tracks[4]!.sample = sample();
    const again = await decodeLink(await encodeLink(techno));
    expect([again.tracks[4]!.pedals?.tone, again.tracks[4]!.acid?.bite, again.tracks[4]!.sample?.id]).toEqual([1, 0.6, ID]);
  });

  it("keeps where it begins and ends to a millionth of the recording: a loop found in a long take does not shift when it travels", () => {
    const worn = cleanSample({ id: ID, from: 0.123456789, to: 0.654321987, gain: 1.23456 })!;
    expect([worn.from, worn.to, worn.gain]).toEqual([0.123457, 0.654322, 1.23]);
    expect(unpackSample(packSample(worn))).toEqual(worn);
  });

  it("is nothing in a link from before, and a ring that claims to play a sample it does not have plays its first sound", () => {
    const data = pack(factoryProject()) as unknown as Record<string, unknown>;
    expect(unpack(data).tracks.every((track) => track.sample === undefined)).toBe(true);
    const claim = (sound: number, said: unknown): unknown[] => [sound, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, said];
    Object.assign(data, { t: [claim(SAMPLE_SOUND, `0.0.0.1000000.2400.0.100.0.100.${ID}.kick`), claim(SAMPLE_SOUND, "nonsense"), claim(SAMPLE_SOUND, 12), claim(SAMPLE_SOUND, `9.9.9999999.0.9999.9.999.99.9999.${ID}.x`), claim(0, `0.0.0.1000000.2400.0.100.0.100.${ID}.kept`)] });
    const tracks = unpack(data).tracks;
    expect([tracks[0]!.sound, tracks[0]!.sample?.name]).toEqual([SAMPLE_SOUND, "kick"]);
    expect([tracks[1]!.sound, tracks[1]!.sample, tracks[2]!.sound, tracks[2]!.sample]).toEqual([0, undefined, 0, undefined]);
    expect(tracks[3]!.sample).toMatchObject({ mode: HIT, fit: 0, tune: 24, gain: 2, back: false, turn: 3, stretch: 8 });
    // A ring can have a sample and play something else: the sample is kept for later.
    expect([tracks[4]!.sound, tracks[4]!.sample?.name]).toEqual([0, "kept"]);
    expect(unpackSample(packSample(sample({ tune: 0.37, from: 0.001 })))).toEqual(sample({ tune: 0.37, from: 0.001 }));
  });
});

describe("Slices", () => {
  it("are as many as the ring has steps, and a hit plays the one it lies on", () => {
    expect(sliceOf(5, 0, 16)).toBe(5);
    expect(sliceSpan(sample(), 4, 16)).toEqual({ from: 0.25, to: 0.3125 });
    // Of the part that is played, not of the whole recording.
    const part = sliceSpan(sample({ from: 0.2, to: 0.6 }), 1, 4);
    expect(part.from).toBeCloseTo(0.3);
    expect(part.to).toBeCloseTo(0.4);
  });

  it("go round with the ring: pulled outwards a hit takes a later slice, inwards an earlier one", () => {
    expect(sliceOf(5, 3, 16)).toBe(8);
    expect(sliceOf(5, -7, 16)).toBe(14);
    expect(sliceOf(15, 14, 16)).toBe(13);
    expect(sliceOf(3, 0, 12)).toBe(3);
  });

  it("turn with the record: turned on by four steps, the hit on the first step plays the fifth slice", () => {
    expect(sliceOf(0, 0, 16, 4)).toBe(4);
    expect(sliceOf(14, 0, 16, 4)).toBe(2);
    expect(sliceOf(0, -1, 16, 4)).toBe(3);
    expect(sliceOf(5, 0, 12, 31)).toBe(0);
  });

  it("are counted from the recording's end when it is played backwards", () => {
    expect(playedSpan(sample({ from: 0.2, to: 0.6 }))).toEqual([0.2, 0.6]);
    const [from, to] = playedSpan(sample({ from: 0.2, to: 0.6, back: true }));
    expect(from).toBeCloseTo(0.4);
    expect(to).toBeCloseTo(0.8);
    // The first slice of a recording turned round is its last quarter.
    expect(sliceSpan(sample({ back: true }), 0, 4)).toEqual({ from: 0, to: 0.25 });
  });

  it("run at their own speed when chopped, and as fast as fills their step with “Speed”", () => {
    expect(sliceRate(sample({ mode: SLICES }), 0.1, 0.2)).toBe(1);
    expect(sliceRate(sample({ mode: SLICES, tune: 12 }), 0.1, 0.2)).toBeCloseTo(2);
    // A slice of a loop at 140 in a Kreisel at 150 is a little long for its step: it runs faster by that much.
    expect(sliceRate(sample({ mode: SLICES, fit: SPEED }), 60 / 140 / 4, 60 / 150 / 4)).toBeCloseTo(150 / 140);
    expect(sliceRate(sample({ mode: SLICES, fit: SPEED }), 10, 0.1)).toBe(4);
    expect(sliceRate(sample({ mode: SLICES, fit: SPEED }), 0.001, 1)).toBe(0.25);
  });
});

describe("How high a sample plays", () => {
  it("is its own pitch on a ring's home note, the key's root in the ring's octave", () => {
    expect([0, 1, 2].map((ring) => homeMidi(0, ring))).toEqual([null, null, null]);
    expect([3, 4, 5, 6].map((ring) => homeMidi(0, ring))).toEqual([48, 36, 60, 60]);
    expect(homeMidi(7, 4)).toBe(31);
    expect(hitSemitones(sample(), 36, 36, 0)).toBe(0);
    expect(hitSemitones(sample(), 43, 36, 0)).toBe(7);
    expect(hitSemitones(sample({ tune: -2 }), 48, 36, 5)).toBe(10);
  });

  it("is a semitone a place across the ring on a drum, and only its tuning in slices", () => {
    expect(hitSemitones(sample(), null, null, 3)).toBe(3);
    expect(hitSemitones(sample({ tune: 1.5 }), null, null, -2)).toBe(-0.5);
    expect(hitSemitones(sample({ mode: SLICES, tune: 4 }), 50, 36, 9)).toBe(4);
    expect(rateOf(12)).toBe(2);
    expect(rateOf(-12)).toBe(0.5);
    expect(rateOf(0)).toBe(1);
  });
});

describe("The sound pad on a sample", () => {
  it("leaves it as it is in the middle, closes a low-pass to the left and opens a high-pass to the right", () => {
    expect(padFilter(0.5)).toBeNull();
    expect(padFilter(0.45)).toBeNull();
    expect(padFilter(0.55)).toBeNull();
    expect(padFilter(0)).toEqual({ type: "lowpass", hz: 300 });
    expect(padFilter(1)!.type).toBe("highpass");
    expect(padFilter(1)!.hz).toBeCloseTo(2000);
    expect(padFilter(0.3)!.hz).toBeGreaterThan(padFilter(0.1)!.hz);
    expect(padFilter(0.9)!.hz).toBeGreaterThan(padFilter(0.7)!.hz);
  });

  it("lets a hit ring out in its upper half and shortens it below", () => {
    expect([0.5, 0.8, 1].map(padLength)).toEqual([1, 1, 1]);
    expect(padLength(0)).toBeCloseTo(0.05);
    expect(padLength(0.25)).toBeLessThan(padLength(0.4));
    // In slices: on until the next hit, or for so many steps.
    expect([0.5, 1].map(padSteps)).toEqual([null, null]);
    expect(padSteps(0)).toBeCloseTo(0.25);
    expect(padSteps(0.25)).toBeCloseTo(2);
    expect(padSteps(0.499)!).toBeGreaterThan(15);
  });
});

describe("A record played by hand", () => {
  it("has eight keys, and a hit written down takes the slice that was played by its place across the ring", () => {
    expect(PLAY_KEYS).toBe(8);
    // On a ring of 16 steps every slice is within a hit's reach from every step: the nearest way round is taken.
    for (let step = 0; step < 16; step += 1) {
      for (let slice = 0; slice < 16; slice += 1) {
        const offset = sliceOffset(step, slice, 16);
        expect(sliceOf(step, offset, 16)).toBe(slice);
        expect(Math.abs(offset)).toBeLessThanOrEqual(8);
      }
    }
    expect(sliceOffset(4, 4, 16)).toBe(0);
    expect(sliceOffset(4, 6, 16)).toBe(2);
    expect(sliceOffset(4, 2, 16)).toBe(-2);
    expect(sliceOffset(15, 0, 16)).toBe(1);
    // With the record turned on, the hit is pulled that much less.
    expect(sliceOf(4, sliceOffset(4, 10, 16, 3), 16, 3)).toBe(10);
    // On a ring of 32 steps some slices are out of reach (a hit is pulled 7 in or 14 out at most): then as near as it gets.
    expect(sliceOf(0, sliceOffset(0, 12, 32), 32)).toBe(12);
    expect(sliceOf(0, sliceOffset(0, 28, 32), 32)).toBe(28);
    expect(sliceOffset(0, 16, 32)).toBe(14);
    expect(sliceOffset(0, 22, 32)).toBe(-7);
  });
});

describe("A sample stretched", () => {
  it("as a hit is as many times as long as its own amount says, and never shorter than it is", () => {
    expect(stretchOf(sample({ stretch: 4 }), 0.5, 16, 0.1)).toBe(4);
    expect(stretchOf(sample(), 0.5, 16, 0.1)).toBe(1);
    expect(cleanSample({ id: ID, stretch: 0.3 })!.stretch).toBe(1);
    expect(cleanSample({ id: ID, stretch: 99 })!.stretch).toBe(8);
    expect(cleanSample({ id: ID, stretch: "4" })!.stretch).toBe(1);
  });

  it("in slices is made as long as the ring's steps are, at its own pitch", () => {
    const fitted = sample({ mode: SLICES, fit: STRETCH });
    // Two bars at 150 BPM are 3.2 s: a loop of 1.6 s is made twice as long, one of 6.4 s half as long.
    expect(stretchOf(fitted, 1.6, 32, 0.1)).toBeCloseTo(2);
    expect(stretchOf(fitted, 6.4, 32, 0.1)).toBeCloseTo(0.5);
    // Tuned up an octave it runs twice as fast: it has to be made twice as long again to fill the ring.
    expect(stretchOf({ ...fitted, tune: 12 }, 1.6, 32, 0.1)).toBeCloseTo(4);
    // Chopped or sped, nothing is stretched, whatever the hit's own amount says.
    expect(stretchOf(sample({ mode: SLICES, stretch: 4 }), 1.6, 32, 0.1)).toBe(1);
    expect(stretchOf(sample({ mode: SLICES, fit: SPEED }), 1.6, 32, 0.1)).toBe(1);
    // There is an end to it either way.
    expect(stretchOf(fitted, 0.1, 32, 0.1)).toBe(8);
    expect(stretchOf(fitted, 60, 32, 0.1)).toBe(0.25);
    expect(sliceRate({ ...fitted, tune: 12 }, 0.1, 0.1)).toBeCloseTo(2);
  });

  it("buzzes at the key's root", () => {
    expect(rootHz(9)).toBeCloseTo(220);
    expect(rootHz(0)).toBeCloseTo(130.81, 1);
    expect(rootHz(21)).toBeCloseTo(220);
  });
});

describe("A sample in words", () => {
  it("says its name, how it is played and how long the part is that plays", () => {
    expect(describeSample(sample(), 0.84, 16)).toBe("“amen”, a one-shot, 0.84 s");
    expect(describeSample(sample({ mode: SLICES, from: 0, to: 0.5, fit: SPEED, tune: -2, back: true }), 6.4, 32)).toBe("“amen”, 32 slices, sped to the steps, 3.2 s, −2 semitones, backwards");
    expect(describeSample(sample(), null, 16)).toBe("“amen”, a one-shot");
    expect(describeSample(sample({ stretch: 4 }), 0.5, 16)).toBe("“amen”, a one-shot, stretched ×4, 0.50 s");
    expect(describeSample(sample({ mode: SLICES, fit: STRETCH }), 3.2, 32)).toBe("“amen”, 32 slices, stretched to the steps, 3.2 s");
    expect([0.4, 3.21, 12.4].map(secondsText)).toEqual(["0.40 s", "3.2 s", "12 s"]);
    expect([0, 1, -1, 2.5, -0.37].map(tuneText)).toEqual(["as it is", "+1 semitone", "−1 semitone", "+2.5 semitones", "−0.37 semitones"]);
  });
});

describe("Pressing the Kreisel onto a ring", () => {
  it("writes down the scene on the table alone, with whoever is not heard left out", () => {
    const project = technoProject();
    project.piece.on = true;
    project.chain = true;
    const recipe = recipeOf(project, (track) => track !== 2)!;
    const made = projectOf(recipe)!;
    expect(made.piece.on).toBe(false);
    expect(made.chain).toBe(false);
    expect(made.scenes.filter((scene) => scene !== null)).toHaveLength(1);
    expect(made.tracks.map((track) => track.mute)).toEqual([false, false, true, false, false, false, false]);
    expect(currentScene(made).patterns).toEqual(currentScene(project).patterns);
    expect(made.bpm).toBe(project.bpm);
    // A ring that is not heard, or has a recording it does not play, leaves that recording behind.
    const kept = technoProject();
    kept.tracks[2]!.sample = sample();
    Object.assign(kept.tracks[3]!, { sample: sample(), sound: SAMPLE_SOUND });
    Object.assign(kept.tracks[4]!, { sample: sample(), sound: SAMPLE_SOUND });
    expect(projectOf(recipeOf(kept, (track) => track !== 4)!)!.tracks.map((track) => track.sample !== undefined)).toEqual([false, false, false, true, false, false, false]);
    // The Kreisel it was written from is as it was.
    expect([project.piece.on, project.chain, project.tracks[2]!.mute]).toEqual([true, true, false]);
  });

  it("is the same recipe for the same Kreisel, short enough for a link, and travels with the ring's sample", async () => {
    const project = technoProject();
    const recipe = recipeOf(project, () => true)!;
    expect(recipeOf(technoProject(), () => true)).toBe(recipe);
    expect(recipe.length).toBeLessThan(6000);
    expect(await idOfText(recipe)).toMatch(/^[0-9a-f]{16}$/);
    expect(await idOfText(recipe)).toBe(await idOfText(recipe));
    const worn = { ...firstSample(await idOfText(recipe), "record 1", SLICES), recipe };
    Object.assign(project.tracks[3]!, { sample: worn, sound: SAMPLE_SOUND });
    expect(pack(project).t[3]).toHaveLength(15);
    const back = await decodeLink(await encodeLink(project));
    expect(back.tracks[3]!.sample).toEqual(worn);
    expect(projectOf(back.tracks[3]!.sample!.recipe!)!.tracks).toHaveLength(7);
    // A link with a record in it is still a link.
    expect((await encodeLink(project)).length).toBeLessThan(5000);
  });

  it("holds one turn of a ring by itself, and a bar or two of several rings", () => {
    const project = technoProject();
    const scene = currentScene(project);
    scene.chords = [0];
    scene.patterns.forEach((pattern) => { pattern.len = 16; });
    scene.patterns[3]!.len = 12;
    const only = (ring: number): number => recipeSteps(projectOf(recipeOf(project, (track) => track === ring)!)!);
    expect(only(3)).toBe(12);
    expect(only(0)).toBe(16);
    // Several rings: a bar; two bars as soon as the scene has a second chord or one of the rings heard is longer than a bar.
    expect(recipeSteps(projectOf(recipeOf(project, () => true)!)!)).toBe(16);
    scene.patterns[2]!.len = 32;
    expect(recipeSteps(projectOf(recipeOf(project, () => true)!)!)).toBe(32);
    expect(recipeSteps(projectOf(recipeOf(project, (track) => track !== 2)!)!)).toBe(16);
    scene.patterns[2]!.len = 16;
    scene.chords = [0, 5];
    expect(recipeSteps(projectOf(recipeOf(project, () => true)!)!)).toBe(32);
  });

  it("is played as its scene alone, whatever a link's recipe says about a row or a piece", () => {
    const written = technoProject();
    written.chain = true;
    written.piece.on = true;
    const plain = plainRecipe(written);
    expect([plain.chain, plain.piece.on, plain.order, plain.relay]).toEqual([false, false, [plain.scene], null]);
  });

  it("can be played anywhere only if every ring heard in it plays what comes with it", () => {
    const project = technoProject();
    expect(selfContained(project)).toBe(true);
    Object.assign(project.tracks[3]!, { sample: sample(), sound: SAMPLE_SOUND });
    expect(selfContained(project)).toBe(false);
    project.tracks[3]!.mute = true;
    expect(selfContained(project)).toBe(true);
    Object.assign(project.tracks[3]!, { mute: false, sample: { ...sample(), recipe: recipeOf(technoProject(), () => true)! } });
    expect(selfContained(project)).toBe(true);
  });

  it("knows how deep it goes: a record of a Kreisel whose ring plays a record is two deep", async () => {
    const project = technoProject();
    const plain = recipeOf(project, () => true)!;
    expect(recipeDepth(plain)).toBe(1);
    expect(recipeDepth("nonsense")).toBe(0);
    Object.assign(project.tracks[3]!, { sample: { ...firstSample(await idOfText(plain), "record 1", SLICES), recipe: plain }, sound: SAMPLE_SOUND });
    const second = recipeOf(project, () => true)!;
    expect(recipeDepth(second)).toBe(2);
    Object.assign(project.tracks[4]!, { sample: { ...firstSample(await idOfText(second), "record 2", SLICES), recipe: second }, sound: SAMPLE_SOUND });
    const third = recipeOf(project, () => true, Number.POSITIVE_INFINITY)!;
    expect(recipeDepth(third)).toBe(3);
    // A recipe longer than may travel is none, unless whoever asks says it need not travel.
    expect(recipeOf(project, () => true, 100)).toBeNull();
    expect(third.length).toBeLessThan(MAX_RECIPE);
  });

  it("is no recipe when it is nonsense or too long to carry", () => {
    expect(projectOf("nonsense")).toBeNull();
    expect(projectOf("{}")).toBeNull();
    expect(cleanSample({ id: ID, recipe: "x".repeat(MAX_RECIPE + 1) })!.recipe).toBeUndefined();
    expect(cleanSample({ id: ID, recipe: "" })!.recipe).toBeUndefined();
  });
});

describe("The recordings a browser keeps", () => {
  const recording = (bytes: number[], name: string, added: number): Promise<Recording> => {
    const sound = new Uint8Array(bytes).buffer;
    return idOf(sound).then((id) => ({ id, name, kind: "WAV", source: "file", bytes: sound, seconds: 1, added }));
  };

  it("are kept under the hash of their sound: the same sound has the same name, another sound another", async () => {
    expect(await idOf(new Uint8Array([1, 2, 3]).buffer)).toBe(await idOf(new Uint8Array([1, 2, 3]).buffer));
    expect(await idOf(new Uint8Array([1, 2, 3]).buffer)).not.toBe(await idOf(new Uint8Array([1, 2, 4]).buffer));
    expect(await idOf(new Uint8Array([1, 2, 3]).buffer)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("last for the visit where there is no database, are listed the newest first, and can be forgotten", async () => {
    const [old, fresh] = [await recording([1, 2, 3], "old", 100), await recording([4, 5, 6, 7], "fresh", 200)];
    expect(await keepRecording(old)).toBe("for this visit");
    await keepRecording(fresh);
    await keepRecording(old);
    expect((await listRecordings()).map((item) => [item.name, item.size])).toEqual([["fresh", 4], ["old", 3]]);
    expect((await recordingOf(old.id))?.name).toBe("old");
    expect(await recordingOf("ffffffffffffffff")).toBeNull();
    await dropRecording(old.id);
    expect(await recordingOf(old.id)).toBeNull();
    expect((await listRecordings()).map((item) => item.name)).toEqual(["fresh"]);
    await dropRecording(fresh.id);
  });
});

describe("A Kreisel as a file with its recordings", () => {
  it("holds the link and every recording's own bytes, and comes apart as it was put together", () => {
    const recordings: Recording[] = [
      { id: ID, name: "kick", kind: "WAV", source: "file", bytes: new Uint8Array([1, 2, 3, 4, 5]).buffer, seconds: 0.4, added: 5 },
      { id: "fedcba9876543210", name: "take 1", kind: "a recording", source: "microphone", bytes: new Uint8Array([9, 8, 7]).buffer, seconds: 2, added: 6 },
    ];
    const file = packBundle({ link: "1.abc", recordings });
    expect(isBundle(file)).toBe(true);
    expect(new TextDecoder().decode(file.subarray(0, 9))).toBe("KREISEL1\n");
    const back = unpackBundle(file)!;
    expect(back.link).toBe("1.abc");
    expect(back.recordings.map(({ bytes, ...said }) => [said, [...new Uint8Array(bytes)]])).toEqual(recordings.map(({ bytes, ...said }) => [said, [...new Uint8Array(bytes)]]));
    expect(unpackBundle(packBundle({ link: "1.x", recordings: [] }))).toEqual({ link: "1.x", recordings: [] });
  });

  it("is not opened when it is something else, cut short, or lies about its sounds", () => {
    expect(isBundle(new TextEncoder().encode("RIFF....WAVE"))).toBe(false);
    expect(unpackBundle(new Uint8Array(4))).toBeNull();
    const file = packBundle({ link: "1.abc", recordings: [{ id: ID, name: "kick", kind: "WAV", source: "file", bytes: new Uint8Array(40).buffer, seconds: 1, added: 1 }] });
    expect(unpackBundle(file.subarray(0, file.length - 10))).toBeNull();
    expect(unpackBundle(file.subarray(0, 20))).toBeNull();
    const lying = packBundle({ link: "1.abc", recordings: [{ id: "not-an-id", name: "kick", kind: "WAV", source: "file", bytes: new Uint8Array(4).buffer, seconds: 1, added: 1 }] });
    expect(unpackBundle(lying)).toBeNull();
  });
});
