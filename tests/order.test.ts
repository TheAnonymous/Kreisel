import { describe, expect, it } from "vitest";
import { clone, factoryProject, type Project } from "../src/model";
import { cleanOrder, firstRound, layRound, MAX_ROUNDS, moveRound, nextRound, orderBars, orderOfOld, packOrder, removeRound, roundAfter, roundOnceLaid, roundOnceMoved, roundOnceRemoved, unpackOrder, withoutScene } from "../src/order";
import { deserialize, pack, serialize, unpack } from "../src/codec";

/** A Kreisel with scenes A, C and D filled (C has two bars of chords, the others four). */
function threeScenes(): Project {
  const project = factoryProject();
  const scene = project.scenes[0]!;
  project.scenes[2] = { ...clone(scene), chords: [0, 3] };
  project.scenes[3] = clone(scene);
  return project;
}

describe("the row of scenes", () => {
  it("lays a round where it is put, and at the end by default", () => {
    expect(layRound([0, 2], 3)).toEqual([0, 2, 3]);
    expect(layRound([0, 2], 3, 0)).toEqual([3, 0, 2]);
    expect(layRound([0, 2], 3, 1)).toEqual([0, 3, 2]);
    // A place beyond the end is the end; one before the start is the start.
    expect(layRound([0, 2], 3, 9)).toEqual([0, 2, 3]);
    expect(layRound([0, 2], 3, -4)).toEqual([3, 0, 2]);
  });

  it("holds no more rounds than fit", () => {
    const full = Array.from({ length: MAX_ROUNDS }, () => 0);
    expect(layRound(full, 2)).toEqual(full);
  });

  it("takes a round out, but never the last one", () => {
    expect(removeRound([0, 0, 2], 1)).toEqual([0, 2]);
    expect(removeRound([0], 0)).toEqual([0]);
    expect(removeRound([0, 2], 7)).toEqual([0, 2]);
  });

  it("moves a round to another place", () => {
    expect(moveRound([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
    expect(moveRound([0, 1, 2, 3], 3, 0)).toEqual([3, 0, 1, 2]);
    expect(moveRound([0, 1, 2, 3], 1, 1)).toEqual([0, 1, 2, 3]);
    expect(moveRound([0, 1, 2, 3], 1, 99)).toEqual([0, 2, 3, 1]);
  });

  it("loses the rounds of a scene that is cleared, and falls back to another scene when none is left", () => {
    expect(withoutScene([0, 2, 0, 3], 0, 2)).toEqual([2, 3]);
    expect(withoutScene([2, 2], 2, 0)).toEqual([0]);
  });

  it("keeps only scenes that are there", () => {
    const project = threeScenes();
    expect(cleanOrder([0, 1, 2, 9, -1, 3, 2.5 as number], project.scenes, 0)).toEqual([0, 2, 3]);
    expect(cleanOrder([1, 5], project.scenes, 2)).toEqual([2]);
    expect(cleanOrder("nonsense" as unknown as number[], project.scenes, 0)).toEqual([0]);
    expect(cleanOrder(Array.from({ length: 200 }, () => 0), project.scenes, 0)).toHaveLength(MAX_ROUNDS);
  });

  it("goes round and round", () => {
    expect(nextRound([0, 0, 2], 0)).toBe(1);
    expect(nextRound([0, 0, 2], 2)).toBe(0);
    // A round that is not in the row any more goes on at the start.
    expect(nextRound([0, 2], 5)).toBe(0);
    expect(nextRound([0, 2], null)).toBe(0);
  });

  it("begins with the first round of the scene on the table, or before the row", () => {
    expect(firstRound([0, 2, 0, 3], 0)).toBe(0);
    expect(firstRound([0, 2, 0, 3], 3)).toBe(3);
    expect(firstRound([0, 2], 3)).toBeNull();
  });

  it("goes on from the next round of a scene picked by hand", () => {
    expect(roundAfter([0, 2, 0, 3], 0, 0)).toBe(2);
    expect(roundAfter([0, 2, 0, 3], 0, 2)).toBe(0);
    expect(roundAfter([0, 2, 0, 3], 3, null)).toBe(3);
    expect(roundAfter([0, 2], 2, 1)).toBe(1);
    expect(roundAfter([0, 2], 5, 0)).toBeNull();
  });

  it("keeps a player with its round while the row is changed under it", () => {
    // A round laid before it pushes it on; one laid after it does not.
    expect(roundOnceLaid(2, 0)).toBe(3);
    expect(roundOnceLaid(2, 2)).toBe(3);
    expect(roundOnceLaid(2, 3)).toBe(2);
    // A round taken out before it pulls it back; the round taken out itself leaves the one before it, so what follows is what followed.
    expect(roundOnceRemoved(2, 0, 3)).toBe(1);
    expect(roundOnceRemoved(2, 3, 3)).toBe(2);
    expect(roundOnceRemoved(2, 2, 3)).toBe(1);
    expect(nextRound([7, 7, 7], roundOnceRemoved(2, 2, 3))).toBe(2);
    expect(roundOnceRemoved(0, 0, 3)).toBe(2);
    expect(nextRound([7, 7, 7], roundOnceRemoved(0, 0, 3))).toBe(0);
    // A round that is moved is followed; the others close the gap and make room.
    for (const [from, to] of [[0, 3], [3, 0], [1, 2], [2, 2]] as const) {
      const row = [10, 11, 12, 13];
      const moved = moveRound(row, from, to);
      row.forEach((scene, round) => expect(moved[roundOnceMoved(round, from, to)]).toBe(scene));
    }
  });

  it("is as long as its rounds: each scene once through its chords", () => {
    const project = threeScenes();
    project.order = [0, 0, 2, 3];
    expect(orderBars(project)).toBe(4 + 4 + 2 + 4);
  });

  it("is what an older Kreisel played: every filled scene in turn, each as often as it said", () => {
    const project = threeScenes();
    expect(orderOfOld(project.scenes, 1)).toEqual([0, 2, 3]);
    expect(orderOfOld(project.scenes, 2)).toEqual([0, 0, 2, 2, 3, 3]);
  });

  it("travels as a string of digits", () => {
    expect(packOrder([0, 0, 2, 7])).toBe("0027");
    expect(unpackOrder("0027")).toEqual([0, 0, 2, 7]);
    expect(unpackOrder("0x9 2")).toEqual([0, 2]);
    expect(unpackOrder(17)).toEqual([]);
  });
});

describe("the row in a link and in the browser's memory", () => {
  it("comes back as it was laid", () => {
    const project = threeScenes();
    project.chain = true;
    project.order = [0, 0, 2, 0, 3];
    expect(unpack(pack(project))).toEqual(project);
    expect(deserialize(serialize(project))).toEqual(project);
  });

  it("costs nothing in the link while every scene plays once in turn", () => {
    const project = threeScenes();
    project.order = [0, 2, 3];
    expect("f" in pack(project)).toBe(false);
    project.order = [0, 2, 2, 3];
    expect((pack(project) as unknown as { f: string }).f).toBe("0223");
  });

  it("reads a link from before: the filled scenes in turn, as often as it said", () => {
    const project = threeScenes();
    const old = pack(project) as unknown as Record<string, unknown>;
    delete old.f;
    old.k = 1;
    old.n = 2;
    const read = unpack(old);
    expect(read.chain).toBe(true);
    expect(read.order).toEqual([0, 0, 2, 2, 3, 3]);
    expect("repeats" in read).toBe(false);
  });

  it("does not follow a link into scenes that are not there", () => {
    const project = threeScenes();
    const data = pack(project) as unknown as Record<string, unknown>;
    data.f = "0129977";
    expect(unpack(data).order).toEqual([0, 2]);
    data.f = "55";
    expect(unpack(data).order).toEqual([0, 2, 3]);
    data.f = { length: 3 };
    expect(unpack(data).order).toEqual([0, 2, 3]);
  });

  it("starts with one round of the one scene there is", () => {
    expect(factoryProject().order).toEqual([0]);
  });
});
