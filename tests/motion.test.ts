import { describe, expect, it } from "vitest";
import { emptyStep, type Step } from "../src/model";
import { approach, compare, DEAL, dealt, face, hop, rest, swell, unface } from "../src/ui/motion";

const hit = (values: Partial<Step> = {}): Step => ({ ...emptyStep(), on: true, ...values });
const ring = (length: number, hits: Record<number, Partial<Step>>): number[] =>
  Array.from({ length }, (_, index) => (hits[index] ? face(hit(hits[index])) : 0));

describe("the curves", () => {
  it("hops into place: from nothing to all, a little over on the way", () => {
    expect(hop(0)).toBeCloseTo(0, 9);
    expect(hop(1)).toBeCloseTo(1, 9);
    const most = Math.max(...Array.from({ length: 101 }, (_, index) => hop(index / 100)));
    expect(most).toBeGreaterThan(1.05);
    expect(most).toBeLessThan(1.2);
    expect(hop(-1)).toBeCloseTo(0, 9);
    expect(hop(2)).toBeCloseTo(1, 9);
  });

  it("comes to rest: always forward, never over", () => {
    let before = 0;
    for (let index = 0; index <= 100; index += 1) {
      const now = rest(index / 100);
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(1);
      before = now;
    }
    expect(rest(0)).toBe(0);
    expect(rest(1)).toBe(1);
    expect(rest(0.5)).toBeGreaterThan(0.8);
  });

  it("swells once and is gone", () => {
    expect(swell(0)).toBeCloseTo(0, 9);
    expect(swell(0.5)).toBeCloseTo(1, 9);
    expect(swell(1)).toBeCloseTo(0, 9);
  });

  it("approaches a target and arrives", () => {
    let value = 0;
    for (let frame = 0; frame < 40; frame += 1) value = approach(value, 1, 0.3);
    expect(value).toBe(1);
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3, 9);
    expect(approach(0.999, 1, 0.3)).toBe(1);
  });
});

describe("what a step looks like", () => {
  it("is nothing for a step without a hit", () => {
    expect(face(emptyStep())).toBe(0);
    expect(face({ ...hit({ pitch: 5, vel: 2 }), on: false })).toBe(0);
  });

  it("tells every look of a hit apart, and gives it back", () => {
    const looks: Step[] = [hit(), hit({ vel: 0 }), hit({ vel: 2 }), hit({ chance: 3 }), hit({ ratchet: 4 }), hit({ pitch: -7 }), hit({ pitch: 14 }), hit({ len: 16 })];
    const faces = looks.map(face);
    expect(new Set(faces).size).toBe(looks.length);
    looks.forEach((look, index) => expect(unface(faces[index] ?? 0)).toEqual(look));
  });
});

describe("what happened to a ring", () => {
  const before = ring(16, { 0: {}, 4: { vel: 2 }, 8: {}, 13: { pitch: 3 } });

  it("is nothing when nothing changed", () => {
    expect(compare(before, [...before])).toEqual({ born: [], gone: [], nudged: [], turned: 0 });
  });

  it("sees a hit that was set and one that was taken", () => {
    expect(compare(before, ring(16, { 0: {}, 4: { vel: 2 }, 6: {}, 8: {}, 13: { pitch: 3 } }))).toEqual({ born: [6], gone: [], nudged: [], turned: 0 });
    expect(compare(before, ring(16, { 0: {}, 4: { vel: 2 }, 13: { pitch: 3 } }))).toEqual({ born: [], gone: [8], nudged: [], turned: 0 });
  });

  it("sees an accent, a chance or a roll that changed, but not a pitch or a length", () => {
    expect(compare(before, ring(16, { 0: { vel: 2 }, 4: { vel: 2 }, 8: { chance: 1 }, 13: { pitch: 3, ratchet: 3 } })).nudged).toEqual([0, 8, 13]);
    expect(compare(before, ring(16, { 0: { pitch: 7 }, 4: { vel: 2, len: 4 }, 8: {}, 13: { pitch: -2 } }))).toEqual({ born: [], gone: [], nudged: [], turned: 0 });
  });

  it("sees a ring that was turned, either way, by one step or two", () => {
    const turned = (by: number): number[] => before.map((_, index) => before[(((index - by) % 16) + 16) % 16] ?? 0);
    for (const by of [1, -1, 2, -2]) expect(compare(before, turned(by))).toEqual({ born: [], gone: [], nudged: [], turned: by });
    // Further than that it is a new pattern.
    const far = compare(before, turned(5));
    expect(far.turned).toBe(0);
    expect(far.born.length + far.gone.length).toBeGreaterThan(0);
  });

  it("does not take a ring that looks the same after a turn for a turned one", () => {
    const even = ring(8, { 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} });
    expect(compare(even, [...even]).turned).toBe(0);
  });

  it("copes with a ring that became longer or shorter", () => {
    const short = ring(8, { 0: {}, 4: { vel: 2 } });
    expect(compare(before, short)).toEqual({ born: [], gone: [8, 13], nudged: [], turned: 0 });
    expect(compare(short, before)).toEqual({ born: [8, 13], gone: [], nudged: [], turned: 0 });
    expect(compare([], before).born).toEqual([0, 4, 8, 13]);
  });

  it("deals a ring from its first step to its last", () => {
    expect(dealt(0, 16)).toBe(0);
    expect(dealt(8, 16)).toBeCloseTo(DEAL / 2, 9);
    expect(dealt(15, 16)).toBeLessThan(DEAL);
    expect(dealt(3, 0)).toBeGreaterThanOrEqual(0);
  });
});
