import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAPTERS, plain, QUIET, tasksFor } from "../src/app/lessons";
import { deserialize } from "../src/codec";
import { freshProject, patternOf, stepAt, technoProject } from "../src/model";
import { activeSteps } from "../src/patterns";
import { STORAGE_KEY, Store } from "../src/store";

/** What the browser keeps, for a store that saves. */
const kept = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  kept.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const kicks = (store: Store): number[] => activeSteps(patternOf(store.project, 0));

describe("A lesson that borrows the table", () => {
  it("brings its own Kreisel with steps back of its own, and afterwards the visitor's is back as it was, history and all", () => {
    const store = new Store(technoProject());
    store.edit((project) => { stepAt(patternOf(project, 0), 1).on = true; });
    store.edit((project) => { stepAt(patternOf(project, 0), 2).on = true; });
    store.undo();
    const mine = kicks(store);
    expect([store.canUndo, store.canRedo, store.lending]).toEqual([true, true, false]);

    store.lend(freshProject(true, "techno"));
    expect(store.lending).toBe(true);
    expect(kicks(store)).toEqual([]);
    // The lesson's Kreisel has no past: there is nothing of the visitor's to step back into by mistake.
    expect([store.canUndo, store.canRedo]).toEqual([false, false]);
    store.edit((project) => { stepAt(patternOf(project, 0), 0).on = true; });
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);

    store.giveBack();
    expect(store.lending).toBe(false);
    expect(kicks(store)).toEqual(mine);
    expect([store.canUndo, store.canRedo]).toEqual([true, true]);
    expect(store.redo()).toBe(true);
    expect(kicks(store)).toContain(2);
  });

  it("can leave what was made on the table: then the visitor's own Kreisel is one step back", () => {
    const store = new Store(technoProject());
    const mine = kicks(store);
    store.lend(freshProject(true, "techno"));
    for (const step of [0, 4, 8, 12, 14]) store.edit((project) => { stepAt(patternOf(project, 0), step).on = true; });
    store.giveBack(true);
    expect(store.lending).toBe(false);
    expect(kicks(store)).toEqual([0, 4, 8, 12, 14]);
    expect(store.undo()).toBe(true);
    expect(kicks(store)).toEqual(mine);
    // And forward again to what was made.
    expect(store.redo()).toBe(true);
    expect(kicks(store)).toEqual([0, 4, 8, 12, 14]);
  });

  it("keeps the visitor's Kreisel in the browser while the table is lent: a reload brings that one back, not the lesson's", () => {
    const store = new Store(technoProject());
    const mine = kicks(store);
    store.lend(freshProject(true, "techno"));
    store.edit((project) => { stepAt(patternOf(project, 0), 7).on = true; });
    vi.advanceTimersByTime(1000);
    const saved = deserialize(kept.get(STORAGE_KEY) ?? "");
    expect(activeSteps(patternOf(saved, 0))).toEqual(mine);
    store.giveBack(true);
    vi.advanceTimersByTime(1000);
    expect(activeSteps(patternOf(deserialize(kept.get(STORAGE_KEY) ?? ""), 0))).toEqual([7]);
  });

  it("ends when the visitor puts something else on the table: that replaces their own Kreisel, not the lesson's", () => {
    const store = new Store(technoProject());
    const mine = kicks(store);
    store.lend(freshProject(true, "techno"));
    const opened = technoProject();
    stepAt(patternOf(opened, 0), 3).on = true;
    store.replace(opened);
    expect(store.lending).toBe(false);
    expect(kicks(store)).toContain(3);
    // One step back is what the visitor had, not the empty wheel of the lesson.
    store.undo();
    expect(kicks(store)).toEqual(mine);
  });

  it("gives back nothing where nothing was lent, and a second loan ends the first", () => {
    const store = new Store(technoProject());
    const mine = kicks(store);
    store.giveBack();
    expect(kicks(store)).toEqual(mine);
    store.lend(freshProject(true, "techno"));
    store.lend(freshProject(true, "frei"));
    store.giveBack();
    expect(kicks(store)).toEqual(mine);
    expect(store.lending).toBe(false);
  });
});

describe("The lessons", () => {
  const words = (text: string): number => plain(text, (code) => code).split(/\s+/).filter(Boolean).length;

  it("begin with the first steps, and every lesson has a name, a promise and an end of its own", () => {
    expect(CHAPTERS[0]?.id).toBe("first");
    expect(new Set(CHAPTERS.map((chapter) => chapter.id)).size).toBe(CHAPTERS.length);
    expect(new Set(CHAPTERS.map((chapter) => chapter.name)).size).toBe(CHAPTERS.length);
    for (const chapter of CHAPTERS) {
      expect(chapter.promise.length).toBeGreaterThan(10);
      expect(chapter.end.length).toBeGreaterThan(10);
      expect(chapter.tasks.length).toBeGreaterThanOrEqual(2);
      expect(chapter.tasks.length).toBeLessThanOrEqual(5);
    }
    // The core is five tasks: more, and most people never see the end of it.
    expect(CHAPTERS[0]?.tasks).toHaveLength(5);
  });

  it("ask for one thing in one short sentence that names its place, for a mouse and for a finger", () => {
    for (const chapter of CHAPTERS) {
      for (const task of chapter.tasks) {
        const forFinger = task.only === "mouse" ? [] : [task.touch ?? task.line];
        for (const line of [task.line, ...forFinger]) {
          // The place is named in words and is a button: exactly one pair of brackets.
          expect(line.match(/\[[^\]]+\]/g), line).toHaveLength(1);
          expect(words(line), line).toBeLessThanOrEqual(20);
          // It begins with what to do.
          expect(line, line).toMatch(/^[A-Z][a-z-]+ /);
        }
        // A finger is never asked to click, to right-click or to press a key.
        for (const line of forFinger) expect(line, task.line).not.toMatch(/\b[Cc]lick|\{key:/);
        expect(task.shown.length, task.line).toBeGreaterThan(5);
        if (task.after) expect(words(task.after), task.after).toBeLessThanOrEqual(18);
        // Every key that is named is a place on the keyboard the page knows.
        for (const [, code] of `${task.line} ${task.keys ?? ""}`.matchAll(/\{key:(\w+)\}/g)) expect(code, task.line).toMatch(/^(Key[A-Z]|Digit\d|IntlBackslash)$/);
      }
    }
  });

  it("leave out what a finger cannot do, and say every sentence plainly to whoever does not see it", () => {
    const live = CHAPTERS.find((chapter) => chapter.id === "live");
    expect(live).toBeDefined();
    expect(tasksFor(live!, false)).toHaveLength(live!.tasks.length);
    expect(tasksFor(live!, true).length).toBe(live!.tasks.length - 1);
    expect(tasksFor(live!, true).some((task) => task.only === "mouse")).toBe(false);
    // Only tasks that need a mouse are marked so, and each of those has no words for a finger.
    for (const chapter of CHAPTERS) for (const task of chapter.tasks) if (task.only === "mouse") expect(task.touch).toBeUndefined();
    expect(plain("Press [the arrow ›] or {key:KeyU}, then {key:Digit1}.", (code) => code.replace(/^Key|^Digit/, ""))).toBe("Press the arrow › or U, then 1.");
  });

  it("borrows the table wherever a lesson would change the Kreisel more than was asked for: an empty wheel to build a beat, a copy for sounds, scenes and sampling", () => {
    const lending = CHAPTERS.filter((chapter) => chapter.lends !== undefined);
    expect(lending.map((chapter) => chapter.id)).toEqual(["beat", "sounds", "scenes", "sample"]);
    const empty = freshProject(true, "techno");
    expect(empty.style).toBe("techno");
    expect(empty.scenes[0]?.patterns.every((pattern) => activeSteps(pattern).length === 0)).toBe(true);
    expect(freshProject(false, "techno").scenes[0]?.patterns.some((pattern) => activeSteps(pattern).length > 0)).toBe(true);
  });

  it("says what is in a task's way in a sentence of its own: nothing plays, or the hand went somewhere else", () => {
    expect(QUIET.mouse).toMatch(/^Nothing plays yet/);
    expect(QUIET.touch).not.toMatch(/click|space bar/);
    // The tasks that are about something heard say so; the first one (which asks for play itself) does not.
    const first = CHAPTERS[0]!;
    expect(first.tasks[0]?.quiet).toBeUndefined();
    expect(first.tasks.filter((task) => task.quiet).length).toBeGreaterThanOrEqual(2);
    expect(first.tasks[2]?.miss).toBeTypeOf("function");
    // What is said after a task is the same for every hand: it names no click and no key.
    for (const chapter of CHAPTERS) for (const task of chapter.tasks) expect(task.after ?? "", task.line).not.toMatch(/\b[Cc]lick|\b[Tt]ap\b|right|Shift|\{key:/);
  });
});
