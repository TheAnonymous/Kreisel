import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, pack, unpack } from "../src/codec";
import { factoryProject, technoProject, TRACK_COUNT, type Track } from "../src/model";
import {
  CHAINS, chainsFor, chainWorn, CHORUS, cleanPedals, CLIP, crestSteps, crestText, crushBits, crushGains, crushRate, crushWord, describeChain, diceChain, DISTORTION, FLANGER, FUZZ, HOLD_SHARES,
  modGains, noPedals, packPedals, pedalGains, pedalsOf, PHASER, PULSE_DUTY, pulseHarmonics, SCREAM, SPANS, stairCurve, stations, sweepAt, takesPedals, toneCurve, toneFilters, TONES, toneShape,
  toneTrim, unpackPedals, WARM, wearChain,
} from "../src/pedals";
import { ringGains } from "../src/press";

const ring = (change: Partial<Track> = {}): Track => ({ ...factoryProject().tracks[4]!, drive: 0, hall: 0, echo: 0, ...change });

describe("A ring's pedals", () => {
  it("are no pedals at all while nothing is on", () => {
    expect(cleanPedals(noPedals())).toBeUndefined();
    expect(cleanPedals({ ...noPedals(), depth: 0.9, crest: 5, span: 4 })).toBeUndefined();
    expect(cleanPedals(null)).toBeUndefined();
    expect(cleanPedals("fuzz")).toBeUndefined();
    for (const change of [{ tone: FUZZ }, { crush: 0.01 }, { mod: PHASER }, { first: 2 }]) expect(cleanPedals({ ...noPedals(), ...change })).toEqual({ ...noPedals(), ...change });
  });

  it("are put right whatever is claimed", () => {
    expect(cleanPedals({ tone: 99, crush: 7, mod: -3, depth: Number.NaN, crest: 1000, span: 2.4, first: 9 })).toEqual({ tone: TONES.length - 1, crush: 1, mod: 0, depth: noPedals().depth, crest: 31, span: 2, first: 3 });
    expect(cleanPedals({ tone: "hard", crush: "1", mod: 1 })).toEqual({ ...noPedals(), mod: 1 });
  });

  it("travel in a link after everything else a ring has; a ring without them is packed as before", async () => {
    const project = factoryProject();
    project.tracks[2]!.pedals = { tone: CLIP, crush: 0.35, mod: FLANGER, depth: 0.25, crest: 7, span: 3, first: 2 };
    const packed = pack(project);
    expect(packed.t[2]).toHaveLength(13);
    expect(packed.t[2]!.slice(7)).toEqual([0, 0, 0, 0, 0, "3.35.2.25.7.3.2"]);
    expect(packed.t[1]).toHaveLength(7);
    const back = await decodeLink(await encodeLink(project));
    expect(back.tracks[2]!.pedals).toEqual(project.tracks[2]!.pedals);
    expect(back.tracks.filter((track) => track.pedals !== undefined)).toHaveLength(1);
    // With drive and an acid machine before them, the ring keeps all three.
    const techno = technoProject();
    techno.tracks[4]!.pedals = { ...noPedals(), tone: DISTORTION };
    const again = await decodeLink(await encodeLink(techno));
    expect([again.tracks[4]!.drive, again.tracks[4]!.acid?.bite, again.tracks[4]!.pedals?.tone]).toEqual([techno.tracks[4]!.drive, techno.tracks[4]!.acid?.bite, DISTORTION]);
  });

  it("are nothing in a link from before, nothing where a link claims nonsense, and never the kick's", () => {
    const data = pack(factoryProject()) as unknown as Record<string, unknown>;
    expect(unpack(data).tracks.every((track) => track.pedals === undefined)).toBe(true);
    const claim = (pedals: unknown): unknown[] => [0, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, pedals];
    Object.assign(data, { t: [claim("2.50.1.40.3.2.1"), claim("2.50.1.40.3.2.1"), claim("x.y"), claim(12), claim("9.999.9.999.99.9.9"), claim("0.0.0.40.0.2.0")] });
    const tracks = unpack(data).tracks;
    expect(tracks[0]!.pedals).toBeUndefined();
    expect(tracks[1]!.pedals).toEqual({ tone: FUZZ, crush: 0.5, mod: PHASER, depth: 0.4, crest: 3, span: 2, first: 1 });
    expect([tracks[2]!.pedals, tracks[3]!.pedals, tracks[5]!.pedals]).toEqual([undefined, undefined, undefined]);
    expect(tracks[4]!.pedals).toEqual({ tone: TONES.length - 1, crush: 1, mod: 3, depth: 1, crest: 31, span: SPANS.length - 1, first: 3 });
    expect(unpackPedals(packPedals({ ...noPedals(), crush: 0.07 }))).toEqual({ ...noPedals(), crush: 0.07 });
    expect(takesPedals(0)).toBe(false);
    expect(Array.from({ length: TRACK_COUNT }, (_, track) => takesPedals(track)).filter(Boolean)).toHaveLength(6);
  });
});

describe("The drive's character", () => {
  it("is, for the warm one, the curve and the gains every ring always had", () => {
    const curve = toneCurve(WARM);
    expect(curve).toHaveLength(2049);
    for (const index of [0, 1, 500, 1024, 1500, 2048]) expect(curve[index]).toBe(Math.fround(Math.tanh((index / 1024 - 1) * 2.5)));
    for (const [drive, sparks] of [[0, 0], [0.4, 0], [0, 0.7], [0.6, 0.5], [1, 1]] as const) expect(pedalGains(WARM, drive, sparks)).toEqual({ ...ringGains(drive, sparks), lows: 0 });
    expect(toneFilters(WARM, 0.5)).toBeNull();
    expect(toneTrim(WARM, 0.7)).toBe(1);
  });

  it("never leaves −1..1, passes through nothing at nothing, and bites harder than the warm one", () => {
    for (let tone = 0; tone < TONES.length; tone += 1) {
      expect(toneShape(tone, 0)).toBeCloseTo(0, 6);
      for (let x = -1.5; x <= 1.5; x += 0.01) expect(Math.abs(toneShape(tone, x))).toBeLessThanOrEqual(1);
      // What is loud comes out near the top.
      expect(toneShape(tone, 1)).toBeGreaterThan(0.9);
    }
    for (const tone of [DISTORTION, CLIP, SCREAM]) expect(toneShape(tone, 0.35)).toBeGreaterThan(toneShape(WARM, 0.35) + 0.1);
  });

  it("clips flat, fuzzes unevenly and swallows what is quiet", () => {
    expect(toneShape(CLIP, 0.5)).toBe(toneShape(CLIP, 0.9));
    expect(toneShape(CLIP, 0.2)).toBeCloseTo(0.2 * 2.5 * 0.95);
    expect(toneShape(FUZZ, 0.01)).toBe(0);
    expect(toneShape(FUZZ, -0.01)).toBeCloseTo(0, 9);
    expect(toneShape(FUZZ, 0.6)).toBeGreaterThan(-toneShape(FUZZ, -0.6) + 0.1);
    // The knee of the distortion: as it comes below it, rounded off above.
    expect(toneShape(DISTORTION, 0.1)).toBeCloseTo(0.3);
    expect(toneShape(DISTORTION, 0.6)).toBeLessThan(1);
  });

  it("thins the lows before the shaper and gives them back beside it; the scream's peak climbs with the drive", () => {
    const distortion = toneFilters(DISTORTION, 0.5)!;
    expect(distortion.pre).toMatchObject({ type: "highpass", hz: 200 });
    expect(distortion.post.type).toBe("lowpass");
    expect(distortion.lows).toBe(200);
    expect(pedalGains(DISTORTION, 0.5, 0).lows).toBeGreaterThan(0.3);
    expect(pedalGains(CLIP, 0.5, 0).lows).toBe(0);
    const [low, high] = [toneFilters(SCREAM, 0)!, toneFilters(SCREAM, 1)!];
    expect(low.pre.type).toBe("peaking");
    expect(high.pre.hz).toBeGreaterThan(low.pre.hz * 2);
    expect(high.pre.gain).toBeGreaterThan(low.pre.gain);
    expect(high.post).toMatchObject({ type: "highpass", hz: 200 });
  });

  it("is levelled without a step anywhere along the control, and the sparks come on top of every character", () => {
    for (let tone = 1; tone < TONES.length; tone += 1) {
      expect(toneTrim(tone, 0)).toBe(1);
      for (let drive = 0; drive < 1; drive += 0.01) expect(Math.abs(toneTrim(tone, drive + 0.01) - toneTrim(tone, drive))).toBeLessThan(0.03);
      expect(pedalGains(tone, 0, 0).wet).toBe(0);
      expect(pedalGains(tone, 0, 0.5).wet).toBeGreaterThan(0);
      expect(pedalGains(tone, 0.5, 0.5).push).toBe(pedalGains(tone, 1, 0).push);
    }
  });
});

describe("Crush", () => {
  it("leaves fewer levels and fewer samples the further it is turned up", () => {
    expect(crushBits(0)).toBe(9);
    expect(crushBits(1)).toBeCloseTo(2.4);
    expect(crushRate(0)).toBe(18_000);
    expect(crushRate(1)).toBeCloseTo(1600);
    for (let amount = 0; amount < 1; amount += 0.05) {
      expect(crushBits(amount + 0.05)).toBeLessThan(crushBits(amount));
      expect(crushRate(amount + 0.05)).toBeLessThan(crushRate(amount));
    }
  });

  it("fades in over the first tenth of its control and is nothing at nothing", () => {
    expect(crushGains(0)).toEqual({ dry: 1, wet: 0 });
    expect(crushGains(0.05).dry).toBeCloseTo(0.5);
    expect(crushGains(0.1).dry).toBe(0);
    expect(crushGains(0.6).dry).toBe(0);
    expect(crushGains(0.6).wet).toBeGreaterThan(0.5);
  });

  it("says in a word how crushed that is", () => {
    expect([0, 0.1, 0.3, 0.6, 0.8, 1].map(crushWord)).toEqual(["off", "light", "grainy", "8-bit", "crunchy", "broken"]);
  });

  it("makes stairs of a line, and pulses that sample a sound without making it louder", () => {
    const stairs = stairCurve(2, 9);
    expect([...stairs]).toEqual([-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]);
    expect(new Set(stairCurve(3)).size).toBe(17);
    const harmonics = pulseHarmonics();
    expect(harmonics[0]).toBe(0);
    // A short pulse has its first overtones nearly as strong as its mean is: twice that, for the two mirror images of each.
    expect(harmonics[1]).toBeGreaterThan(1.9);
    expect(harmonics[1]).toBeLessThanOrEqual(2);
    // Eight pulses side by side fill the time between two looks: every eighth overtone is missing, and the three delays lay a pulse out at all eight places.
    expect(PULSE_DUTY).toBe(1 / 8);
    for (const harmonic of [8, 16, 24, 32, 40, 48]) expect(Math.abs(harmonics[harmonic]!)).toBeLessThan(1e-6);
    const places = HOLD_SHARES.reduce<number[]>((sums, share) => sums.flatMap((sum) => [sum, sum + share]), [0]).sort((a, b) => a - b);
    expect(places).toEqual([0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8]);
  });
});

describe("Modulation", () => {
  it("has its sweep's top on the crest, in every round or in every so many", () => {
    // Once a round: at its top whenever the runner passes step 5, at its bottom half a round later.
    for (const round of [0, 1, 7]) {
      expect(sweepAt(round * 16 + 5, 16, 5, 1)).toBeCloseTo(1);
      expect(sweepAt(round * 16 + 13, 16, 5, 1)).toBeCloseTo(0);
    }
    // Twice a round: two tops, half a round apart.
    expect(sweepAt(5, 16, 5, 0)).toBeCloseTo(1);
    expect(sweepAt(13, 16, 5, 0)).toBeCloseTo(1);
    expect(sweepAt(9, 16, 5, 0)).toBeCloseTo(0);
    // Once in four rounds: only every fourth pass of the crest is the top.
    expect(sweepAt(5, 16, 5, 3)).toBeCloseTo(1);
    expect(sweepAt(16 + 5, 16, 5, 3)).toBeCloseTo(0.5);
    expect(sweepAt(32 + 5, 16, 5, 3)).toBeCloseTo(0);
    expect(sweepAt(64 + 5, 16, 5, 3)).toBeCloseTo(1);
    // On a ring of twelve steps the round is twelve steps.
    expect(sweepAt(12 + 3, 12, 3, 1)).toBeCloseTo(1);
    for (let local = 0; local < 200; local += 1) for (let span = 0; span < SPANS.length; span += 1) {
      const value = sweepAt(local, 16, 9, span);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("marks one crest on the ring, or two for a sweep that goes twice a round", () => {
    expect(crestSteps(16, 5, 1)).toEqual([5]);
    expect(crestSteps(16, 5, 4)).toEqual([5]);
    expect(crestSteps(16, 5, 0)).toEqual([5, 13]);
    expect(crestSteps(12, 14, 0)).toEqual([2, 8]);
    expect(crestText(8, 16)).toBe("step 9 of 16");
    expect(crestText(20, 12)).toBe("step 9 of 12");
  });

  it("is as loud with its effect as without, and only a flanger feeds back", () => {
    expect(modGains(0, 1)).toEqual({ dry: 1, wet: 0, feedback: 0 });
    expect(modGains(PHASER, 0)).toEqual({ dry: 1, wet: 0, feedback: 0 });
    for (const mod of [PHASER, FLANGER, CHORUS]) for (const depth of [0.2, 0.5, 1]) {
      const gains = modGains(mod, depth);
      expect(gains.dry ** 2 + gains.wet ** 2).toBeCloseTo(1);
      expect(gains.feedback > 0).toBe(mod === FLANGER);
      expect(gains.feedback).toBeLessThan(0.7);
    }
    expect(modGains(PHASER, 1).wet).toBeGreaterThan(modGains(PHASER, 0.3).wet);
  });
});

describe("The chain, in words", () => {
  it("names what is turned up, in the order the sound passes it", () => {
    expect(stations(ring())).toEqual([]);
    expect(describeChain(ring())).toBe("nothing in its way");
    expect(stations(ring({ drive: 0.4, hall: 0.2, echo: 0.3 }))).toEqual(["Drive", "Echo", "Reverb"]);
    const full = { ...noPedals(), tone: FUZZ, crush: 0.3, mod: PHASER };
    expect(stations(ring({ drive: 0.4, hall: 0.2, echo: 0.3, pedals: full }))).toEqual(["Fuzz", "Crush", "Phaser", "Echo", "Reverb"]);
    expect(stations(ring({ drive: 0.4, hall: 0.2, echo: 0.3, pedals: { ...full, first: 1 } }))).toEqual(["Reverb", "Fuzz", "Crush", "Phaser", "Echo"]);
    expect(stations(ring({ drive: 0.4, hall: 0.2, echo: 0.3, pedals: { ...full, first: 2 } }))).toEqual(["Echo", "Fuzz", "Crush", "Phaser", "Reverb"]);
    expect(describeChain(ring({ drive: 0.4, hall: 0.2, echo: 0.3, pedals: { ...full, first: 3 } }))).toBe("Echo, then Reverb, then Fuzz, then Crush, then Phaser");
    // What is not turned up is not in the way: a character without drive, a modulation without depth, a room nobody sends into.
    expect(stations(ring({ hall: 0, echo: 0, pedals: { ...noPedals(), tone: CLIP, mod: FLANGER, depth: 0, first: 3 } }))).toEqual([]);
  });
});

describe("Chains", () => {
  it("are five for every ring but the kick, each with a name of its own", () => {
    expect(chainsFor(0)).toEqual([]);
    for (let track = 1; track < TRACK_COUNT; track += 1) {
      const chains = chainsFor(track);
      expect(chains).toHaveLength(5);
      expect(new Set(chains.map((chain) => chain.name)).size).toBe(5);
      for (const chain of chains) {
        expect(chain.name.length).toBeLessThanOrEqual(15);
        expect(chain.hint.length).toBeGreaterThan(10);
        // A chain does something: it has stations, and what it sets is in range.
        expect(stations(chain).length).toBeGreaterThan(0);
        for (const amount of [chain.drive, chain.hall, chain.echo]) expect(amount >= 0 && amount <= 1).toBe(true);
        // A room in front of a drive needs a room and a drive.
        if (chain.pedals.first & 1) expect(chain.hall > 0 && chain.drive > 0).toBe(true);
        if (chain.pedals.first & 2) expect(chain.echo > 0 && chain.drive > 0).toBe(true);
      }
    }
    expect(new Set(CHAINS.flat().map((chain) => chain.name)).size).toBe(30);
  });

  it("are worn by the ring they are put on, whatever it wore, and keep its crest", () => {
    for (let track = 1; track < TRACK_COUNT; track += 1) {
      chainsFor(track).forEach((chain, index) => {
        const settings = ring({ drive: 0.9, hall: 0.9, pedals: { ...noPedals(), tone: SCREAM, crest: 11, first: 3 } });
        wearChain(settings, chain);
        expect(chainWorn(track, settings)).toBe(index);
        if (settings.pedals) expect(settings.pedals.crest).toBe(11);
        expect(pedalsOf(settings).tone).toBe(chain.pedals.tone);
      });
    }
    expect(chainWorn(4, ring())).toBe(-1);
    const moved = ring();
    wearChain(moved, chainsFor(4)[0]!);
    moved.drive += 0.1;
    expect(chainWorn(4, moved)).toBe(-1);
  });

  it("come by the dice, never the one the ring wears", () => {
    for (let roll = 0; roll < 50; roll += 1) {
      const dice = diceChain(4, 2, () => roll / 50);
      expect(dice).not.toBe(2);
      expect(dice >= 0 && dice < 5).toBe(true);
    }
    expect(diceChain(0, -1, () => 0.5)).toBe(-1);
    expect(new Set(Array.from({ length: 50 }, (_, roll) => diceChain(4, -1, () => roll / 50))).size).toBe(5);
  });
});
