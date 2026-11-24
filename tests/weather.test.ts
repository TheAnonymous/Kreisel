import { describe, expect, it } from "vitest";
import { deserialize, packState, serialize } from "../src/codec";
import { clone, emptyWeather, emptyWind, factoryProject, TRACK_COUNT, WEATHER_COUNT, WEATHER_MAX, type Project } from "../src/model";
import { seeded } from "../src/patterns";
import { changedRings } from "../src/relay";
import { brightness, cleanWeather, cleanWind, describeWeather, diceWeather, hasWeather, packWeather, shaded, shadesSound, unpackWeather, weatherAt, weatherOn, weatherOver, windDrift, windName, windOffset, WINDS } from "../src/weather";

const state = (change: (project: Project) => void = () => undefined): unknown => {
  const project = factoryProject();
  change(project);
  return JSON.parse(JSON.stringify(packState(project)));
};

describe("weather over the wheel", () => {
  it("lies on a ring's steps and is heard there", () => {
    const scene = factoryProject().scenes[0]!;
    expect(hasWeather(scene)).toBe(false);
    scene.weather[2]![4]![5] = 15;
    scene.weather[0]![4]![5] = 6;
    expect(weatherAt(scene, 2, 4, 5, 0)).toBe(1);
    expect(weatherAt(scene, 2, 4, 6, 0)).toBe(0);
    expect(weatherAt(scene, 2, 3, 5, 0)).toBe(0);
    expect(weatherOver(scene, 4, 5, 0)).toEqual([0.4, 0, 1, 0, 0, 0]);
    expect(hasWeather(scene)).toBe(true);
    expect(hasWeather(scene, 2)).toBe(true);
    expect(hasWeather(scene, 3)).toBe(false);
    expect(hasWeather(scene, 2, 4)).toBe(true);
    expect(hasWeather(scene, undefined, 3)).toBe(false);
    // What lies beyond a ring's last step does not count.
    scene.weather[5]![3]![20] = 9;
    expect(hasWeather(scene, 5)).toBe(false);
  });

  it("drifts with its wind: a step a bar is a step after sixteen steps of playing, either way", () => {
    expect(windOffset(0, 4)).toBe(0);
    expect(windOffset(15, 4)).toBe(0);
    expect(windOffset(16, 4)).toBe(1);
    expect(windOffset(64, 4)).toBe(4);
    expect(windOffset(64, 16)).toBe(16);
    expect(windOffset(64, 1)).toBe(1);
    expect(windOffset(63, 1)).toBe(0);
    expect(windOffset(16, -4)).toBe(-1);
    expect(windOffset(1, -4)).toBe(-1);
    expect(windOffset(100, 0)).toBe(0);
    // What is seen moves without the steps.
    expect(windDrift(8, 4)).toBe(0.5);
    expect(windDrift(8, -16)).toBe(-2);

    const scene = factoryProject().scenes[0]!;
    scene.weather[3]![1]![2] = 15;
    scene.wind[3] = 4;
    // After three bars the rain that was painted on the third step is heard on the sixth.
    expect(weatherAt(scene, 3, 1, 2, 0)).toBe(1);
    expect(weatherAt(scene, 3, 1, 2, 48)).toBe(0);
    expect(weatherAt(scene, 3, 1, 5, 48)).toBe(1);
    // It goes round the ring's own length: the tuned drum has twelve steps.
    scene.weather[3]![3]![11] = 15;
    expect(weatherAt(scene, 3, 3, 1, 32)).toBe(1);
    scene.wind[3] = -8;
    expect(weatherAt(scene, 3, 3, 9, 16)).toBe(1);
    // Other kinds of weather stand still meanwhile.
    scene.weather[0]![1]![2] = 15;
    expect(weatherAt(scene, 0, 1, 2, 48)).toBe(1);
  });

  it("names its winds", () => {
    expect(windName(0)).toBe("calm");
    expect(windName(1)).toBe("¼ step a bar ↻");
    expect(windName(-2)).toBe("½ step a bar ↺");
    expect(windName(4)).toBe("1 step a bar ↻");
    expect(windName(-16)).toBe("4 steps a bar ↺");
    expect(WINDS[5]).toBe(0);
    // As many winds one way as the other.
    expect(WINDS.map((wind) => (wind === 0 ? 0 : -wind)).reverse()).toEqual([...WINDS]);
  });

  it("sun and fog pull a sound's own brightness up and down, where it has one", () => {
    expect(brightness([0, 1, 0, 0, 0, 0])).toBe(1);
    expect(brightness([1, 0, 0, 0, 0, 0])).toBe(-1);
    expect(brightness([0.4, 0.4, 1, 1, 1, 1])).toBe(0);
    expect(shaded(0.45, 0)).toBe(0.45);
    expect(shaded(0.45, 1)).toBeGreaterThan(0.9);
    expect(shaded(0.45, 1)).toBeLessThanOrEqual(1);
    expect(shaded(0.45, -1)).toBeLessThan(0.1);
    expect(shaded(0.45, -1)).toBeGreaterThanOrEqual(0);
    expect(shaded(0.45, 0.5)).toBeGreaterThan(0.45);
    expect(shaded(1, 1)).toBe(1);
    expect(shaded(0, -1)).toBe(0);
    expect([0, 1, 2, 3, 4, 5, 6].map(shadesSound)).toEqual([false, false, true, false, true, true, true]);
  });

  it("says in words what the sky is like", () => {
    const scene = factoryProject().scenes[0]!;
    expect(describeWeather(scene)).toBe("clear sky");
    scene.weather[0]![4]![1] = 10;
    scene.weather[3]![1]![12] = 15;
    scene.weather[3]![2]![12] = 15;
    scene.wind[0] = 4;
    expect(describeWeather(scene)).toBe("Fog on Bass, drifting 1 step a bar ↻ · Rain on 2 rings");
    for (let ring = 0; ring < TRACK_COUNT; ring += 1) scene.weather[2]![ring]![0] = 5;
    expect(describeWeather(scene)).toContain("Clouds everywhere");
  });

  it("dice give a sky that is in range, the same for the same throw", () => {
    const lengths = [16, 16, 16, 12, 16, 16, 16];
    for (let seed = 1; seed < 30; seed += 1) {
      const sky = diceWeather(lengths, seeded(seed));
      expect(sky).toEqual(diceWeather(lengths, seeded(seed)));
      expect(sky.weather).toEqual(cleanWeather(sky.weather));
      expect(sky.wind).toEqual(cleanWind(sky.wind));
      expect(sky.weather.flat(2).some((value) => value > 0)).toBe(true);
      // Nothing beyond a ring's last step.
      expect(sky.weather.every((rings) => rings[3]!.slice(12).every((value) => value === 0))).toBe(true);
    }
  });
});

describe("weather in the link", () => {
  it("packs to a few characters and back", () => {
    const weather = emptyWeather();
    expect(packWeather(weather)).toBe("");
    weather[2]![4]![2] = 5;
    weather[2]![4]![3] = 15;
    weather[0]![6]![31] = 1;
    const packed = packWeather(weather);
    expect(packed).toBe(`06${"0".repeat(31)}1,24005f`);
    expect(unpackWeather(packed)).toEqual(weather);
    expect(weatherOn(packed, 4)).toBe("24005f");
    expect(weatherOn(packed, 6)).toBe(`06${"0".repeat(31)}1`);
    expect(weatherOn(packed, 0)).toBe("");
    expect(weatherOn(undefined, 0)).toBe("");
  });

  it("takes whatever a link claims and keeps it where it may be", () => {
    for (const hostile of [null, 7, "", "xx", "99ff", "07ff", "0", "24", "24g", "24" + "f".repeat(33), "24ff".repeat(400), ["24ff"]]) {
      expect(unpackWeather(hostile)).toEqual(emptyWeather());
    }
    // One good entry among bad ones is kept.
    expect(unpackWeather("zz,24f,7700")[2]![4]![0]).toBe(15);
    expect(cleanWind([99, -99, 2.4, "4", Number.NaN, 0])).toEqual([16, -16, 2, 0, 0, 0]);
    expect(cleanWind("sturm")).toEqual(emptyWind());
    const sky = cleanWeather([[[99, -1, 2.6]], "nebel", [null, null, null, null, [1, 2, 3]]]);
    expect(sky).toHaveLength(WEATHER_COUNT);
    expect(sky[0]![0]!.slice(0, 4)).toEqual([WEATHER_MAX, 0, 3, 0]);
    expect(sky[2]![4]!.slice(0, 4)).toEqual([1, 2, 3, 0]);
    expect(sky[1]).toEqual(emptyWeather()[1]);
  });

  it("travels with its scene and its winds, and costs nothing under a clear sky", () => {
    const project = factoryProject();
    expect(serialize(project)).not.toContain('"x"');
    expect(serialize(project)).not.toContain('"d"');
    project.scenes[0]!.weather[1]![5]![0] = 10;
    project.scenes[0]!.wind[1] = -2;
    project.scenes[2] = clone(project.scenes[0]!);
    project.scenes[2].weather[4]![2]![7] = 15;
    project.scenes[2].wind = emptyWind();
    const back = deserialize(serialize(project));
    expect(back.scenes[0]!.weather).toEqual(project.scenes[0]!.weather);
    expect(back.scenes[0]!.wind).toEqual([0, -2, 0, 0, 0, 0]);
    expect(back.scenes[2]!.weather).toEqual(project.scenes[2].weather);
    expect(back.scenes[2]!.wind).toEqual(emptyWind());
    // A link from before the weather.
    const old = JSON.parse(serialize(factoryProject())) as { c: Record<string, unknown>[] };
    delete old.c[0]!.x;
    expect(deserialize(JSON.stringify(old)).scenes[0]!.weather).toEqual(emptyWeather());
    old.c[0]!.d = ["sturm", 400];
    expect(deserialize(JSON.stringify(old)).scenes[0]!.wind).toEqual([0, 16, 0, 0, 0, 0]);
  });

  it("counts in Pass around for the rings it lies on, and the wind for nobody", () => {
    expect(changedRings(state(), state((project) => { project.scenes[0]!.weather[2]![4]![3] = 9; }))).toEqual([4]);
    expect(changedRings(state(), state((project) => {
      project.scenes[0]!.weather[0]![1]![3] = 9;
      project.scenes[0]!.weather[5]![6]![0] = 15;
    }))).toEqual([1, 6]);
    const cloudy = (project: Project): void => { project.scenes[0]!.weather[2]![4]![3] = 9; };
    expect(changedRings(state(cloudy), state((project) => {
      cloudy(project);
      project.scenes[0]!.wind[2] = 8;
    }))).toEqual([]);
    // A copied scene's weather is not new; weather taken away is a change.
    expect(changedRings(state(cloudy), state((project) => {
      cloudy(project);
      project.scenes[3] = clone(project.scenes[0]!);
    }))).toEqual([]);
    expect(changedRings(state(cloudy), state())).toEqual([4]);
  });
});
