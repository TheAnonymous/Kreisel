import { describe, expect, it } from "vitest";
import { emptyPattern, MAX_STEPS, PITCH_MAX, PITCH_MIN, stepAt, TRACK_COUNT } from "../src/model";
import { activeSteps, clear, describe as words, dice, euclid, resize, rotate, seeded, spread, transpose, vary } from "../src/patterns";

const draw = (shape: boolean[]): string => shape.map((on) => (on ? "x" : ".")).join("");

function ring(length: number, hits: number[]) {
  const pattern = emptyPattern(length);
  for (const hit of hits) stepAt(pattern, hit).on = true;
  return pattern;
}

describe("even rhythms", () => {
  it("spreads hits as evenly as they go", () => {
    expect(draw(euclid(4, 16))).toBe("x...x...x...x...");
    expect(draw(euclid(3, 8))).toBe("x..x..x.");
    expect(draw(euclid(5, 8))).toBe("x.x.xx.x");
    expect(draw(euclid(0, 4))).toBe("....");
    expect(draw(euclid(9, 4))).toBe("xxxx");
  });

  it("spreads a ring from its first hit and keeps what stays", () => {
    const pattern = ring(16, [2]);
    stepAt(pattern, 2).pitch = 5;
    spread(pattern, 4);
    expect(activeSteps(pattern)).toEqual([2, 6, 10, 14]);
    expect(stepAt(pattern, 2).pitch).toBe(5);
    expect(stepAt(pattern, 6).pitch).toBe(5);
    spread(pattern, 0);
    expect(activeSteps(pattern)).toEqual([]);
  });
});

describe("turning and resizing", () => {
  it("turns only the visible steps", () => {
    const pattern = ring(12, [0, 11]);
    stepAt(pattern, 20).on = true;
    rotate(pattern, 1);
    expect(activeSteps(pattern)).toEqual([0, 1]);
    rotate(pattern, -2);
    expect(activeSteps(pattern)).toEqual([10, 11]);
    expect(stepAt(pattern, 20).on).toBe(true);
  });

  it("keeps hidden steps when a ring shrinks and grows", () => {
    const pattern = ring(16, [0, 12]);
    resize(pattern, 8);
    expect(activeSteps(pattern)).toEqual([0]);
    resize(pattern, 16);
    expect(activeSteps(pattern)).toEqual([0, 12]);
    resize(pattern, 99);
    expect(pattern.len).toBe(MAX_STEPS);
  });

  it("transposes within the range and clears", () => {
    const pattern = ring(16, [0, 4]);
    stepAt(pattern, 4).pitch = PITCH_MAX;
    transpose(pattern, 2);
    expect(stepAt(pattern, 0).pitch).toBe(2);
    expect(stepAt(pattern, 4).pitch).toBe(PITCH_MAX);
    clear(pattern);
    expect(activeSteps(pattern)).toEqual([]);
  });
});

describe("dice", () => {
  it("gives the same idea for the same seed", () => {
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      expect(dice(track, 16, seeded(7))).toEqual(dice(track, 16, seeded(7)));
    }
  });

  it("always fills a ring of any length with something playable", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      for (let track = 0; track < TRACK_COUNT; track += 1) {
        for (const length of [2, 5, 12, 16, 32]) {
          const pattern = dice(track, length, seeded(seed * 31 + track));
          expect(pattern.len).toBe(length);
          expect(pattern.steps).toHaveLength(MAX_STEPS);
          expect(activeSteps(pattern).length, `track ${track}, ${length} steps, seed ${seed}`).toBeGreaterThan(0);
          for (const step of pattern.steps) {
            expect(step.pitch).toBeGreaterThanOrEqual(PITCH_MIN);
            expect(step.pitch).toBeLessThanOrEqual(PITCH_MAX);
            expect(step.len).toBeGreaterThanOrEqual(1);
            expect(step.len).toBeLessThanOrEqual(16);
            expect([1, 2, 3, 4]).toContain(step.ratchet);
          }
          // Nothing lands outside the visible ring.
          expect(pattern.steps.slice(length).some((step) => step.on)).toBe(false);
        }
      }
    }
  });

  it("varies a ring a little, never into nothing", () => {
    const random = seeded(99);
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const pattern = dice(track, 16, seeded(3));
      for (let round = 0; round < 80; round += 1) {
        const before = activeSteps(pattern).length;
        vary(track, pattern, random);
        const after = activeSteps(pattern).length;
        expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
        expect(after).toBeGreaterThan(0);
        for (const step of pattern.steps) {
          expect(step.pitch).toBeGreaterThanOrEqual(PITCH_MIN);
          expect(step.pitch).toBeLessThanOrEqual(PITCH_MAX);
        }
      }
    }
  });

  it("puts a first hit into an empty ring", () => {
    const pattern = emptyPattern(8);
    vary(0, pattern, seeded(1));
    expect(activeSteps(pattern)).toHaveLength(1);
  });
});

describe("words", () => {
  it("says what is on a ring", () => {
    expect(words(ring(16, [0, 4, 8, 12]))).toBe("4 Schläge auf 1, 5, 9, 13 von 16");
    expect(words(ring(12, [3]))).toBe("1 Schlag auf 4 von 12");
    expect(words(ring(8, []))).toBe("leer, 8 Schritte");
  });
});
