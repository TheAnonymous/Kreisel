import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, pack, packState, unpack } from "../src/codec";
import { clone, emptyScene, factoryProject, MAX_NAME, MAX_TURNS, stepAt, type Project } from "../src/model";
import { dice, seeded } from "../src/patterns";
import { changedRings, cleanName, PEOPLE, ringsWithContent, turnColor } from "../src/relay";

const state = (change: (project: Project) => void = () => undefined): unknown => {
  const project = factoryProject();
  change(project);
  return JSON.parse(JSON.stringify(packState(project)));
};

describe("what a turn touched", () => {
  it("is nothing when nothing changed, and not the tempo, key or chords", () => {
    expect(changedRings(state(), state())).toEqual([]);
    expect(changedRings(state(), state((project) => {
      project.bpm = 140;
      project.root = 2;
      project.scenes[0]!.chords = [0, 3];
      project.piece.on = true;
    }))).toEqual([]);
  });

  it("is the ring whose pattern, sound or mix changed", () => {
    expect(changedRings(state(), state((project) => { stepAt(project.scenes[0]!.patterns[2]!, 5).on = true; }))).toEqual([2]);
    expect(changedRings(state(), state((project) => { project.tracks[4]!.sound = 1; }))).toEqual([4]);
    expect(changedRings(state(), state((project) => { project.tracks[6]!.hall = 0.9; }))).toEqual([6]);
    expect(changedRings(state(), state((project) => {
      project.scenes[0]!.patterns[0] = dice(0, 16, seeded(5));
      project.tracks[5]!.bild = { strokes: [{ kind: 0, size: 1, swell: false, points: [0, 100, 50, 100] }], hold: null };
    }))).toEqual([0, 5]);
  });

  it("does not count copying a scene, only what is then changed in the copy", () => {
    const copied = state((project) => { project.scenes[1] = clone(project.scenes[0]!); });
    expect(changedRings(state(), copied)).toEqual([]);
    const varied = state((project) => {
      project.scenes[1] = clone(project.scenes[0]!);
      stepAt(project.scenes[1].patterns[3]!, 1).on = true;
    });
    expect(changedRings(state(), varied)).toEqual([3]);
    expect(changedRings(copied, varied)).toEqual([3]);
    // A new scene that is empty takes nothing away from anyone.
    expect(changedRings(state(), state((project) => { project.scenes[2] = emptyScene(); }))).toEqual([]);
  });

  it("is every ring that plays when there was no turn before", () => {
    expect(changedRings(null, state())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const one = state((project) => {
      project.scenes[0] = emptyScene();
      stepAt(project.scenes[0].patterns[4]!, 0).on = true;
    });
    expect(ringsWithContent(one)).toEqual([4]);
    expect(changedRings(null, one)).toEqual([4]);
    expect(ringsWithContent(null)).toEqual([]);
  });
});

describe("people", () => {
  it("keep their colour through the round, whatever the spelling", () => {
    const relay = { rule: 0, open: false, turns: ["Jodie", "Mika", "jodie", "Ada", "MIKA"].map((name) => ({ name, state: state() })) };
    expect(turnColor(relay, 0)).toBe(PEOPLE[0]);
    expect(turnColor(relay, 2)).toBe(PEOPLE[0]);
    expect(turnColor(relay, 1)).toBe(PEOPLE[1]);
    expect(turnColor(relay, 4)).toBe(PEOPLE[1]);
    expect(turnColor(relay, 3)).toBe(PEOPLE[2]);
  });

  it("have names that are safe to pass on", () => {
    expect(cleanName("  Jodie  ", MAX_NAME)).toBe("Jodie");
    expect(cleanName("a\u0000b\u0007c\n", MAX_NAME)).toBe("abc");
    expect(cleanName("x".repeat(99), MAX_NAME)).toHaveLength(MAX_NAME);
    expect(cleanName("", MAX_NAME)).toBe("Jemand");
    expect(cleanName(42, MAX_NAME)).toBe("Jemand");
    expect(cleanName("<b>Mika</b>", MAX_NAME)).toBe("<b>Mika</b>");
  });
});

describe("turns in a link", () => {
  const round = (turns: number): Project => {
    const project = factoryProject();
    project.relay = { rule: 1, open: false, turns: [] };
    for (let turn = 0; turn < turns; turn += 1) {
      project.scenes[0]!.patterns[turn % 7] = dice(turn % 7, 16, seeded(turn + 1));
      project.relay.turns.push({ name: turn % 2 === 0 ? "Jodie" : "Mika", state: JSON.parse(JSON.stringify(packState(project))) });
    }
    return project;
  };

  it("round-trip, each with the Kreisel as it was", async () => {
    const project = round(5);
    const back = await decodeLink(await encodeLink(project));
    expect(back).toEqual(JSON.parse(JSON.stringify(project)));
    expect(back.relay!.turns.map((turn) => turn.name)).toEqual(["Jodie", "Mika", "Jodie", "Mika", "Jodie"]);
    // A turn's state is a whole Kreisel of its own, without turns.
    const third = unpack(back.relay!.turns[2]!.state, true);
    expect(third.relay).toBeNull();
    expect(third.scenes[0]!.patterns[2]).toEqual(dice(2, 16, seeded(3)));
    expect(changedRings(back.relay!.turns[1]!.state, back.relay!.turns[2]!.state)).toEqual([2]);
  });

  it("cost little each: twelve turns still make a link to pass around", async () => {
    const one = (await encodeLink(round(1))).length;
    const twelve = (await encodeLink(round(MAX_TURNS))).length;
    expect(twelve).toBeLessThan(2500);
    expect((twelve - one) / (MAX_TURNS - 1)).toBeLessThan(140);
  });

  it("are put right when a link claims nonsense", () => {
    const data = pack(round(2)) as unknown as { y: { r: unknown; o: unknown; t: unknown[] } };
    // A rule that does not exist, a turn that is no Kreisel, a name with control characters, a turn that claims turns of its own.
    const nested = JSON.parse(JSON.stringify(pack(round(3))));
    data.y = { r: 9, o: "ja", t: [["Ok", data.y.t[0] && (data.y.t[0] as unknown[])[1]], ["Kaputt", { v: 7 }], "unsinn", ["A\u0001B", nested]] };
    const relay = unpack(data).relay!;
    expect(relay.rule).toBe(2);
    expect(relay.open).toBe(false);
    expect(relay.turns.map((turn) => turn.name)).toEqual(["Ok", "AB"]);
    expect((relay.turns[1]!.state as { y?: unknown }).y).toBeUndefined();
    // More turns than a round keeps: the newest stay.
    const long = pack(round(2)) as unknown as { y: { t: unknown[] } };
    const turn = long.y.t[0] as [string, unknown];
    long.y.t = Array.from({ length: 40 }, (_, index) => [`P${index}`, turn[1]]);
    const kept = unpack(long).relay!.turns;
    expect(kept).toHaveLength(MAX_TURNS);
    expect(kept[MAX_TURNS - 1]!.name).toBe("P39");
    // No turns at all is no round with turns, but still a round.
    expect(unpack({ ...pack(factoryProject()), y: { r: 0, o: 1, t: [] } }).relay).toEqual({ rule: 0, open: true, turns: [] });
    expect(unpack(pack(factoryProject())).relay).toBeNull();
  });
});
