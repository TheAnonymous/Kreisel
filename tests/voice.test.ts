import { describe, expect, it } from "vitest";
import { decodeLink, deserialize, encodeLink, pack, packState, serialize, unpack, unpackVoice } from "../src/codec";
import { emptyPattern, factoryProject, MAX_VOICE_TEXT, stepAt, VOICE_SOUND, type Pattern, type Project, type Voice } from "../src/model";
import { seeded } from "../src/patterns";
import { changedRings } from "../src/relay";
import { cleanText, cleanVoice, describeVoice, diceLine, FIELD_LETTERS, fieldPull, fieldVowel, hitNumber, MAX_SYLLABLES, mouthOf, plan, shape, sing, spell, syllables, VOWELS, type Formants, type Sound, type Syllable } from "../src/voice";

const cut = (text: string): string[] => syllables(text).map((syllable) => syllable.text);
/** A syllable as it stands in its line, with the one that follows it. */
const sungIn = (text: string, which: number): ReturnType<typeof sing> => {
  const line = syllables(text);
  return sing(line[which]!, line[which + 1] ?? null);
};
const alone = (text: string): Syllable => ({ text, first: true, last: true });
const vowel = (name: string): Formants => VOWELS[name]!;
const noises = (sounds: readonly Sound[]): number[] => sounds.flatMap((sound) => ("noise" in sound ? [sound.noise.hz] : []));
const hums = (sounds: readonly Sound[]): number => sounds.filter((sound) => "hum" in sound).length;
const plain: Voice = { text: "", mouth: 0.5, breath: 0.15 };
/** A ring of `length` steps with hits on `hits`. */
function ring(length: number, hits: readonly number[]): Pattern {
  const pattern = emptyPattern(length);
  for (const hit of hits) stepAt(pattern, hit).on = true;
  return pattern;
}

describe("a line cut into syllables", () => {
  it("cuts German as it is written", () => {
    expect(spell("Kaffeepause jetzt")).toBe("Kaf·fee·pau·se jetzt");
    expect(spell("Dreh dich Kreisel")).toBe("Dreh dich Krei·sel");
    expect(spell("Wir sind die Maschine")).toBe("Wir sind die Ma·schi·ne");
    expect(cut("Stimme")).toEqual(["Stim", "me"]);
    expect(cut("Gespräch")).toEqual(["Ge", "spräch"]);
    expect(cut("Bahnhof")).toEqual(["Bahn", "hof"]);
    expect(cut("Theater")).toEqual(["The", "a", "ter"]);
    expect(cut("Eier")).toEqual(["Ei", "er"]);
    expect(cut("Wetter")).toEqual(["Wet", "ter"]);
    expect(cut("Nachbeben")).toEqual(["Nach", "be", "ben"]);
    expect(cut("Träume")).toEqual(["Träu", "me"]);
  });

  it("keeps the letters as typed and knows where words begin and end", () => {
    const line = syllables("Mehr Bass bitte");
    expect(line.map((syllable) => syllable.text).join("")).toBe("MehrBassbitte");
    expect(line.map((syllable) => syllable.first)).toEqual([true, true, true, false]);
    expect(line.map((syllable) => syllable.last)).toEqual([true, true, false, true]);
  });

  it("cuts where a hyphen or a dot stands, and sings words without a vowel in one piece", () => {
    expect(cut("A-cid")).toEqual(["A", "cid"]);
    expect(cut("Kre·i·sel")).toEqual(["Kre", "i", "sel"]);
    expect(cut("la-la - la")).toEqual(["la", "la", "la"]);
    expect(cut("pst tschak")).toEqual(["pst", "tschak"]);
    expect(cut("geht's")).toEqual(["gehts"]);
  });

  it("is nothing for nothing, and never more than a ring can hold", () => {
    expect(syllables("")).toEqual([]);
    expect(syllables("   ")).toEqual([]);
    expect(syllables("- · -")).toEqual([]);
    expect(syllables("a ".repeat(60))).toHaveLength(MAX_SYLLABLES);
  });
});

describe("what a voice may be", () => {
  it("keeps letters, spaces and hyphens and nothing else", () => {
    expect(cleanText("  Grüß dich,   Welt! 123")).toBe("Grüß dich Welt ");
    expect(cleanText("<script>alert(1)</script>")).toBe("script alert script ");
    expect(cleanText("la-la · geht's")).toBe("la-la · geht's");
    expect(cleanText("x".repeat(500))).toHaveLength(MAX_VOICE_TEXT);
    for (const junk of [null, undefined, 5, {}, ["la"]]) expect(cleanText(junk)).toBe("");
  });

  it("clamps the mouth and the breath and falls back on what is usual", () => {
    expect(cleanVoice({ text: "la", mouth: 7, breath: -3 })).toEqual({ text: "la", mouth: 1, breath: 0 });
    expect(cleanVoice({ text: 5, mouth: "weit", breath: Number.NaN })).toEqual({ text: "", mouth: 0.5, breath: 0.15 });
    expect(cleanVoice({ text: "la", mouth: 0.123456, breath: 0.987654 })).toEqual({ text: "la", mouth: 0.12, breath: 0.99 });
    expect(cleanVoice({})).toEqual(plain);
  });

  it("says in a few words what it sings", () => {
    expect(describeVoice(null)).toBe("noch keine Stimme");
    expect(describeVoice(plain)).toBe("singt nur den Vokal vom Klangfeld");
    expect(describeVoice({ ...plain, text: "Oh" })).toBe("„Oh“, 1 Silbe");
    expect(describeVoice({ ...plain, text: "Kaffeepause jetzt" })).toBe("„Kaf·fee·pau·se jetzt“, 5 Silben");
  });

  it("dices a line other than the one it has", () => {
    const random = seeded(3);
    let last = "";
    for (let roll = 0; roll < 40; roll += 1) {
      const line = diceLine(random, last);
      expect(line).not.toBe(last);
      expect(syllables(line).length).toBeGreaterThan(0);
      expect(cleanText(line)).toBe(line);
      last = line;
    }
  });
});

describe("a syllable as sounds", () => {
  it("sings long vowels long and short ones short", () => {
    expect(sing(alone("da")).vowel).toBe(vowel("a"));
    expect(sing(alone("Bahn")).vowel).toBe(vowel("a"));
    expect(sing(alone("Beet")).vowel).toBe(vowel("e"));
    expect(sing(alone("Bett")).vowel).toBe(vowel("E"));
    expect(sing(alone("Lied")).vowel).toBe(vowel("i"));
    expect(sing(alone("mit")).vowel).toBe(vowel("I"));
    expect(sing(alone("und")).vowel).toBe(vowel("U"));
    expect(sing(alone("grün")).vowel).toBe(vowel("ü"));
    expect(sing(alone("Typ")).vowel).toBe(vowel("ü"));
  });

  it("glides through double vowels", () => {
    expect([sing(alone("ein")).vowel, sing(alone("ein")).glide]).toEqual([vowel("a"), vowel("I")]);
    expect([sing(alone("Haus")).vowel, sing(alone("Haus")).glide]).toEqual([vowel("a"), vowel("U")]);
    expect([sing(alone("neu")).vowel, sing(alone("neu")).glide]).toEqual([vowel("O"), vowel("ü")]);
    expect(sing(alone("da")).glide).toBeNull();
  });

  it("only murmurs the e of an ending and of be- and ge-", () => {
    expect(sungIn("bitte", 1).vowel).toBe(vowel("@"));
    expect(sungIn("singen", 1).vowel).toBe(vowel("@"));
    expect(sungIn("Kreisel", 1).vowel).toBe(vowel("@"));
    expect(sungIn("Wetter", 1).vowel).toBe(vowel("R"));
    expect(sungIn("Gespräch", 0).vowel).toBe(vowel("@"));
    expect(sungIn("bekommen", 0).vowel).toBe(vowel("@"));
    // A word keeps one full vowel.
    expect(sungIn("Beben", 0).vowel).toBe(vowel("e"));
    expect(sungIn("geben", 0).vowel).toBe(vowel("e"));
    expect(sungIn("gegeben", 0).vowel).toBe(vowel("@"));
    expect(sungIn("gegeben", 1).vowel).toBe(vowel("e"));
    // A word of its own keeps its e.
    expect(sing(alone("der")).vowel).toBe(vowel("E"));
    expect(sing(alone("See")).vowel).toBe(vowel("e"));
  });

  it("makes consonants hisses, pops and hums", () => {
    const jetzt = sing(alone("jetzt"));
    expect(hums(jetzt.before)).toBe(1);
    // t, s, t: three noises, the s the highest.
    expect(noises(jetzt.after)).toHaveLength(3);
    expect(Math.max(...noises(jetzt.after))).toBe(noises(jetzt.after)[1]);
    expect(hums(sing(alone("Mann")).before)).toBe(1);
    // A doubled letter is one sound.
    expect(hums(sing(alone("Mann")).after)).toBe(1);
    expect(sing(alone("Bass")).after).toHaveLength(1);
    // "ng" is one hum, no pop.
    expect([hums(sing(alone("lang")).after), noises(sing(alone("lang")).after)]).toEqual([1, []]);
    // An h is breath.
    expect(sing(alone("Hallo")).before).toEqual([{ breath: 55 }]);
  });

  it("knows a few rules of speaking", () => {
    // "st" and "sp" at the start of a word are "scht" and "schp" ...
    expect(noises(sing(alone("Stern")).before)[0]).toBe(noises(sing(alone("Schal")).before)[0]);
    expect(noises(sing(alone("Spiel")).before)[0]).toBe(noises(sing(alone("Schal")).before)[0]);
    // ... but not in the middle of one.
    expect(noises(sungIn("Fenster", 1).before)[0]).not.toBe(noises(sing(alone("Schal")).before)[0]);
    // "ch" is dark after a, o, u and light after the others.
    expect(noises(sing(alone("ach")).after)[0]).toBeLessThan(noises(sing(alone("ich")).after)[0]!);
    // A consonant written twice across the cut is sung once, with the next syllable.
    expect(sungIn("Kaffee", 0).after).toEqual([]);
    expect(sungIn("Kaffee", 1).before).toHaveLength(1);
    // Not across two words.
    expect(sungIn("Bass so", 0).after).toHaveLength(1);
    // An r rolls before its vowel and is a darker vowel after it.
    expect(sing(alone("rot")).before).toEqual([{ hum: expect.objectContaining({ roll: true }) }]);
    expect(sing(alone("der")).after).toEqual([{ hum: expect.objectContaining({ roll: false }) }]);
  });

  it("puts a syllable without a vowel on the beat", () => {
    const pst = sing(alone("pst"));
    expect(pst.mute).toBe(true);
    expect(pst.before).toEqual([]);
    expect(noises(pst.after)).toHaveLength(3);
  });
});

describe("the mouth", () => {
  it("has the five vowels on the pad where a vowel chart has them", () => {
    expect(FIELD_LETTERS.map((letter) => letter.vowel).join("")).toBe("ieaou");
    for (const { x, y, vowel: name } of FIELD_LETTERS) {
      const here = fieldVowel(x, y);
      vowel(name).forEach((hz, index) => expect(Math.abs(Math.log(here[index]! / hz))).toBeLessThan(0.06));
      expect(fieldPull(x, y)).toBeCloseTo(1, 9);
    }
    expect(fieldPull(0.5, 0.5)).toBe(0);
    expect(fieldPull(0.5, 0.7)).toBeGreaterThan(0);
    expect(fieldPull(0.5, 0.7)).toBeLessThan(1);
  });

  it("leaves a vowel as it is in the middle of the pad and pulls it all the way at the edge", () => {
    const a = vowel("a");
    shape(a, plain, 0.5, 0.5).forEach((hz, index) => expect(hz).toBeCloseTo(a[index]!, 0));
    const pulled = shape(a, plain, 0.05, 0.95);
    vowel("i").forEach((hz, index) => expect(Math.abs(Math.log(pulled[index]! / hz))).toBeLessThan(0.06));
    // Half way it is in between.
    const half = shape(a, plain, 0.3, 0.7);
    expect(half[1]).toBeGreaterThan(a[1]);
    expect(half[1]).toBeLessThan(pulled[1]);
  });

  it("is brighter in a small mouth and darker in a big one, all three resonances alike", () => {
    const o = vowel("o");
    const small = shape(o, { ...plain, mouth: 0 }, 0.5, 0.5);
    const big = shape(o, { ...plain, mouth: 1 }, 0.5, 0.5);
    for (const index of [0, 1, 2]) {
      expect(small[index]! / o[index]!).toBeCloseTo(1.22, 5);
      expect(big[index]! / o[index]!).toBeCloseTo(0.82, 5);
    }
  });

  it("gapes for an a, smiles for an i and purses for an u", () => {
    const [a, i, u] = [mouthOf(vowel("a")), mouthOf(vowel("i")), mouthOf(vowel("u"))];
    expect(a.open).toBeGreaterThan(0.8);
    expect(i.open).toBeLessThan(0.15);
    expect(u.open).toBeLessThan(0.15);
    expect(i.wide).toBeGreaterThan(0.9);
    expect(u.wide).toBeLessThan(0.15);
    for (const name of Object.keys(VOWELS)) {
      const { open, wide } = mouthOf(vowel(name));
      expect(open).toBeGreaterThanOrEqual(0);
      expect(open).toBeLessThanOrEqual(1);
      expect(wide).toBeGreaterThanOrEqual(0);
      expect(wide).toBeLessThanOrEqual(1);
    }
  });
});

describe("a syllable in time", () => {
  it("puts the vowel on the beat and what comes before it ahead of the beat", () => {
    const la = plan(sing(alone("la")), 0.3);
    expect(la.lead).toBeCloseTo(0.045, 5);
    expect(la.line[0]).toMatchObject({ at: -la.lead, level: 0.6 });
    expect(la.line.find((point) => point.at === 0)).toMatchObject({ f: vowel("a"), level: 1 });
    // It ends when the note does.
    expect(la.line[la.line.length - 1]).toMatchObject({ at: 0.3, level: 0 });
    expect(la.end).toBeCloseTo(0.36, 5);
    expect(plan(sing(alone("a")), 0.3).lead).toBe(0);
  });

  it("never comes more than a seventh of a second early, however many consonants there are", () => {
    const strumpf = plan(sing(alone("Strumpf")), 0.3);
    expect(strumpf.lead).toBeCloseTo(0.14, 5);
    expect(Math.min(...strumpf.line.map((point) => point.at), ...strumpf.noises.map((noise) => noise.at))).toBeGreaterThanOrEqual(-0.14 - 1e-9);
    // All of them are over when the vowel begins.
    for (const noise of strumpf.noises.filter((one) => one.at < 0)) expect(noise.at + noise.ms / 1000).toBeLessThanOrEqual(1e-9);
  });

  it("ends with what comes after the vowel and leaves the vowel its time", () => {
    const long = plan(sing(alone("jetzt")), 0.4);
    const coda = long.noises.filter((noise) => noise.at > 0);
    expect(coda).toHaveLength(3);
    expect(coda[0]!.at).toBeGreaterThan(0.2);
    expect(coda[2]!.at).toBeLessThan(0.4);
    // On a short note the consonants are squeezed, the vowel still sounds.
    const short = plan(sing(alone("jetzt")), 0.08);
    expect(short.noises.filter((noise) => noise.at > 0)[0]!.at).toBeGreaterThanOrEqual(0.04 - 1e-9);
    expect(short.end).toBeLessThan(0.25);
  });

  it("glides a double vowel from its first sound to its second", () => {
    const ei = plan(sing(alone("ei")), 0.4);
    const sounding = ei.line.filter((point) => point.level > 0);
    expect(sounding[0]!.f).toEqual(vowel("a"));
    expect(sounding[sounding.length - 1]!.f).toEqual(vowel("I"));
    expect(sounding[sounding.length - 1]!.at).toBeGreaterThan(0.3);
  });

  it("is silent while the lips are closed, rolls an r and breathes an h", () => {
    const pa = plan(sing(alone("pa")), 0.3);
    expect(pa.line[0]).toMatchObject({ level: 0 });
    expect(pa.noises[0]!.at).toBeGreaterThan(pa.line[0]!.at);
    expect(plan(sing(alone("rot")), 0.3).rolls).toHaveLength(1);
    expect(plan(sing(alone("ha")), 0.3).breaths).toEqual([{ at: -0.055, ms: 55 }]);
    const pst = plan(sing(alone("pst")), 0.3);
    expect(pst.lead).toBe(0);
    expect(pst.line.every((point) => point.level === 0)).toBe(true);
    expect(pst.noises.every((noise) => noise.at >= 0)).toBe(true);
  });

  it("moves every sound through the mouth it is given", () => {
    const tuned = plan(sing(alone("la")), 0.3, (formants) => formants.map((hz) => hz * 2) as unknown as Formants);
    expect(tuned.line.find((point) => point.at === 0)!.f).toEqual(vowel("a").map((hz) => hz * 2));
    const points = plan(sing(alone("Strumpf")), 0.2).line;
    expect(points.map((point) => point.at)).toEqual([...points.map((point) => point.at)].sort((a, b) => a - b));
    expect(points.every((point) => point.f.every((hz) => Number.isFinite(hz) && hz > 0))).toBe(true);
  });
});

describe("which syllable a hit sings", () => {
  it("counts the hits of the ring, round after round", () => {
    const four = ring(16, [0, 4, 8, 12]);
    expect([0, 4, 8, 12].map((step) => hitNumber(four, step, step))).toEqual([0, 1, 2, 3]);
    expect([0, 4, 8, 12].map((step) => hitNumber(four, step, 16 + step))).toEqual([4, 5, 6, 7]);
    expect(hitNumber(four, 4, 16 * 5 + 4)).toBe(21);
  });

  it("counts a ring of its own length by its own rounds", () => {
    const three = ring(12, [0, 3, 10]);
    expect(hitNumber(three, 10, 10)).toBe(2);
    expect(hitNumber(three, 0, 12)).toBe(3);
    expect(hitNumber(three, 3, 27)).toBe(7);
    expect(hitNumber(ring(8, []), 3, 99)).toBe(0);
    expect(hitNumber(three, 0, -4)).toBe(0);
  });
});

describe("a voice in a link", () => {
  const sings = (project: Project, track: number, voice: Voice): void => {
    Object.assign(project.tracks[track]!, { voice, sound: VOICE_SOUND });
  };

  it("travels as its line and two numbers", async () => {
    const project = factoryProject();
    sings(project, 6, { text: "Kaffeepause jetzt", mouth: 0.3, breath: 0.6 });
    sings(project, 0, { text: "Bumm-tschak geht's ", mouth: 1, breath: 0 });
    project.tracks[4]!.voice = { text: "", mouth: 0.5, breath: 0.15 };
    expect(deserialize(serialize(project))).toEqual(project);
    expect(await decodeLink(await encodeLink(project))).toEqual(project);
    const packed = pack(project) as unknown as { t: unknown[][] };
    expect(packed.t[6]).toEqual([VOICE_SOUND, ...Array.from({ length: 5 }, () => expect.any(Number) as unknown), 0, 0, 0, "30.60.Kaffeepause jetzt"]);
    // A ring without a voice is as short as it was.
    expect(packed.t[1]).toHaveLength(7);
  });

  it("stays with a picture and a body on the same ring", () => {
    const project = factoryProject();
    const track = project.tracks[5]!;
    track.bild = { strokes: [{ kind: 0, size: 1, swell: false, points: [0, 100, 50, 100] }], hold: null };
    track.body = { kind: 2, size: 0.4, tight: 0.6, material: 0.5, exciter: 1, where: 0.3 };
    sings(project, 5, { text: "Oh ja", mouth: 0.5, breath: 0.15 });
    expect(deserialize(serialize(project))).toEqual(project);
  });

  it("takes nothing on trust", () => {
    for (const junk of [null, 5, "", "la", "5.5", "a.b.la", "1000.5.la", "-5.5.la", ["50.15.la"], `50.15.${"x".repeat(200)}`]) expect(unpackVoice(junk)).toBeNull();
    expect(unpackVoice("999.999.<b>Hallo</b> 1 Welt")).toEqual({ text: "b Hallo b Welt", mouth: 1, breath: 1 });
    expect(unpackVoice("0.0.")).toEqual({ text: "", mouth: 0, breath: 0 });
    // A ring cannot sing with a voice it does not have.
    const data = pack(factoryProject()) as unknown as { t: unknown[][] };
    data.t[3] = [VOICE_SOUND, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 77];
    data.t[2] = [99, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, "50.15.la"];
    const project = unpack(data);
    expect(project.tracks[3]).toMatchObject({ sound: 0, voice: null });
    expect(project.tracks[2]).toMatchObject({ sound: VOICE_SOUND, voice: { text: "la", mouth: 0.5, breath: 0.15 } });
  });

  it("is a change to its ring when the Kreisel is passed on", () => {
    const state = (change: (project: Project) => void = () => undefined): unknown => {
      const project = factoryProject();
      change(project);
      return JSON.parse(JSON.stringify(packState(project)));
    };
    const first = state((project) => sings(project, 6, { text: "Oh ja", mouth: 0.5, breath: 0.15 }));
    expect(changedRings(state(), first)).toEqual([6]);
    expect(changedRings(first, state((project) => sings(project, 6, { text: "Oh nein", mouth: 0.5, breath: 0.15 })))).toEqual([6]);
    expect(changedRings(first, first)).toEqual([]);
  });
});
