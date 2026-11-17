import { beforeEach, describe, expect, it, vi } from "vitest";
import { factoryProject, patternOf, stepAt } from "../src/model";
import { Store } from "../src/store";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  });
  vi.useFakeTimers();
});

const kick = (store: Store, step: number): boolean => stepAt(patternOf(store.project, 0), step).on;

describe("store", () => {
  it("undoes and redoes edits", () => {
    const store = new Store();
    expect(store.canUndo).toBe(false);
    store.edit((project) => { stepAt(patternOf(project, 0), 1).on = true; });
    store.edit((project) => { stepAt(patternOf(project, 0), 2).on = true; });
    expect(store.undo()).toBe(true);
    expect([kick(store, 1), kick(store, 2)]).toEqual([true, false]);
    expect(store.undo()).toBe(true);
    expect(kick(store, 1)).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect([kick(store, 1), kick(store, 2)]).toEqual([true, true]);
    expect(store.canRedo).toBe(false);
  });

  it("takes back a gesture that is still going on, and only that", () => {
    const store = new Store();
    const set = (step: number, key?: string): void => store.edit((project) => { stepAt(patternOf(project, 0), step).on = true; }, key, Infinity);
    set(1);
    set(2, "zug7");
    store.cancel("zug7");
    expect([kick(store, 1), kick(store, 2)]).toEqual([true, false]);
    expect(store.canRedo).toBe(false);
    // A gesture that is over, or an older one, stays.
    set(3, "zug8");
    store.settle();
    store.cancel("zug8");
    store.cancel("zug7");
    expect(kick(store, 3)).toBe(true);
    // Nothing is taken back while looking at an old turn.
    set(5, "zug9");
    store.locked = true;
    store.cancel("zug9");
    store.locked = false;
    expect(kick(store, 5)).toBe(true);
    store.undo();
    store.undo();
    expect(store.undo()).toBe(true);
    expect([1, 3, 5].map((step) => kick(store, step))).toEqual([false, false, false]);
    expect(store.canUndo).toBe(false);
  });

  it("counts a gesture as one step back, until it is settled", () => {
    const store = new Store();
    for (const step of [1, 2, 3]) store.edit((project) => { stepAt(patternOf(project, 0), step).on = true; }, "zug1", Infinity);
    store.settle();
    store.edit((project) => { stepAt(patternOf(project, 0), 5).on = true; }, "zug1", Infinity);
    store.undo();
    expect([kick(store, 3), kick(store, 5)]).toEqual([true, false]);
    store.undo();
    expect([1, 2, 3].map((step) => kick(store, step))).toEqual([false, false, false]);
  });

  it("splits slow slider moves into separate steps", () => {
    const store = new Store();
    store.edit((project) => { project.bpm = 100; }, "bpm");
    vi.advanceTimersByTime(300);
    store.edit((project) => { project.bpm = 101; }, "bpm");
    vi.advanceTimersByTime(2000);
    store.edit((project) => { project.bpm = 130; }, "bpm");
    store.undo();
    expect(store.project.bpm).toBe(101);
    store.undo();
    expect(store.project.bpm).toBe(factoryProject().bpm);
  });

  it("a new edit forgets what could be redone", () => {
    const store = new Store();
    store.edit((project) => { project.bpm = 90; });
    store.undo();
    store.edit((project) => { project.bpm = 140; });
    expect(store.canRedo).toBe(false);
  });

  it("saves a little after the last change and loads it again", () => {
    const store = new Store();
    store.edit((project) => { project.bpm = 77; });
    expect(memory.size).toBe(0);
    vi.advanceTimersByTime(500);
    expect(new Store().project.bpm).toBe(77);
  });

  it("starts with the factory project when the storage holds rubbish", () => {
    memory.set("kreisel.projekt.v1", "{nope");
    expect(new Store().project).toEqual(factoryProject());
  });

  it("brings the old project back after a replaced one", () => {
    const store = new Store();
    store.edit((project) => { project.bpm = 99; });
    const other = factoryProject();
    other.bpm = 150;
    store.replace(other);
    expect(store.project.bpm).toBe(150);
    store.undo();
    expect(store.project.bpm).toBe(99);
  });
});
