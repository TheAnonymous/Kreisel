import { describe, expect, it } from "vitest";
import { deserialize, packState, serialize, unpackRumble } from "../src/codec";
import { clone, emptyPattern, emptyRumble, factoryProject, MAX_STEPS, RUMBLE_MAX, stepAt, type Pattern, type Project } from "../src/model";
import { seeded } from "../src/patterns";
import { changedRings } from "../src/relay";
import { cleanRumble, describeRumble, diceRumble, hasRumble, RUMBLE_SHAPES, rumbleHz, rumbleShape, rumbleShare, shakes, shapeOf } from "../src/rumble";

/** A kick ring of `length` steps with hits on `hits`. */
function kicks(length: number, hits: readonly number[]): Pattern {
  const pattern = emptyPattern(length);
  for (const hit of hits) stepAt(pattern, hit).on = true;
  return pattern;
}
const four = kicks(16, [0, 4, 8, 12]);
const state = (change: (project: Project) => void = () => undefined): unknown => {
  const project = factoryProject();
  change(project);
  return JSON.parse(JSON.stringify(packState(project)));
};

describe("the shapes of the rumble", () => {
  it("swells between the kicks, rolls through them, or trails after them; never on a kick", () => {
    expect(rumbleShape(four, 0).slice(0, 8)).toEqual([0, 12, 15, 12, 0, 12, 15, 12]);
    expect(rumbleShape(four, 1).slice(0, 8)).toEqual([0, 15, 13, 15, 0, 15, 13, 15]);
    expect(rumbleShape(four, 2).slice(0, 8)).toEqual([0, 15, 9, 5, 0, 15, 9, 5]);
    for (let shape = 0; shape < RUMBLE_SHAPES.length; shape += 1) {
      const line = rumbleShape(four, shape);
      expect(line).toHaveLength(MAX_STEPS);
      // Nothing beyond the ring's last step.
      expect(line.slice(16).every((value) => value === 0)).toBe(true);
      expect(line.every((value) => Number.isInteger(value) && value >= 0 && value <= RUMBLE_MAX)).toBe(true);
    }
  });

  it("is laid around the kicks that are there, also in a broken beat and across the ring's end", () => {
    const broken = kicks(12, [0, 3, 10]);
    const swell = rumbleShape(broken, 0);
    expect([swell[0], swell[3], swell[10]]).toEqual([0, 0, 0]);
    // The long gap from step 3 to step 10 is loudest in its middle, the short ones too.
    expect(swell.indexOf(Math.max(...swell.slice(4, 10)), 4)).toBeGreaterThanOrEqual(6);
    expect(swell.indexOf(Math.max(...swell.slice(4, 10)), 4)).toBeLessThanOrEqual(7);
    expect(swell[11]).toBeGreaterThan(0);
    // A tail after the last kick runs on over the ring's end to the first.
    const late = rumbleShape(kicks(8, [6]), 2);
    expect(late.slice(0, 8)).toEqual([late[0], late[1], late[2], late[3], late[4], late[5], 0, 15]);
    expect(late[0]).toBeGreaterThan(late[1]!);
    expect(late[0]).toBeLessThan(15);
  });

  it("without a kick there is a line, though nothing will shake", () => {
    const line = rumbleShape(emptyPattern(8), 0);
    expect(line.slice(0, 8).every((value) => value > 0)).toBe(true);
  });

  it("is told apart again, and dice change it a little without touching the kicks", () => {
    for (let shape = 0; shape < RUMBLE_SHAPES.length; shape += 1) expect(shapeOf(four, rumbleShape(four, shape))).toBe(shape);
    expect(shapeOf(four, emptyRumble())).toBe(-1);
    const painted = rumbleShape(four, 0);
    painted[2] = 3;
    expect(shapeOf(four, painted)).toBe(-1);
    const thrown = diceRumble(four, 1, seeded(7));
    expect(thrown).toEqual(diceRumble(four, 1, seeded(7)));
    expect([thrown[0], thrown[4], thrown[8], thrown[12]]).toEqual([0, 0, 0, 0]);
    expect(thrown.slice(0, 16).filter((value) => value > 0)).toHaveLength(12);
    expect(thrown.every((value) => value >= 0 && value <= RUMBLE_MAX)).toBe(true);
    expect(thrown).not.toEqual(diceRumble(four, 1, seeded(8)));
  });

  it("says in words what is there", () => {
    const project = factoryProject();
    const scene = project.scenes[0]!;
    expect(describeRumble(scene, scene.patterns[0]!)).toBe("no rumble");
    expect(hasRumble(scene)).toBe(false);
    scene.rumble = rumbleShape(scene.patterns[0]!, 1);
    expect(describeRumble(scene, scene.patterns[0]!)).toBe("Rumble (Rolling) on 12 of 16 steps, up to 100 %");
    scene.rumble[1] = 4;
    expect(describeRumble(scene, scene.patterns[0]!)).toBe("Rumble on 12 of 16 steps, up to 100 %");
    expect(hasRumble(scene)).toBe(true);
    // What lies beyond the ring's length does not count.
    scene.rumble = emptyRumble();
    scene.rumble[20] = 9;
    expect(hasRumble(scene, 16)).toBe(false);
  });
});

describe("the rumble's sound in numbers", () => {
  it("lets out nothing at the bottom of the line and everything at the top", () => {
    expect(rumbleShare(0)).toBe(0);
    expect(rumbleShare(RUMBLE_MAX)).toBe(1);
    expect(rumbleShare(8)).toBeGreaterThan(rumbleShare(7));
    expect(rumbleShare(7)).toBeLessThan(0.5);
    expect(rumbleShare(99)).toBe(1);
    expect(rumbleShare(-3)).toBe(0);
  });

  it("brings the chord's root down to where a rumble lives", () => {
    expect(rumbleHz(55)).toBe(55);
    expect(rumbleHz(110)).toBe(55);
    expect(rumbleHz(440)).toBe(55);
    expect(rumbleHz(43.65)).toBeCloseTo(43.65, 5);
    expect(rumbleHz(82.41)).toBeCloseTo(41.205, 3);
    expect(rumbleHz(27.5)).toBe(55);
    for (const hz of [20, 31, 38, 61.7, 76, 98, 1000]) {
      expect(rumbleHz(hz)).toBeGreaterThanOrEqual(38);
      expect(rumbleHz(hz)).toBeLessThan(76);
    }
    expect(rumbleHz(0)).toBe(55);
    expect(rumbleHz(Number.NaN)).toBe(55);
  });

  it("is painted with the tool that holds notes, but only on the kick's ring", () => {
    expect(shakes(0, "laenge")).toBe(true);
    expect(shakes(0, "setzen")).toBe(false);
    expect(shakes(4, "laenge")).toBe(false);
  });
});

describe("the rumble in the link", () => {
  it("travels with its scene and its character, and costs nothing where nothing shakes", () => {
    const project = factoryProject();
    expect(serialize(project)).not.toContain('"q"');
    project.scenes[0]!.rumble = rumbleShape(project.scenes[0]!.patterns[0]!, 0);
    project.scenes[2] = clone(project.scenes[0]!);
    project.scenes[2].rumble = rumbleShape(project.scenes[0]!.patterns[0]!, 2);
    project.dirt = 0.9;
    project.roll = 0.05;
    const text = serialize(project);
    expect(text).toContain('"q":"0cfc0cfc0cfc0cfc"');
    const back = deserialize(text);
    expect(back.scenes[0]!.rumble).toEqual(project.scenes[0]!.rumble);
    expect(back.scenes[2]!.rumble).toEqual(project.scenes[2].rumble);
    expect(back.scenes[1]).toBeNull();
    expect([back.dirt, back.roll]).toEqual([0.9, 0.05]);
  });

  it("takes whatever a link claims and keeps it where it may be", () => {
    expect(unpackRumble("0cfc")).toEqual(cleanRumble([0, 12, 15, 12]));
    for (const hostile of [null, 7, "", "xyz", "0CFC", "0cfc ".repeat(3), "f".repeat(33), ["f"], { q: "ff" }]) {
      expect(unpackRumble(hostile)).toEqual(emptyRumble());
    }
    expect(cleanRumble([99, -4, 2.6, "7", Number.NaN]).slice(0, 6)).toEqual([15, 0, 3, 0, 0, 0]);
    expect(cleanRumble("no")).toEqual(emptyRumble());
    // A link from before the Nachbeben, and one with a nonsense character.
    const old = JSON.parse(serialize(factoryProject())) as Record<string, unknown>;
    delete old.w;
    expect([deserialize(JSON.stringify(old)).dirt, deserialize(JSON.stringify(old)).roll]).toEqual([0.35, 0.2]);
    old.w = ["viel", 900];
    expect([deserialize(JSON.stringify(old)).dirt, deserialize(JSON.stringify(old)).roll]).toEqual([0.35, 1]);
    old.w = "loud";
    expect(deserialize(JSON.stringify(old)).roll).toBe(0.2);
  });

  it("counts as the kick's ring in Pass around: its line and its character, but not a copied scene", () => {
    expect(changedRings(state(), state((project) => { project.scenes[0]!.rumble[5] = 9; }))).toEqual([0]);
    expect(changedRings(state(), state((project) => { project.dirt = 0.8; }))).toEqual([0]);
    expect(changedRings(state(), state((project) => { project.roll = 0.6; }))).toEqual([0]);
    const shaking = (project: Project): void => { project.scenes[0]!.rumble = rumbleShape(project.scenes[0]!.patterns[0]!, 0); };
    expect(changedRings(state(shaking), state((project) => {
      shaking(project);
      project.scenes[3] = clone(project.scenes[0]!);
    }))).toEqual([]);
    expect(changedRings(state(shaking), state((project) => {
      shaking(project);
      project.scenes[3] = clone(project.scenes[0]!);
      project.scenes[3].rumble = rumbleShape(project.scenes[0]!.patterns[0]!, 2);
    }))).toEqual([0]);
    expect(changedRings(state(shaking), state((project) => { project.scenes[0]!.rumble = emptyRumble(); }))).toEqual([0]);
  });
});
