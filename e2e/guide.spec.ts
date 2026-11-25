import { expect, test, type Page } from "@playwright/test";
import { CHAPTERS, plain, QUIET, tasksFor, type Chapter } from "../src/app/lessons";
import { STORAGE_KEY } from "../src/store";
import { copyLink, firstLook, focus, fromBar, onLaptop, onPhone, open, state, status, where } from "./helpers";

/*
 * The guide: a card under the wheel that asks for one small task at a time,
 * on the page itself, and notices when it was done, by whatever hand. On a
 * first visit the first steps lie ready; six more lessons wait under the
 * question mark.
 *
 * Nothing is dimmed, nothing takes the keyboard and nothing sounds by itself:
 * that is looked at here as much as the tasks are. Whether a task was done is
 * read from the guide itself (window.kreisel.app.guide), what the card says
 * from the card: a task that was done stays for as long as it takes to read
 * what the card says then and goes on by itself, so the tests wait for what
 * happens and not for a time.
 *
 * What a task says is the lessons' own business (src/app/lessons.ts): the
 * tests take the sentences from there and look at what the card makes of
 * them, and at what each task does.
 */

declare global {
  interface Window {
    /** What the guide's announcer was given since the page came, an entry a write (see `listen`). */
    guideSaid: string[];
  }
}

/** Kept in the browser: "1" once the first steps were put away or done, and which lessons were finished and where one was left. */
const SEEN = "kreisel.hinweis";
const KEPT = "kreisel.lektionen";

const FIRST = CHAPTERS[0]!;
const lessonOf = (id: string): Chapter => CHAPTERS.find((one) => one.id === id)!;
/** The other lessons, in the order they are offered. */
const others = (id: string): string[] => CHAPTERS.filter((one) => one.id !== id).map((one) => one.id);
/** A task's sentence as the card shows it: the brackets around the place's name are gone. */
const shown = (line: string): string => line.replace(/\[([^\]]+)\]/g, "$1");
/** The place a task's sentence names. */
const placeIn = (line: string): string | null => /\[([^\]]+)\]/.exec(line)?.[1] ?? null;

/** Where the page says the guide waits, on a laptop and on a phone; and that the visitor's own Kreisel is on the table again. */
const WAITS = /The guide waits under the question mark/;
const WAITS_ON_A_PHONE = /The guide waits in the menu behind the three dots/;
const OWN_IS_BACK = /^Your own Kreisel is back\b/;

/** What the card says on a task, in the words of one hand. */
interface Words {
  text: string;
  place: string | null;
  keys: string;
  after: string;
  /** The task is about something that is heard: while nothing plays, the card says so above its line about the keys. */
  quiet: boolean;
}

/** What the card says on each task of a lesson, for a mouse or for a finger, with every key by the name this keyboard gives it. */
async function wordsOf(page: Page, lesson: Chapter, touch = false): Promise<Words[]> {
  const tasks = tasksFor(lesson, touch);
  const codes = [...new Set(tasks.flatMap((task) => [...(task.keys ?? "").matchAll(/\{key:(\w+)\}/g)].map((found) => found[1]!)))];
  const names = new Map(await page.evaluate((all) => all.map((code) => [code, window.kreisel.app.guide.keyName(code)] as const), codes));
  return tasks.map((task) => {
    const line = (touch ? task.touch : undefined) ?? task.line;
    return { text: shown(line), place: placeIn(line), keys: touch ? "" : plain(task.keys ?? "", (code) => names.get(code) ?? code), after: task.after ?? "", quiet: task.quiet === true };
  });
}

interface Card {
  title: string;
  count: string;
  text: string;
  /** The place the sentence names: the button in it. */
  place: string | null;
  keys: string;
  /** What the card adds while something is in the task's way: nothing plays, or a near miss. */
  hint: string;
  /** What the button that goes on reads. */
  goOn: string;
}

/** What the card reads on a task that is still to do; with `quiet`, while the task is about sound and nothing plays. */
const asking = (lesson: Chapter, words: readonly Words[], index: number, quiet: string | null = null): Card => ({
  title: lesson.name,
  count: `Step ${index + 1} of ${words.length}`,
  text: words[index]!.text,
  place: words[index]!.place,
  keys: words[index]!.keys,
  hint: quiet ?? "",
  goOn: "Skip",
});
/** What it reads once that task was done. */
const praising = (lesson: Chapter, words: readonly Words[], index: number): Card => ({
  title: lesson.name,
  count: "Done",
  text: words[index]!.after,
  place: null,
  keys: "",
  hint: "",
  goOn: index === words.length - 1 ? "Finish" : "Next",
});

/**
 * Waits until the card is on a task of a lesson (still to do, or noticed as done) and says what it reads then. A task
 * that was done stays for a moment only: what the card says is read in the same look that finds it.
 */
async function cardAt(page: Page, lesson: string, index: number, done: boolean, timeout = 15_000): Promise<Card> {
  const seen = await page.waitForFunction(([id, at, ticked]) => {
    const guide = window.kreisel.app.guide;
    const node = document.getElementById("tour");
    if (!node || node.hidden || guide.view !== "task" || guide.chapter?.id !== id || guide.index !== at || guide.done !== ticked) return null;
    const read = (part: string): string => document.getElementById(part)?.textContent ?? "";
    const count = read("tour-count");
    if (count !== (ticked ? "Done" : `Step ${at + 1} of ${guide.tasks.length}`) || node.classList.contains("done") !== ticked) return null;
    const hint = document.getElementById("tour-hint");
    return {
      title: read("tour-title"),
      count,
      text: read("tour-text"),
      place: document.querySelector("#tour-text .guide-goto")?.textContent ?? null,
      keys: read("tour-keys"),
      hint: hint && !hint.hidden ? (hint.textContent ?? "") : "",
      goOn: read("tour-next"),
    };
  }, [lesson, index, done] as const, { timeout });
  return (await seen.jsonValue()) as Card;
}

/** The card asks for this task of this lesson. */
const onTask = (page: Page, lesson: string, index: number): Promise<Card> => cardAt(page, lesson, index, false);
/** The card has noticed that this task was done. */
const ticked = (page: Page, lesson: string, index: number, timeout?: number): Promise<Card> => cardAt(page, lesson, index, true, timeout);

/** Waits until the guide is on this task of this lesson, and says whether the task was done already as it came (then it is passed after a moment). */
async function reached(page: Page, lesson: string, index: number): Promise<boolean> {
  const seen = await page.waitForFunction(([id, at]) => {
    const guide = window.kreisel.app.guide;
    return guide.view === "task" && guide.chapter?.id === id && guide.index === at ? { done: guide.done } : null;
  }, [lesson, index] as const, { timeout: 15_000 });
  return ((await seen.jsonValue()) as { done: boolean }).done;
}

interface End {
  title: string;
  count: string;
  text: string;
  /** The lessons the card offers to go on with, and the one it recommends. */
  offers: string[];
  recommended: string | null;
  /** What it says under its sentence. */
  under: string;
  /** Whether it has a tick. */
  praised: boolean;
}

/** Waits for the end of a lesson and says what the card reads there, and which lessons it offers. */
async function ended(page: Page, lesson: string): Promise<End> {
  const seen = await page.waitForFunction((id) => {
    const guide = window.kreisel.app.guide;
    const node = document.getElementById("tour");
    const read = (part: string): string => document.getElementById(part)?.textContent ?? "";
    if (!node || node.hidden || guide.view !== "end" || guide.chapter?.id !== id || read("tour-text") === "" || read("tour-text") !== guide.ending) return null;
    return {
      title: read("tour-title"),
      count: read("tour-count"),
      text: read("tour-text"),
      offers: [...document.querySelectorAll<HTMLElement>("#tour-list .chip")].map((chip) => chip.dataset.lesson ?? ""),
      recommended: document.querySelector<HTMLElement>("#tour-list .chip.primary")?.dataset.lesson ?? null,
      under: read("tour-keys"),
      praised: node.classList.contains("done"),
    };
  }, lesson, { timeout: 15_000 });
  return (await seen.jsonValue()) as End;
}

/** What the guide shows, as the app has it. */
const guideOf = (page: Page) =>
  page.evaluate(() => {
    const guide = window.kreisel.app.guide;
    return { view: guide.view, lesson: guide.chapter?.id ?? null, index: guide.index, done: guide.done, tasks: guide.tasks.length, finished: [...guide.finished], left: guide.left, mark: guide.mark };
  });

/**
 * What the browser keeps about the guide: whether it was seen, the lessons that were finished, and the one that was
 * left (its id, the task it was on, and how many of its tasks were done by then).
 */
const keptOf = (page: Page): Promise<{ seen: string | null; lessons: { done: string[]; at: [string, number, number] | null } | null }> =>
  page.evaluate(([seen, kept]) => ({ seen: localStorage.getItem(seen), lessons: JSON.parse(localStorage.getItem(kept) ?? "null") as { done: string[]; at: [string, number, number] | null } | null }), [SEEN, KEPT] as const);

/** Whether nothing has the keyboard: the focus is on the page itself. */
const nobodyHasTheKeyboard = (page: Page): Promise<boolean> => page.evaluate(() => document.activeElement === document.body);
/** Whether the keyboard is on the card. */
const keyboardOnCard = (page: Page): Promise<boolean> => page.evaluate(() => document.activeElement?.closest("#tour") != null);

/** Which steps of a ring have a hit, in the scene on the table. */
const hitsOf = (page: Page, ring: number): Promise<number[]> =>
  page.evaluate((index) => {
    const project = window.kreisel.app.project;
    const pattern = project.scenes[project.scene]!.patterns[index]!;
    return pattern.steps.slice(0, pattern.len).flatMap((step, at) => (step.on ? [at] : []));
  }, ring);
/** How many hits lie on the wheel, on all seven rings. */
const allHits = async (page: Page): Promise<number> => (await Promise.all([0, 1, 2, 3, 4, 5, 6].map((ring) => hitsOf(page, ring)))).flat().length;
const soundsOf = (page: Page): Promise<number[]> => page.evaluate(() => window.kreisel.app.project.tracks.map((track) => track.sound));
const audible = (page: Page, ring: number): Promise<boolean> => page.evaluate((index) => window.kreisel.app.audible(index), ring);
const playing = (page: Page): Promise<boolean> => page.evaluate(() => window.kreisel.app.playing);
const lending = (page: Page): Promise<boolean> => page.evaluate(() => window.kreisel.app.store.lending);
/** What the page said last, in its message under the wheel. */
const toastOf = (page: Page): Promise<string> => page.evaluate(() => window.kreisel.app.toast?.text ?? "");
const dismiss = (page: Page): Promise<void> => page.evaluate(() => window.kreisel.app.dismiss());

/** A button of a ring's row in the list: its speaker, its dice, its name. */
const inRow = (page: Page, ring: number, part: "mute" | "roll" | "pick") => page.locator(`#tracks .track[data-track="${ring}"] .${part}`);
const pad = (page: Page, effect: string) => page.locator(`#fx [data-fx="${effect}"]`);
const chip = (page: Page, lesson: string) => page.locator(`#tour-list .chip[data-lesson="${lesson}"]`);
/** The button of the card that goes on: "Skip" while the task is to do, "Next" (or "Finish") once it was done. */
const goOn = (page: Page) => page.locator("#tour-next");
/** The line the card adds while something is in a task's way. */
const hint = (page: Page) => page.locator("#tour-hint");

/** Presses the play button in the wheel's middle. */
async function pressHub(page: Page): Promise<void> {
  const wheel = (await page.locator("#kreisel").boundingBox())!;
  await page.mouse.click(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2);
}

/** Starts the Kreisel with the play button in the wheel's middle, unless it plays already. */
async function letItPlay(page: Page): Promise<void> {
  if (!(await playing(page))) await pressHub(page);
  await expect.poll(() => playing(page)).toBe(true);
}

/** Clicks steps of a ring on the wheel, one after the other. */
async function clickSteps(page: Page, ring: number, steps: readonly number[]): Promise<void> {
  await focus(page, ring);
  for (const step of steps) {
    const spot = await where(page, ring, step);
    await page.mouse.click(spot.x, spot.y);
  }
}

/** Holds one of the effects beside the wheel with the mouse for a while, and lets go. */
async function holdPad(page: Page, effect: string, ms = 800): Promise<void> {
  await pad(page, effect).hover();
  await page.mouse.down();
  await expect(pad(page, effect)).toHaveClass(/held/);
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await expect(pad(page, effect)).not.toHaveClass(/held/);
}

/** Opens the list of lessons from the question mark (on a phone: from the three dots). */
async function openList(page: Page, phone = false): Promise<void> {
  await fromBar(page, phone ? "more" : "help-open", /Guide/);
  await expect(page.locator("#tour")).toBeVisible();
  await expect(page.locator("#tour-title")).toHaveText("Lessons");
}

/** Starts a lesson as someone who has been here before: from the question mark, by its chip in the list. */
async function startLesson(page: Page, lesson: string): Promise<void> {
  await openList(page);
  await chip(page, lesson).click();
}

/** Nothing went wrong on the page, and nothing was blocked. */
async function clean(page: Page, problems: string[]): Promise<void> {
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(problems).toEqual([]);
}

/**
 * Writes down what the guide's announcer is given, an entry a write, from the moment the page is there (to be called
 * before the page is opened).
 */
async function listen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.guideSaid = [];
    document.addEventListener("DOMContentLoaded", () => {
      const announcer = document.getElementById("tour-said");
      if (!announcer) return;
      new MutationObserver((records) => {
        for (const record of records) if (record.type === "characterData" || record.addedNodes.length > 0) window.guideSaid.push(announcer.textContent ?? "");
      }).observe(announcer, { childList: true, characterData: true, subtree: true });
    });
  });
}
const saidSoFar = (page: Page): Promise<string[]> => page.evaluate(() => window.guideSaid);

/**
 * What is in the way on a laptop while the card is up: nothing, if the card lies under the wheel in the window, off
 * the wheel, off the status line and off the place its task names, the ring's panel still fits, and that place is
 * marked (a part of the page by a ring around it, a part of the wheel by the wheel itself).
 */
const inTheWay = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const wrong: string[] = [];
    const boxOf = (node: Element | null): DOMRect | null => (node && node.getClientRects().length > 0 ? node.getBoundingClientRect() : null);
    const apart = (one: DOMRect, other: DOMRect): boolean => one.right <= other.left + 0.5 || other.right <= one.left + 0.5 || one.bottom <= other.top + 0.5 || other.bottom <= one.top + 0.5;
    const inWindow = (box: DOMRect): boolean => box.left >= -0.5 && box.top >= -0.5 && box.right <= window.innerWidth + 0.5 && box.bottom <= window.innerHeight + 0.5;
    const reach = (box: DOMRect): string => `it reaches from ${Math.round(box.top)} to ${Math.round(box.bottom)}`;
    const card = boxOf(document.getElementById("tour"));
    if (!card) return ["the card is not there"];
    if (document.documentElement.dataset.guide !== "docked") wrong.push("the card does not lie under the wheel");
    if (!inWindow(card)) wrong.push(`the card is not wholly in the window (${reach(card)}, the window is ${window.innerHeight} tall)`);
    const wheel = boxOf(document.getElementById("kreisel"));
    if (!wheel || !apart(card, wheel)) wrong.push(`the card lies on the wheel (${wheel ? reach(wheel) : "which is not there"}, the card: ${reach(card)})`);
    const line = boxOf(document.getElementById("status"));
    if (!line || !inWindow(line) || !apart(card, line)) wrong.push(`the status line is not in view (${line ? reach(line) : "it is not there"}, the card: ${reach(card)})`);
    const panel = document.getElementById("panel");
    if (panel && panel.getClientRects().length > 0 && panel.scrollHeight - panel.clientHeight > 2) wrong.push(`the ring's panel is ${panel.scrollHeight - panel.clientHeight} px too tall`);
    const mark = window.kreisel.app.guide.mark;
    const ring = boxOf(document.getElementById("tour-mark"));
    if (mark?.kind === "node") {
      const target = boxOf(document.querySelector(mark.selector));
      if (!target) return [...wrong, `the place the task names (${mark.selector}) is not on the page`];
      if (!inWindow(target)) wrong.push("the place the task names is not wholly in the window");
      if (!apart(card, target)) wrong.push(`the card lies on the place its task names (${reach(target)}, the card: ${reach(card)})`);
      if (!ring) wrong.push("the place the task names is not marked");
      else if (ring.left > target.left || ring.top > target.top || ring.right < target.right || ring.bottom < target.bottom || ring.width > target.width + 14 || ring.height > target.height + 14) wrong.push("the mark does not lie around the place the task names");
    } else if (ring) {
      wrong.push("a part of the page is marked although the task is on the wheel");
    }
    return wrong;
  });

/**
 * The same for a phone, where the card is a sheet along the foot of the window: the place its task names is in view
 * above it, the sheet is wholly in the window, and nothing is wider than the window.
 */
const inTheWayOfAFinger = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const wrong: string[] = [];
    const boxOf = (node: Element | null): DOMRect | null => (node && node.getClientRects().length > 0 ? node.getBoundingClientRect() : null);
    const card = boxOf(document.getElementById("tour"));
    if (!card) return ["the card is not there"];
    if (document.documentElement.dataset.guide !== "sheet") wrong.push("the card is not a sheet along the foot of the window");
    if (card.left < -0.5 || card.top < -0.5 || card.right > window.innerWidth + 0.5 || card.bottom > window.innerHeight + 0.5) wrong.push("the sheet is not wholly in the window");
    if (card.top < window.innerHeight * 0.5) wrong.push(`the sheet takes more than half of the window (it begins at ${Math.round(card.top)} of ${window.innerHeight})`);
    if (document.scrollingElement!.scrollWidth > window.innerWidth) wrong.push("the page is wider than the window");
    const mark = window.kreisel.app.guide.mark;
    const target = boxOf(mark?.kind === "node" ? document.querySelector(mark.selector) : mark ? document.getElementById("kreisel") : null);
    if (!target) return [...wrong, "the place the task names is not on the page"];
    // A part of the page is in view above the sheet; of the wheel (which may be taller than the room there), its
    // middle is, where the play button is.
    const middle = (target.top + target.bottom) / 2;
    const inView = mark?.kind === "node" ? target.top >= -0.5 && target.bottom <= card.top + 0.5 : middle >= 0 && middle <= card.top && target.top < card.top - 80;
    if (!inView) wrong.push(`the place the task names is not in view above the sheet (it reaches from ${Math.round(target.top)} to ${Math.round(target.bottom)}, the sheet begins at ${Math.round(card.top)})`);
    if (mark?.kind === "node") {
      const ring = boxOf(document.getElementById("tour-mark"));
      if (!ring) wrong.push("the place the task names is not marked");
      else if (ring.left > target.left || ring.top > target.top || ring.right < target.right || ring.bottom < target.bottom || ring.width > target.width + 14 || ring.height > target.height + 14) wrong.push("the mark does not lie around the place the task names");
    }
    return wrong;
  });

/** Waits until the page has come to rest after the guide brought a place into view. */
async function atRest(page: Page): Promise<void> {
  await expect.poll(async () => {
    const first = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(150);
    return Math.abs((await page.evaluate(() => window.scrollY)) - first);
  }).toBeLessThan(0.5);
}

/** The buttons of the card that can be seen, and what is wrong with each: outside the window, or under something else. */
const outOfReach = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#tour button")].filter((button) => button.getClientRects().length > 0).flatMap((button) => {
      const box = button.getBoundingClientRect();
      const name = button.id || button.dataset.lesson || button.textContent || "a button";
      if (box.left < -0.5 || box.top < -0.5 || box.right > window.innerWidth + 0.5 || box.bottom > window.innerHeight + 0.5) return [`${name} is not wholly in the window (it reaches from ${Math.round(box.left)} to ${Math.round(box.right)} across and from ${Math.round(box.top)} to ${Math.round(box.bottom)} down; the window is ${window.innerWidth} by ${window.innerHeight})`];
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top && button.contains(top) ? [] : [`${name} lies under something else`];
    }));

/**
 * How a hand does a task on a laptop, with the mouse: by the place the guide marks for it. A part of the page is
 * found by what the mark lies around; the wheel's middle and the rings of the wheel are done by `byHand` itself.
 */
type Hand = (page: Page, place: string) => Promise<void>;
const AT: readonly (readonly [place: RegExp, hand: Hand])[] = [
  // A ring's speaker in the list: out, and back.
  [/^#tracks \.track\[data-track="\d"\] \.mute$/, async (page, place) => {
    await page.locator(place).click();
    await page.locator(place).click();
  }],
  // A ring's dice in the list.
  [/^#tracks \.track\[data-track="\d"\] \.roll$/, (page, place) => page.locator(place).click()],
  [/^\.sound-row$/, (page) => page.locator(".sound-row").getByRole("button", { name: "Next sound" }).click()],
  // An effect that is held for a moment.
  [/^#fx \[data-fx="(stotter|dumpf)"\]$/, (page, place) => holdPad(page, /"(\w+)"/.exec(place)![1]!)],
  [/^#fx \[data-fx="aufbau"\]$/, async (page) => {
    const task = await guideOf(page);
    // Let go too soon, it does not count: the card says so, and the task waits for a longer hold.
    await holdPad(page, "aufbau", 500);
    await expect(hint(page)).toHaveText(/a little longer/);
    expect(await guideOf(page)).toMatchObject({ lesson: task.lesson, index: task.index, done: false });
    await holdPad(page, "aufbau", 2300);
  }],
  // The right button makes an effect stay, a click lets it go.
  [/^#fx \[data-fx="wurf"\]$/, async (page) => {
    await pad(page, "wurf").click({ button: "right" });
    await expect(pad(page, "wurf")).toHaveAttribute("aria-pressed", "true");
    await pad(page, "wurf").click();
    await expect(pad(page, "wurf")).toHaveAttribute("aria-pressed", "false");
  }],
  [/^#dice-all$/, async (page) => {
    await page.locator("#dice-all").click();
    // The task has two halves: once the dice were rolled, the mark goes to "Undo".
    await expect.poll(async () => (await guideOf(page)).mark).toEqual({ kind: "node", selector: "#undo" });
    await expect.poll(() => inTheWay(page)).toEqual([]);
    await page.locator("#undo").click();
  }],
  [/^#sound-pick$/, (page) => page.locator("#sound-pick").click()],
  [/^#palette$/, (page) => page.locator('#palette .palette-row .chip[aria-pressed="false"]:visible').nth(13).click()],
  [/^#panel \.pad$/, async (page) => {
    // The point is dragged well away from where it stands.
    const box = (await page.locator("#panel .pad").boundingBox())!;
    const point = await page.evaluate(() => window.kreisel.app.project.tracks[window.kreisel.app.selected]!);
    const to = { x: point.x > 0.5 ? 0.2 : 0.8, y: point.y > 0.5 ? 0.25 : 0.75 };
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to.x, box.y + box.height * (1 - to.y), { steps: 6 });
    await page.mouse.up();
  }],
  [/^#voice-edit$/, async (page) => {
    await page.locator("#voice-edit").click();
    await expect(page.locator("#booth")).toBeVisible();
    await page.locator("#voice-text").fill("Oh ja");
    await page.locator("#booth-done").click();
  }],
  [/^#scenes \.scene:not\(\.filled\)$/, (page) => page.locator("#scenes .scene:not(.filled)").first().click()],
  [/^#plays \[data-plays="row"\]$/, (page) => page.locator('#plays [data-plays="row"]').click()],
  [/^#sample-open$/, (page) => page.locator("#sample-open").click()],
  [/^#sample-press-ring$/, (page) => page.locator("#sample-press-ring").click()],
  [/^#sample-turn$/, (page) => page.locator("#sample-turn").fill("3")],
  [/^#sample-back$/, (page) => page.locator("#sample-back").click()],
  [/^#share$/, (page) => copyLink(page)],
  [/^#stage-toggle$/, (page) => page.locator("#stage-toggle").click()],
];

/** Does the task that is up by hand, as the place the guide marks asks for it. */
async function byHand(page: Page): Promise<void> {
  const { mark } = await guideOf(page);
  if (!mark) throw new Error("No task is up, or the one that is up names no place.");
  // The play button in the wheel's middle.
  if (mark.kind === "hub") return letItPlay(page);
  if (mark.kind === "ring") {
    // The marked steps of a ring, or (where none are marked) three free ones.
    if (mark.steps) return clickSteps(page, mark.track, mark.steps);
    const taken = await hitsOf(page, mark.track);
    return clickSteps(page, mark.track, [2, 6, 11, 14, 9, 4].filter((step) => !taken.includes(step)).slice(0, 3));
  }
  const hand = AT.find(([place]) => place.test(mark.selector))?.[1];
  if (!hand) throw new Error(`The tests have no hand for a task at ${mark.selector}.`);
  return hand(page, mark.selector);
}

/**
 * Walks a lesson on a laptop from its first task to its end, doing every task by hand. On each task the card says its
 * sentence and its keys, the sentence names a place, that place is marked and the card is not in the way; a task that
 * is about sound says so while nothing plays, and the walk starts the Kreisel then, as the card asks. Once the task
 * was done the card says so; then "Next" goes on at once (how the next task comes by itself is looked at in the first
 * steps).
 */
async function walk(page: Page, lesson: Chapter): Promise<void> {
  const words = await wordsOf(page, lesson);
  for (const index of words.keys()) {
    const what = `${lesson.name}, step ${index + 1}`;
    const quiet = words[index]!.quiet && !(await playing(page));
    expect(await onTask(page, lesson.id, index), what).toEqual(asking(lesson, words, index, quiet ? QUIET.mouse : null));
    if (quiet) {
      // Nothing plays yet, the card says above its line about the keys: with the Kreisel started, that word is gone.
      await letItPlay(page);
      await expect(hint(page), what).toBeHidden();
      expect(await onTask(page, lesson.id, index), what).toEqual(asking(lesson, words, index));
    }
    expect(words[index]!.place, what).not.toBeNull();
    // The place is marked, and the card is not in the way of it.
    expect((await guideOf(page)).mark, what).not.toBeNull();
    await expect.poll(() => inTheWay(page), { message: what }).toEqual([]);
    await byHand(page);
    expect(await ticked(page, lesson.id, index, 30_000), what).toEqual(praising(lesson, words, index));
    // What was done is not marked any more.
    await expect(page.locator("#tour-mark"), what).toBeHidden();
    await goOn(page).click();
  }
}

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test.describe("a first visit", () => {
    test("finds the first steps under the wheel: nothing is dimmed, nothing takes the keyboard, nothing sounds", async ({ page }) => {
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      expect(words).toHaveLength(5);
      expect(await onTask(page, "first", 0)).toEqual(asking(FIRST, words, 0));
      await expect(page.locator("#tour")).toBeVisible();
      // It came by itself: nothing has the keyboard, and nothing sounds.
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      expect(await page.evaluate(() => [window.kreisel.app.playing, window.kreisel.level()])).toEqual([false, 0]);
      // The play button in the wheel's middle is marked by the wheel itself; the card lies under the wheel, off it and off the status line.
      expect((await guideOf(page)).mark).toEqual({ kind: "hub" });
      await expect(page.locator("html")).toHaveAttribute("data-guide", "docked");
      await expect.poll(() => inTheWay(page)).toEqual([]);
      expect(await page.evaluate(() => document.getElementById("tour")!.getBoundingClientRect().top >= document.getElementById("kreisel")!.getBoundingClientRect().bottom - 0.5)).toBe(true);
      await expect(status(page)).toBeInViewport();

      // Nothing lies over the page: every control is the topmost thing where it stands.
      expect(await page.evaluate(() =>
        ["#kreisel", "#play", "#bpm", "#help-open", "#tracks .track[data-track='0'] .mute", "#tracks .track[data-track='6'] .pick", "#dice-all", "#scenes .scene", "#sound-pick", "#fx [data-fx='stotter']", "#stage-toggle", "#tools .tool"].filter((selector) => {
          const node = document.querySelector(selector);
          if (!node) return true;
          const box = node.getBoundingClientRect();
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return !(top && node.contains(top));
        }))).toEqual([]);
      // The wheel takes a hit, and the controls around it answer.
      const free = await where(page, 6, 1);
      await page.mouse.click(free.x, free.y);
      await expect(status(page)).toContainText("Melody: 1 hit on 2 of 16");
      await inRow(page, 4, "pick").click();
      await expect(status(page)).toContainText("Bass: 11 hits");
      await page.locator("#undo").click();
      expect(await hitsOf(page, 6)).toEqual([]);
      // The card waits on its first task through all of that, and the keyboard is not on it.
      expect(await guideOf(page)).toMatchObject({ view: "task", lesson: "first", index: 0, done: false, tasks: 5, finished: [] });
      expect(await keyboardOnCard(page)).toBe(false);
      // Nobody has put it away: it is not kept as seen.
      expect((await keptOf(page)).seen).toBeNull();
      await clean(page, problems);
    });

    test("stays away on the next visit once it was closed, and has said where it waits", async ({ page }) => {
      const problems = await firstLook(page);
      const tour = page.locator("#tour");
      await onTask(page, "first", 0);
      await page.locator("#tour-skip").click();
      await expect(tour).toBeHidden();
      await expect(page.locator("#tour-mark")).toBeHidden();
      await expect(page.locator("html")).not.toHaveAttribute("data-guide");
      expect(await toastOf(page)).toMatch(WAITS);
      await expect(page.locator("#toast")).toContainText(WAITS);
      expect((await keptOf(page)).seen).toBe("1");

      await page.reload();
      await expect(status(page)).toContainText("Melody");
      await page.waitForTimeout(1500);
      await expect(tour).toBeHidden();
      expect((await guideOf(page)).view).toBe("off");
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await clean(page, problems);
    });

    test("is back at the task it was on after a reload in the middle", async ({ page }) => {
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      await onTask(page, "first", 0);
      await goOn(page).click();
      await onTask(page, "first", 1);
      await goOn(page).click();
      await onTask(page, "first", 2);
      expect(await keptOf(page)).toEqual({ seen: null, lessons: { done: [], at: ["first", 2, 0] } });

      await page.reload();
      await expect(status(page)).toContainText("Melody");
      expect(await onTask(page, "first", 2)).toEqual(asking(FIRST, words, 2));
      // It came by itself again: nothing has the keyboard.
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      expect((await guideOf(page)).mark).toEqual({ kind: "ring", track: 6 });
      await clean(page, problems);
    });
  });

  test.describe("the first steps", () => {
    test("are done with the mouse on the page itself: each is noticed, and the next one comes by itself", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const count = page.locator("#tour-count");

      // Play, in the wheel's middle. "Show me" would start the Kreisel here, and says so before it is pressed.
      expect(await onTask(page, "first", 0)).toEqual(asking(FIRST, words, 0));
      await expect(page.locator("#tour-show")).toHaveAccessibleName("Show me: the Kreisel starts playing");
      await pressHub(page);
      expect(await ticked(page, "first", 0)).toEqual(praising(FIRST, words, 0));
      expect(await playing(page)).toBe(true);
      // "Show me" has nothing to show on a task that was done.
      await expect(page.locator("#tour-show")).toHaveAttribute("aria-disabled", "true");
      await expect(page.locator("#tour-show")).toHaveAccessibleName("Show me");

      // The kick out and back: the speaker in its row is marked.
      expect(await onTask(page, "first", 1)).toEqual(asking(FIRST, words, 1));
      await expect(page.locator("#tour-show")).toHaveAttribute("aria-disabled", "false");
      await expect.poll(() => inTheWay(page)).toEqual([]);
      await inRow(page, 0, "mute").click();
      expect(await audible(page, 0)).toBe(false);
      // Out is half of it: the card waits for the kick to come back.
      await page.waitForTimeout(450);
      expect(await guideOf(page)).toMatchObject({ index: 1, done: false });
      await inRow(page, 0, "mute").click();
      expect(await ticked(page, "first", 1)).toEqual(praising(FIRST, words, 1));
      expect(await audible(page, 0)).toBe(true);

      // Three notes in the Melody. One that goes into another ring is answered, and is not one of the three.
      expect(await onTask(page, "first", 2)).toEqual(asking(FIRST, words, 2));
      expect((await guideOf(page)).mark).toEqual({ kind: "ring", track: 6 });
      const bass = await hitsOf(page, 4);
      const stray = await where(page, 4, [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].find((step) => !bass.includes(step))!);
      await page.mouse.click(stray.x, stray.y);
      await expect(hint(page)).toHaveText(/^That went into the Bass\./);
      await expect(page.locator("#tour-keys")).toHaveText(words[2]!.keys);
      expect(await guideOf(page)).toMatchObject({ index: 2, done: false });
      // The card stays on the task after the first and the second note.
      await focus(page, 6);
      for (const [had, step] of [2, 6, 11].entries()) {
        const spot = await where(page, 6, step);
        await page.mouse.click(spot.x, spot.y);
        if (had === 2) break;
        await page.waitForTimeout(450);
        expect(await guideOf(page)).toMatchObject({ index: 2, done: false });
        await expect(count).toHaveText("Step 3 of 5");
        await expect(page.locator("#tour")).not.toHaveClass(/done/);
      }
      expect(await ticked(page, "first", 2)).toEqual(praising(FIRST, words, 2));
      expect(await hitsOf(page, 6)).toEqual([2, 6, 11]);

      // Another sound: the arrow beside the sound's name. Going to another ring is not it; that ring's arrow is.
      expect(await onTask(page, "first", 3)).toEqual(asking(FIRST, words, 3));
      await expect(status(page)).toContainText("Melody:");
      await expect.poll(() => inTheWay(page)).toEqual([]);
      const before = await soundsOf(page);
      await inRow(page, 5, "pick").click();
      await expect(status(page)).toContainText("Chords:");
      await page.waitForTimeout(450);
      expect(await guideOf(page)).toMatchObject({ index: 3, done: false });
      await page.locator(".sound-row").getByRole("button", { name: "Next sound" }).click();
      expect(await ticked(page, "first", 3)).toEqual(praising(FIRST, words, 3));
      expect((await soundsOf(page)).map((sound, ring) => sound !== before[ring])).toEqual([false, false, false, false, false, true, false]);

      // Stutter. A click is no hold: the card says so, and waits for one.
      expect(await onTask(page, "first", 4)).toEqual(asking(FIRST, words, 4));
      await expect.poll(() => inTheWay(page)).toEqual([]);
      await pad(page, "stotter").click();
      await expect(hint(page)).toHaveText(/^Keep Stutter pressed a little longer/);
      expect(await guideOf(page)).toMatchObject({ index: 4, done: false });
      await holdPad(page, "stotter");
      expect(await ticked(page, "first", 4)).toEqual(praising(FIRST, words, 4));

      // The end: what it was, and the six other lessons to go on with, one of them recommended.
      const end = await ended(page, "first");
      expect(end).toMatchObject({ title: FIRST.name, count: "Done", text: FIRST.end, offers: others("first"), recommended: "beat", praised: true });
      expect(end.under).toContain(lessonOf("beat").name);
      expect(end.under).toContain(lessonOf("beat").promise);
      for (const id of ["tour-show", "tour-back", "tour-next", "tour-keep", "tour-mine"]) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(page.locator("#tour-skip")).toBeVisible();
      expect(await guideOf(page)).toMatchObject({ view: "end", finished: ["first"], left: null, mark: null });
      expect(await keptOf(page)).toEqual({ seen: "1", lessons: { done: ["first"], at: null } });
      // Done with the mouse, nothing of the card has the keyboard.
      expect(await keyboardOnCard(page)).toBe(false);
      await clean(page, problems);
    });

    test("are done by keyboard alone, and the keyboard stays on the wheel through all of them", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const wheel = page.locator("#kreisel");
      await onTask(page, "first", 0);
      await wheel.focus();

      // The space bar starts it.
      await page.keyboard.press("Space");
      expect(await ticked(page, "first", 0)).toEqual(praising(FIRST, words, 0));
      await expect(wheel).toBeFocused();

      // 1 picks the Kick, M takes it out and brings it back.
      expect(await onTask(page, "first", 1)).toEqual(asking(FIRST, words, 1));
      await expect(wheel).toBeFocused();
      await page.keyboard.press("1");
      await page.keyboard.press("m");
      expect(await audible(page, 0)).toBe(false);
      await page.keyboard.press("m");
      expect(await ticked(page, "first", 1)).toEqual(praising(FIRST, words, 1));
      await expect(wheel).toBeFocused();

      // 7 picks the Melody, the arrows move along it, Enter sets a note: three of them.
      expect(await onTask(page, "first", 2)).toEqual(asking(FIRST, words, 2));
      await expect(wheel).toBeFocused();
      await page.keyboard.press("7");
      for (let note = 0; note < 3; note += 1) {
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
        if (note === 2) break;
        await page.waitForTimeout(450);
        expect(await guideOf(page)).toMatchObject({ index: 2, done: false });
      }
      expect(await ticked(page, "first", 2)).toEqual(praising(FIRST, words, 2));
      expect(await hitsOf(page, 6)).toEqual([1, 3, 5]);
      await expect(wheel).toBeFocused();

      // The key where a QWERTY keyboard has its I takes the next sound, whatever is printed on it.
      expect(await onTask(page, "first", 3)).toEqual(asking(FIRST, words, 3));
      await expect(wheel).toBeFocused();
      const sound = (await soundsOf(page))[6];
      await page.keyboard.press("KeyI");
      expect(await ticked(page, "first", 3)).toEqual(praising(FIRST, words, 3));
      expect((await soundsOf(page))[6]).not.toBe(sound);
      await expect(wheel).toBeFocused();

      // The key where it has its C holds the stutter.
      expect(await onTask(page, "first", 4)).toEqual(asking(FIRST, words, 4));
      await expect(wheel).toBeFocused();
      await page.keyboard.down("KeyC");
      await expect(pad(page, "stotter")).toHaveClass(/held/);
      await page.waitForTimeout(800);
      await page.keyboard.up("KeyC");
      expect(await ticked(page, "first", 4)).toEqual(praising(FIRST, words, 4));
      await expect(wheel).toBeFocused();

      expect((await ended(page, "first")).text).toBe(FIRST.end);
      await expect(wheel).toBeFocused();
      expect(await keptOf(page)).toEqual({ seen: "1", lessons: { done: ["first"], at: null } });
      // The space bar is still start and stop.
      await page.keyboard.press("Space");
      expect(await playing(page)).toBe(false);
      await clean(page, problems);
    });

    test("take any ring for one that is taken out and brought back, ask for as many notes as the Melody has room for, and pass what cannot be done", async ({ page }) => {
      const problems = await open(page);
      // A Melody with one free step, and all eight scenes filled.
      await page.evaluate(() => {
        const app = window.kreisel.app;
        app.store.touch((project) => {
          project.scenes[project.scene]!.patterns[6]!.steps.forEach((step, at) => { step.on = at !== 9; });
        });
        for (let scene = 1; scene < app.project.scenes.length; scene += 1) app.scenes.pick(scene);
        app.scenes.pick(0);
        app.dismiss();
      });
      expect(await page.evaluate(() => window.kreisel.app.project.scenes.filter((scene) => scene !== null).length)).toBe(8);
      expect(await hitsOf(page, 6)).toHaveLength(15);

      await startLesson(page, "first");
      await onTask(page, "first", 0);
      await goOn(page).click();
      // The speaker beside Kick is the one that is marked; the one beside Bass does as well.
      await onTask(page, "first", 1);
      await inRow(page, 4, "mute").click();
      await inRow(page, 4, "mute").click();
      expect((await ticked(page, "first", 1)).count).toBe("Done");
      await goOn(page).click();
      // The one note that still fits is the task.
      await onTask(page, "first", 2);
      await clickSteps(page, 6, [9]);
      expect((await ticked(page, "first", 2)).count).toBe("Done");
      expect(await hitsOf(page, 6)).toHaveLength(16);
      await page.locator("#tour-skip").click();

      // The lesson about a second part begins with a copy onto an empty scene: with none left, that task is passed as done.
      await startLesson(page, "scenes");
      expect(await reached(page, "scenes", 0)).toBe(true);
      expect((await onTask(page, "scenes", 1)).text).toBe((await wordsOf(page, lessonOf("scenes")))[1]!.text);
      await clean(page, problems);
    });

    test("say what is in the way: that nothing plays yet, and where a hit went that missed its place", async ({ page }) => {
      const problems = await open(page);
      const lesson = lessonOf("beat");
      const words = await wordsOf(page, lesson);
      const keys = page.locator("#tour-keys");
      await startLesson(page, "beat");
      // The task is about what is heard, and nothing plays: the card says so, above its line about the keys.
      expect(await onTask(page, "beat", 0)).toEqual(asking(lesson, words, 0, QUIET.mouse));
      await expect(hint(page)).toBeVisible();
      await pressHub(page);
      await expect(hint(page)).toBeHidden();
      await expect(keys).toHaveText(words[0]!.keys);

      // A hit in the ring beside it: the card says where it went and where the marked places are.
      await clickSteps(page, 1, [0]);
      await expect(hint(page)).toHaveText(/^That went into the Snare\./);
      await expect(keys).toHaveText(words[0]!.keys);
      await expect.poll(() => inTheWay(page)).toEqual([]);
      // Taken away again, nothing is in the way.
      await clickSteps(page, 1, [0]);
      await expect(hint(page)).toBeHidden();
      await expect(keys).toHaveText(words[0]!.keys);
      // A hit in the right ring beside the marked places.
      await clickSteps(page, 0, [1]);
      await expect(hint(page)).toHaveText(/^Close\./);
      await clickSteps(page, 0, [1]);
      await expect(hint(page)).toBeHidden();
      expect(await guideOf(page)).toMatchObject({ lesson: "beat", index: 0, done: false });
      // The marked places themselves.
      await clickSteps(page, 0, [0, 4, 8, 12]);
      expect(await ticked(page, "beat", 0)).toEqual(praising(lesson, words, 0));

      // Stopped, the next task says again that nothing plays.
      await page.keyboard.press("Space");
      expect(await playing(page)).toBe(false);
      await goOn(page).click();
      expect(await onTask(page, "beat", 1)).toEqual(asking(lesson, words, 1, QUIET.mouse));
      await clean(page, problems);
    });
  });

  test.describe("Show me, Skip, Back and Close", () => {
    test("does every task of the first steps once for whoever presses “Show me”", async ({ page }) => {
      test.setTimeout(60_000);
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const show = page.locator("#tour-show");
      const shownAs = tasksFor(FIRST, false).map((task) => task.shown);
      const before = await state(page);
      for (const index of words.keys()) {
        expect((await onTask(page, "first", index)).text).toBe(words[index]!.text);
        await show.click();
        // Pressed with the mouse, the button does not keep the keyboard.
        expect(await nobodyHasTheKeyboard(page)).toBe(true);
        // Pressed twice in a row (the three notes take a moment to come), it does its work once.
        if (index === 2) await show.click();
        // The kick is taken out for a moment before it comes back: the card says what was shown, and waits.
        if (index === 1) {
          await expect.poll(() => audible(page, 0)).toBe(false);
          expect(await guideOf(page)).toMatchObject({ index: 1, done: false });
          await expect(page.locator("#tour-said")).toHaveText(shownAs[1]!);
        }
        expect(await ticked(page, "first", index)).toEqual(praising(FIRST, words, index));
        await expect(show).toHaveAttribute("aria-disabled", "true");
        // Whoever has seen it goes on with "Next" (on the last task: "Finish").
        await goOn(page).click();
      }
      expect(await ended(page, "first")).toMatchObject({ text: FIRST.end, praised: true });
      // What was shown is on the Kreisel like anything else: it plays, the kick is back, the Melody has three notes and another sound.
      expect(await playing(page)).toBe(true);
      expect(await audible(page, 0)).toBe(true);
      expect(await hitsOf(page, 6)).toHaveLength(3);
      expect(await state(page)).not.toBe(before);
      expect(await page.evaluate(() => window.kreisel.app.engine.fx.stotter)).toBe(false);
      expect(await keyboardOnCard(page)).toBe(false);
      expect((await guideOf(page)).finished).toEqual(["first"]);
      await clean(page, problems);
    });

    test("writes nothing more once the guide went on or was closed while “Show me” was at it, and still gives back what it took", async ({ page }) => {
      const problems = await firstLook(page);
      await onTask(page, "first", 0);
      await goOn(page).click();
      await onTask(page, "first", 1);
      // The kick is out, and the guide is closed before it is back: it comes back all the same.
      await page.locator("#tour-show").click();
      await expect.poll(() => audible(page, 0)).toBe(false);
      await page.locator("#tour-skip").click();
      await expect(page.locator("#tour")).toBeHidden();
      await expect.poll(() => audible(page, 0), { timeout: 4000 }).toBe(true);

      // Three notes are being set one after the other, and the card is sent on before they are all there: the rest stays away.
      await openList(page);
      await chip(page, "first").click();
      await onTask(page, "first", 1);
      await goOn(page).click();
      await onTask(page, "first", 2);
      await page.locator("#tour-show").click();
      await goOn(page).click();
      await onTask(page, "first", 3);
      await page.waitForTimeout(1200);
      expect((await hitsOf(page, 6)).length).toBeLessThanOrEqual(1);
      expect(await guideOf(page)).toMatchObject({ lesson: "first", index: 3, done: false });
      await clean(page, problems);
    });

    test("goes on with “Skip” without anything being done, and goes back with “Back”", async ({ page }) => {
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const back = page.locator("#tour-back");
      const before = await state(page);

      await onTask(page, "first", 0);
      // There is nothing before the first task.
      await expect(back).toBeHidden();
      await expect(goOn(page)).toHaveText("Skip");
      await goOn(page).click();
      // Pressed with the mouse, a button of the card does not keep the keyboard.
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await onTask(page, "first", 1);
      await expect(back).toBeVisible();
      for (const index of [2, 3, 4]) {
        await goOn(page).click();
        expect((await onTask(page, "first", index)).text).toBe(words[index]!.text);
        await expect(goOn(page)).toHaveText("Skip");
      }

      // Back, one task at a time, to the first.
      for (const index of [3, 2, 1]) {
        await back.click();
        expect(await nobodyHasTheKeyboard(page)).toBe(true);
        expect((await onTask(page, "first", index)).text).toBe(words[index]!.text);
      }
      await back.click();
      await onTask(page, "first", 0);
      await expect(back).toBeHidden();

      // Nothing was done by any of it: the Kreisel is as it came and does not play.
      expect(await state(page)).toBe(before);
      expect(await playing(page)).toBe(false);
      expect(await guideOf(page)).toMatchObject({ finished: [], left: { id: "first", index: 0 } });
      // Skipped through to its end, the lesson is not ticked: the card says so without praise, and offers it again.
      for (const index of [1, 2, 3, 4]) {
        await goOn(page).click();
        await onTask(page, "first", index);
      }
      await goOn(page).click();
      const end = await ended(page, "first");
      expect(end).toMatchObject({ title: FIRST.name, count: "", offers: CHAPTERS.map((one) => one.id), praised: false });
      expect(end.text).toMatch(/^You skipped through “First steps”\./);
      await expect(chip(page, "first")).not.toHaveClass(/finished/);
      expect(await guideOf(page)).toMatchObject({ view: "end", finished: [] });
      // The first steps do not come by themselves again, though.
      expect(await keptOf(page)).toEqual({ seen: "1", lessons: { done: [], at: null } });
      expect(await state(page)).toBe(before);
      await clean(page, problems);
    });

    test("shows a task that holds already once more when “Back” leads to it, to be read, and does not pass it again", async ({ page }) => {
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      /** What the card reads, whatever it is on. */
      const reads = (): Promise<{ count: string; text: string; place: string | null; under: string; goOn: string; ticked: boolean }> =>
        page.evaluate(() => {
          const read = (part: string): string => document.getElementById(part)?.textContent ?? "";
          return { count: read("tour-count"), text: read("tour-text"), place: document.querySelector("#tour-text .guide-goto")?.textContent ?? null, under: read("tour-keys"), goOn: read("tour-next"), ticked: document.getElementById("tour")!.classList.contains("done") };
        });
      const counted = (): Promise<{ done: boolean; revisited: boolean; did: number; cheers: number }> =>
        page.evaluate(() => ({ done: window.kreisel.app.guide.done, revisited: window.kreisel.app.guide.revisited, did: window.kreisel.app.guide.did, cheers: window.kreisel.app.guide.cheers }));
      await onTask(page, "first", 0);
      await pressHub(page);
      await ticked(page, "first", 0);
      await goOn(page).click();
      await onTask(page, "first", 1);
      const before = await counted();
      expect(before).toMatchObject({ done: false, revisited: false, did: 1 });

      // Back to "play" while it plays: the task holds already. It is shown with its sentence, as done, and what was
      // said when it was done stands under it.
      await page.locator("#tour-back").click();
      await expect(page.locator("#tour-count")).toHaveText("Step 1 of 5 · done");
      expect(await reads()).toEqual({ count: "Step 1 of 5 · done", text: words[0]!.text, place: words[0]!.place, under: words[0]!.after, goOn: "Next", ticked: true });
      // Its place is marked again, so the name in the sentence still leads there.
      expect((await guideOf(page)).mark).toEqual({ kind: "hub" });
      await expect(page.locator("#tour-show")).toHaveAttribute("aria-disabled", "true");
      await expect(page.locator("#tour-said")).toHaveText(`Step 1 of 5, done already. ${words[0]!.text}`);
      // It was not done a second time (no praise, no count), and it stays until the visitor goes on.
      expect(await counted()).toEqual({ ...before, done: true, revisited: true });
      await page.waitForTimeout(2500);
      expect(await guideOf(page)).toMatchObject({ lesson: "first", index: 0, done: true });
      expect((await reads()).count).toBe("Step 1 of 5 · done");
      await goOn(page).click();
      expect(await onTask(page, "first", 1)).toEqual(asking(FIRST, words, 1));
      expect(await counted()).toEqual({ ...before, done: false, revisited: false });

      // A task gone back to that does not hold is an ordinary task to do: stopped, "play" asks to be pressed again.
      await page.keyboard.press("Space");
      await expect.poll(() => playing(page)).toBe(false);
      await page.locator("#tour-back").click();
      expect(await onTask(page, "first", 0)).toEqual(asking(FIRST, words, 0));
      await clean(page, problems);
    });

    test("keeps its buttons where they are from task to task while it plays", async ({ page }) => {
      const problems = await firstLook(page);
      const show = page.locator("#tour-show");
      /** Where the button that goes on and "Show me" are, to half a pixel. */
      const places = async (): Promise<number[]> => [(await goOn(page).boundingBox())!, (await show.boundingBox())!].flatMap((box) => [box.x, box.y, box.width, box.height]).map((value) => Math.round(value * 2) / 2);
      await onTask(page, "first", 0);
      await pressHub(page);
      await ticked(page, "first", 0);
      await goOn(page).click();
      // From the second task on (the first has no "Back" beside them), the buttons stand where they stood.
      await onTask(page, "first", 1);
      const second = await places();
      for (const index of [2, 3, 4]) {
        await goOn(page).click();
        await onTask(page, "first", index);
        await expect(goOn(page)).toHaveText("Skip");
        expect(await places(), `step ${index + 1}`).toEqual(second);
      }
      await clean(page, problems);
    });

    test("keeps “Show me” at one height whatever a task shows: while it stands, while it plays, with a hint, and once it was done", async ({ page }) => {
      const problems = await firstLook(page);
      const show = page.locator("#tour-show");
      /** How far down a button of the card stands, to half a pixel. */
      const top = async (button = show): Promise<number> => Math.round((await button.boundingBox())!.y * 2) / 2;
      const seen: Record<string, number> = {};
      await onTask(page, "first", 0);
      seen["step 1, while it stands"] = await top();
      await goOn(page).click();
      await onTask(page, "first", 1);
      await expect(hint(page)).toBeVisible();
      seen["step 2, with the word that nothing plays"] = await top();
      await pressHub(page);
      await expect(hint(page)).toBeHidden();
      seen["step 2, while it plays"] = await top();
      await show.click();
      await ticked(page, "first", 1);
      seen["step 2, done"] = await top();
      await goOn(page).click();
      for (const index of [2, 3, 4]) {
        await onTask(page, "first", index);
        seen[`step ${index + 1}`] = await top();
        if (index === 4) {
          await pad(page, "stotter").click();
          await expect(hint(page)).toBeVisible();
          seen["step 5, with a near miss answered"] = await top();
        }
        await goOn(page).click();
      }
      // At the end of a lesson that asks a question, its two answers stand where "Show me" stood.
      await ended(page, "first");
      await chip(page, "beat").click();
      await onTask(page, "beat", 0);
      seen["Build a beat, step 1"] = await top();
      await show.click();
      await ticked(page, "beat", 0);
      await goOn(page).click();
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await goOn(page).click();
      }
      await ended(page, "beat");
      seen["the end, “Keep it”"] = await top(page.locator("#tour-keep"));
      seen["the end, “Back to mine”"] = await top(page.locator("#tour-mine"));
      const first = seen["step 1, while it stands"]!;
      expect(seen).toEqual(Object.fromEntries(Object.keys(seen).map((what) => [what, first])));
      await clean(page, problems);
    });

    test("leaves the keyboard on the button that was pressed with it", async ({ page }) => {
      test.setTimeout(60_000);
      const problems = await firstLook(page);
      const back = page.locator("#tour-back");
      const show = page.locator("#tour-show");
      await onTask(page, "first", 0);

      // The card comes right after the top bar: one Tab from the question mark, and from there through its buttons.
      await page.locator("#help-open").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("#tour-skip")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator("#tour-text .guide-goto")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(show).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(goOn(page)).toBeFocused();

      // Enter on "Skip": the next task, and the keyboard is still on that button.
      await page.keyboard.press("Enter");
      await onTask(page, "first", 1);
      await expect(goOn(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await onTask(page, "first", 2);
      await expect(goOn(page)).toBeFocused();
      // "Back" keeps it as well, until there is nothing to go back to: then it stays on the card.
      await page.keyboard.press("Shift+Tab");
      await expect(back).toBeFocused();
      await page.keyboard.press("Enter");
      await onTask(page, "first", 1);
      await expect(back).toBeFocused();
      await page.keyboard.press("Enter");
      await onTask(page, "first", 0);
      await expect(back).toBeHidden();
      expect(await keyboardOnCard(page)).toBe(true);

      // "Show me" keeps it while the task is shown and noticed, and when the next task comes by itself.
      await show.focus();
      await page.keyboard.press("Enter");
      await ticked(page, "first", 0);
      await expect(show).toBeFocused();
      await onTask(page, "first", 1);
      await expect(show).toBeFocused();
      // The space bar presses a button the keyboard is on, as anywhere on the page: it does not stop the Kreisel there.
      expect(await playing(page)).toBe(true);
      await goOn(page).focus();
      await page.keyboard.press("Space");
      await onTask(page, "first", 2);
      expect(await playing(page)).toBe(true);
      await expect(goOn(page)).toBeFocused();

      // At the end, where that button is gone, the keyboard stays on the card: on the lesson it recommends.
      for (const index of [3, 4]) {
        await page.keyboard.press("Enter");
        await onTask(page, "first", index);
      }
      await page.keyboard.press("Enter");
      const end = await ended(page, "first");
      expect(end.recommended).toBe("beat");
      await expect(chip(page, "beat")).toBeFocused();
      await clean(page, problems);
    });

    test("leaves the keyboard with the Kreisel when it is put away with a click on ×: the space bar starts", async ({ page }) => {
      const problems = await firstLook(page);
      await onTask(page, "first", 0);
      await page.locator("#tour-skip").click();
      await expect(page.locator("#tour")).toBeHidden();
      // Clicked, the × does not hand the keyboard to another button.
      expect(await page.evaluate(() => (document.activeElement === document.body ? "" : (document.activeElement?.id ?? "?")))).toBe("");
      await page.keyboard.press("Space");
      await expect.poll(() => playing(page)).toBe(true);
      await expect(page.locator("#context")).toBeHidden();
      await clean(page, problems);
    });

    test("is put away with ×, says where it waits, and is found again under the question mark where it was left", async ({ page }) => {
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const tour = page.locator("#tour");
      await onTask(page, "first", 0);
      await goOn(page).click();
      await onTask(page, "first", 1);
      await goOn(page).click();
      await onTask(page, "first", 2);

      await page.locator("#tour-skip").click();
      await expect(tour).toBeHidden();
      expect(await toastOf(page)).toMatch(WAITS);
      await expect(page.locator("#toast")).toContainText(WAITS);
      // Said once: the page's message says it, the guide's own announcer does not say it a second time.
      await page.waitForTimeout(700);
      await expect(page.locator("#tour-said")).not.toContainText("closed");
      expect(await guideOf(page)).toMatchObject({ view: "off", lesson: null, left: { id: "first", index: 2 } });
      expect(await keptOf(page)).toEqual({ seen: "1", lessons: { done: [], at: ["first", 2, 0] } });

      // Under the question mark: the list of all seven lessons, and the one that was left says where.
      await dismiss(page);
      await expect(page.locator("#help-open")).toHaveAttribute("title", /guide/);
      await openList(page);
      expect(await guideOf(page)).toMatchObject({ view: "list", lesson: null });
      await expect(page.locator("#tour-text")).toHaveText(/^Pick a lesson\./);
      await expect(page.locator("#tour-count")).toHaveText("");
      await expect(page.locator("#tour-list .chip")).toHaveCount(7);
      expect(await page.locator("#tour-list .chip").evaluateAll((chips) => chips.map((one) => (one as HTMLElement).dataset.lesson))).toEqual(CHAPTERS.map((one) => one.id));
      for (const id of ["tour-show", "tour-back", "tour-next", "tour-keep", "tour-mine"]) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(chip(page, "first").locator(".name")).toHaveText(FIRST.name);
      await expect(chip(page, "first").locator(".where")).toHaveText("continue at 3");
      await expect(chip(page, "first")).toHaveAccessibleName(`${FIRST.name}: ${FIRST.promise}. Continue at step 3`);
      await expect(chip(page, "beat").locator(".name")).toHaveText(lessonOf("beat").name);
      await expect(chip(page, "beat")).toHaveAccessibleName(`${lessonOf("beat").name}: ${lessonOf("beat").promise}`);
      await expect(page.locator("#tour-list .chip.finished")).toHaveCount(0);
      // One lesson is recommended, the first that is not finished: its chip is the dark one, and the card says what it is for.
      await expect(page.locator("#tour-list .chip.primary")).toHaveCount(1);
      await expect(chip(page, "first")).toHaveClass(/primary/);
      await expect(page.locator("#tour-keys")).toContainText(FIRST.promise);
      // Asked for with the mouse, the card does not take the keyboard.
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await expect.poll(() => inTheWay(page)).toEqual([]);

      // Its chip goes on where it was left.
      await chip(page, "first").click();
      expect(await onTask(page, "first", 2)).toEqual(asking(FIRST, words, 2));
      expect(await nobodyHasTheKeyboard(page)).toBe(true);

      // The question mark while a lesson is up brings the list as well; the lesson waits where it was.
      await goOn(page).click();
      await onTask(page, "first", 3);
      await openList(page);
      expect(await guideOf(page)).toMatchObject({ view: "list", lesson: null, left: { id: "first", index: 3 } });
      await expect(chip(page, "first").locator(".where")).toHaveText("continue at 4");
      await expect(page.locator("#tour-mark")).toBeHidden();
      await chip(page, "first").click();
      expect((await onTask(page, "first", 3)).text).toBe(words[3]!.text);

      // Closed a second time, it says where it waits again: nobody has to look for it.
      await dismiss(page);
      await page.locator("#tour-skip").click();
      await expect(tour).toBeHidden();
      expect(await toastOf(page)).toMatch(WAITS);
      await clean(page, problems);
    });
  });

  test.describe("the lessons", () => {
    test.skip(({ browserName }) => browserName !== "chromium", "walked once, on the laptop");

    for (const lesson of CHAPTERS.slice(2)) {
      test(`leads through “${lesson.name}” task by task, and each is noticed when it was done by hand`, async ({ page, context }) => {
        test.setTimeout(90_000);
        const problems = await open(page);
        if (lesson.id === "share") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const own = await state(page);
        const borrows = lesson.lends !== undefined;
        await startLesson(page, lesson.id);
        await reached(page, lesson.id, 0);
        // A lesson that would change more than it was asked for works on a copy: the table is lent to it.
        expect(await lending(page)).toBe(borrows);
        expect(await state(page)).toBe(own);
        await walk(page, lesson);

        const end = await ended(page, lesson.id);
        expect(end).toMatchObject({ title: lesson.name, count: "Done", praised: true });
        expect(end.text.startsWith(lesson.end)).toBe(true);
        expect(await guideOf(page)).toMatchObject({ view: "end", finished: [lesson.id], left: null, mark: null });
        expect((await keptOf(page)).lessons).toEqual({ done: [lesson.id], at: null });
        if (borrows) {
          // What was made is on the table, the visitor's own Kreisel is set aside: the card asks which of the two stays.
          expect(end.offers).toEqual([]);
          expect(end.text).toMatch(/Keep what you made, or go back to the Kreisel you had\?$/);
          expect(await lending(page)).toBe(true);
          const made = await state(page);
          expect(made).not.toBe(own);
          await expect(page.locator("#tour-keep")).toBeVisible();
          await expect.poll(() => outOfReach(page)).toEqual([]);
          if (lesson.id === "sounds") {
            await page.locator("#tour-keep").click();
            expect(await state(page)).toBe(made);
            expect(await toastOf(page)).toMatch(/^It is yours now\./);
            await page.locator("#undo").click();
            expect(await state(page)).toBe(own);
          } else {
            await page.locator("#tour-mine").click();
            expect(await state(page)).toBe(own);
            expect(await toastOf(page)).toMatch(OWN_IS_BACK);
            // What the lesson resampled on its copy goes with the copy: no recording is left lying in the browser.
            await expect.poll(() => page.evaluate(async () => (await window.kreisel.app.sample.keptIds()).length)).toBe(0);
          }
          expect(await lending(page)).toBe(false);
          // The question is answered: the card goes on to the other lessons.
          await expect(page.locator("#tour-keep")).toBeHidden();
          await expect(page.locator("#tour-text")).toHaveText(lesson.end);
        }
        const after = await ended(page, lesson.id);
        expect(after.offers).toEqual(others(lesson.id));
        expect(after.recommended).toBe("first");
        if (lesson.id === "share") {
          // The link that was copied holds this Kreisel; and on the stage Escape leaves the stage first, the guide stays.
          expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#k=/);
          await expect(page.locator("html")).toHaveAttribute("data-stage", "true");
          await expect(page.locator("html")).toHaveAttribute("data-guide", "sheet");
          await expect.poll(() => outOfReach(page)).toEqual([]);
          await page.keyboard.press("Escape");
          await expect(page.locator("html")).toHaveAttribute("data-stage", "false");
          expect((await guideOf(page)).view).toBe("end");
          await expect(page.locator("html")).toHaveAttribute("data-guide", "docked");
        }

        // In the list its chip has a tick, in words too.
        await page.locator("#tour-skip").click();
        await expect(page.locator("#tour")).toBeHidden();
        await openList(page);
        await expect(chip(page, lesson.id)).toHaveClass(/finished/);
        await expect(chip(page, lesson.id)).toHaveAccessibleName(`${lesson.name}: ${lesson.promise}. Done`);
        expect(await chip(page, lesson.id).locator(".name").evaluate((name) => getComputedStyle(name, "::before").content)).toContain("✓");
        await expect(page.locator("#tour-list .chip.finished")).toHaveCount(1);
        await clean(page, problems);
      });
    }

    test("goes from one lesson to the next at the end of each, with “Show me” for every task", async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await open(page);
      await openList(page);
      for (const lesson of CHAPTERS.slice(1)) {
        const own = await state(page);
        await chip(page, lesson.id).click();
        const words = await wordsOf(page, lesson);
        for (const index of words.keys()) {
          const what = `${lesson.name}, step ${index + 1}`;
          // A task that asks for what is so already has nothing to show, and is passed.
          if (await reached(page, lesson.id, index)) continue;
          await page.locator("#tour-show").click();
          expect((await ticked(page, lesson.id, index, 30_000)).text, what).toBe(words[index]!.after);
          await goOn(page).click();
        }
        const end = await ended(page, lesson.id);
        expect(end.praised, lesson.name).toBe(true);
        if (lesson.lends) {
          expect(end.offers).toEqual([]);
          await page.locator("#tour-mine").click();
          await expect(page.locator("#tour-list .chip")).toHaveCount(6);
          expect(await state(page), lesson.name).toBe(own);
        } else {
          expect(end.text).toBe(lesson.end);
        }
      }
      expect((await guideOf(page)).finished).toEqual(["beat", "sounds", "live", "scenes", "sample", "share"]);
      await clean(page, problems);
    });

    test("puts the keyboard on an empty scene from the sentence that names one", async ({ page }) => {
      const problems = await open(page);
      await startLesson(page, "scenes");
      await onTask(page, "scenes", 0);
      // The first empty scene is marked, not all eight.
      expect((await guideOf(page)).mark).toEqual({ kind: "node", selector: "#scenes .scene:not(.filled)" });
      await expect.poll(() => inTheWay(page)).toEqual([]);
      await page.locator("#tour-text .guide-goto").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#scenes .scene:not(.filled)").first()).toBeFocused();
      await expect(page.locator("#scenes .scene:not(.filled)").first()).toHaveAccessibleName("Scene B, empty");
      await page.keyboard.press("Enter");
      expect((await ticked(page, "scenes", 0)).count).toBe("Done");
      expect(await page.evaluate(() => window.kreisel.app.project.scenes.filter((scene) => scene !== null).length)).toBe(2);
      await clean(page, problems);
    });
  });

  test.describe("Build a beat", () => {
    /** Someone who has been here before, with a Kreisel of their own: the factory Kreisel and one note more, which is one step back. */
    async function withOwnKreisel(page: Page): Promise<{ problems: string[]; own: string; factory: string }> {
      const problems = await open(page);
      const factory = await state(page);
      await clickSteps(page, 6, [1]);
      expect(await hitsOf(page, 6)).toContain(1);
      const own = await state(page);
      expect(own).not.toBe(factory);
      await page.evaluate(() => {
        window.kreisel.app.store.save();
        window.kreisel.app.dismiss();
      });
      return { problems, own, factory };
    }
    /** What the browser keeps as the Kreisel on the table, written now. */
    const keptKreisel = (page: Page): Promise<string | null> =>
      page.evaluate((key) => {
        window.kreisel.app.store.save();
        return localStorage.getItem(key);
      }, STORAGE_KEY);
    const BEAT = lessonOf("beat");

    test("begins on an empty wheel, is built by hand, and “Keep it” leaves the beat on the table with the old Kreisel one step back", async ({ page }) => {
      test.setTimeout(90_000);
      const { problems, own } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      // The table is lent to the lesson: an empty wheel is on it, and the browser still keeps the visitor's own.
      expect(await lending(page)).toBe(true);
      expect(await allHits(page)).toBe(0);
      expect(await keptKreisel(page)).toBe(own);
      expect((await guideOf(page)).mark).toEqual({ kind: "ring", track: 0, steps: [0, 4, 8, 12] });
      // A lesson with a Kreisel of its own is not one to go on with later.
      expect((await keptOf(page)).lessons).toEqual({ done: [], at: null });

      await walk(page, BEAT);
      const end = await ended(page, "beat");
      expect(end).toMatchObject({ title: BEAT.name, count: "Done", offers: [], praised: true });
      expect(end.text.startsWith(BEAT.end)).toBe(true);
      expect(end.text).toMatch(/Keep what you made, or go back to the Kreisel you had\?$/);
      const keep = page.locator("#tour-keep");
      const mine = page.locator("#tour-mine");
      await expect(keep).toHaveText("Keep it");
      await expect(mine).toHaveText("Back to mine");
      await expect(page.locator("#tour-list")).toBeHidden();
      await expect.poll(() => outOfReach(page)).toEqual([]);
      // What was built: a kick on every beat, the clap on two and four, hats and a bass line from the dice. It plays.
      expect(await hitsOf(page, 0)).toEqual([0, 4, 8, 12]);
      expect(await hitsOf(page, 1)).toEqual([4, 12]);
      expect((await hitsOf(page, 2)).length).toBeGreaterThan(0);
      expect((await hitsOf(page, 4)).length).toBeGreaterThan(0);
      expect(await playing(page)).toBe(true);
      expect(await lending(page)).toBe(true);
      expect(await keptKreisel(page)).toBe(own);
      const beat = await state(page);

      await keep.click();
      expect(await lending(page)).toBe(false);
      expect(await state(page)).toBe(beat);
      expect(await toastOf(page)).toMatch(/^It is yours now\. The Kreisel you had before is one step back\./);
      await expect(page.locator("#toast").getByRole("button", { name: "Undo" })).toBeVisible();
      // The question is answered: the card goes on to the other lessons.
      await expect(keep).toBeHidden();
      await expect(mine).toBeHidden();
      await expect(page.locator("#tour-text")).toHaveText(BEAT.end);
      await expect(page.locator("#tour-list .chip")).toHaveCount(6);
      expect((await guideOf(page)).view).toBe("end");
      expect(await keptKreisel(page)).toBe(beat);
      // One step back is the Kreisel from before; forward again, the beat.
      await page.locator("#undo").click();
      expect(await state(page)).toBe(own);
      await page.locator("#redo").click();
      expect(await state(page)).toBe(beat);
      expect((await guideOf(page)).finished).toEqual(["beat"]);
      await clean(page, problems);
    });

    test("gives the Kreisel from before back with “Back to mine”, with its own steps back", async ({ page }) => {
      test.setTimeout(60_000);
      const { problems, own, factory } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      // "Show me" lays the hits one after the other; the end is reached without doing the rest.
      await onTask(page, "beat", 0);
      await page.locator("#tour-show").click();
      await ticked(page, "beat", 0);
      expect(await hitsOf(page, 0)).toEqual([0, 4, 8, 12]);
      await goOn(page).click();
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await goOn(page).click();
      }
      await ended(page, "beat");
      expect(await lending(page)).toBe(true);

      await page.locator("#tour-mine").click();
      expect(await lending(page)).toBe(false);
      expect(await state(page)).toBe(own);
      expect(await toastOf(page)).toMatch(OWN_IS_BACK);
      await expect(page.locator("#toast")).toContainText(OWN_IS_BACK);
      await expect(page.locator("#tour-keep")).toBeHidden();
      await expect(page.locator("#tour-list .chip")).toHaveCount(6);
      expect((await guideOf(page)).view).toBe("end");
      // The lesson has left no step of its own: one step back takes the visitor's own last note away.
      await page.locator("#undo").click();
      expect(await state(page)).toBe(factory);
      await page.locator("#redo").click();
      expect(await state(page)).toBe(own);
      expect(await keptKreisel(page)).toBe(own);
      await clean(page, problems);
    });

    test("gives the Kreisel from before back when the lesson is closed in the middle, and offers what was built", async ({ page }) => {
      const { problems, own, factory } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      await clickSteps(page, 0, [0, 4]);
      expect(await hitsOf(page, 0)).toEqual([0, 4]);
      expect(await lending(page)).toBe(true);
      const built = await state(page);

      await page.locator("#tour-skip").click();
      await expect(page.locator("#tour")).toBeHidden();
      expect(await lending(page)).toBe(false);
      expect(await state(page)).toBe(own);
      expect(await toastOf(page)).toMatch(OWN_IS_BACK);
      expect(await toastOf(page)).toMatch(WAITS);
      await expect(page.locator("#toast")).toContainText(OWN_IS_BACK);
      // What was built is not thrown away without a word: one button puts it on the table, and that is one step back.
      await page.locator("#toast").getByRole("button", { name: "Keep what I built" }).click();
      expect(await state(page)).toBe(built);
      expect(await hitsOf(page, 0)).toEqual([0, 4]);
      expect(await lending(page)).toBe(false);
      await expect(page.locator("#tour")).toBeHidden();
      await page.locator("#undo").click();
      expect(await state(page)).toBe(own);
      await page.locator("#undo").click();
      expect(await state(page)).toBe(factory);
      // Left in the middle, it is neither finished nor one to go on with: it begins anew.
      await openList(page);
      await expect(chip(page, "beat").locator(".where")).toHaveCount(0);
      await expect(chip(page, "beat")).not.toHaveClass(/finished/);
      await clean(page, problems);
    });

    test("does not throw away what was built when it is closed at its end, before the question was answered", async ({ page }) => {
      const { problems, own } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      await clickSteps(page, 0, [0, 4, 8, 12]);
      await ticked(page, "beat", 0);
      await goOn(page).click();
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await goOn(page).click();
      }
      await ended(page, "beat");
      const built = await state(page);
      await page.locator("#tour-skip").click();
      await expect(page.locator("#tour")).toBeHidden();
      // The Kreisel from before is back, the page says so, and what was built can be had back once.
      expect(await lending(page)).toBe(false);
      expect(await state(page)).toBe(own);
      expect(await toastOf(page)).toMatch(OWN_IS_BACK);
      await page.locator("#toast").getByRole("button", { name: "Keep what I built" }).click();
      expect(await state(page)).toBe(built);
      await page.locator("#undo").click();
      expect(await state(page)).toBe(own);

      // Closed after the question was answered, there is nothing left to offer: the page says where the guide waits.
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      await page.locator("#tour-show").click();
      await ticked(page, "beat", 0);
      await goOn(page).click();
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await goOn(page).click();
      }
      await ended(page, "beat");
      await page.locator("#tour-mine").click();
      expect(await state(page)).toBe(own);
      await page.locator("#tour-skip").click();
      await expect(page.locator("#tour")).toBeHidden();
      expect(await toastOf(page)).toMatch(/^The guide waits/);
      await expect(page.locator("#toast").getByRole("button", { name: "Keep what I built" })).toHaveCount(0);
      expect(await state(page)).toBe(own);
      await clean(page, problems);
    });

    test("puts the keyboard on “Keep what I built” when the lesson is closed with the keyboard, and leaves that offer until it is answered", async ({ page }) => {
      test.setTimeout(60_000);
      const { problems, own } = await withOwnKreisel(page);
      const offer = page.locator("#toast").getByRole("button", { name: "Keep what I built" });
      // Started and done with the keyboard: one kick is set.
      await page.locator("#help-open").focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await chip(page, "beat").focus();
      await page.keyboard.press("Enter");
      await onTask(page, "beat", 0);
      await page.keyboard.press("Enter");
      await expect(page.locator("#kreisel")).toBeFocused();
      await page.keyboard.press("Enter");
      expect(await hitsOf(page, 0)).toEqual([0]);
      const built = await state(page);
      // Escape puts the pointer on the wheel away, then the guide.
      await page.keyboard.press("Escape");
      await expect(page.locator("#tour")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#tour")).toBeHidden();
      expect(await state(page)).toBe(own);
      expect(await toastOf(page)).toMatch(OWN_IS_BACK);
      // The keyboard is on the offer, not on nothing and not left behind on the wheel.
      await expect(offer).toBeFocused();
      // There is no other way back to what was built: the message does not leave by itself.
      await page.waitForTimeout(10_500);
      await expect(page.locator("#toast")).toBeVisible();
      await expect(offer).toBeFocused();
      expect(await toastOf(page)).toMatch(OWN_IS_BACK);
      // Enter takes it: what was built is on the table, the page says so and offers the way back (a press by
      // mistake, the space bar out of habit, is one press undone), and one step back is the visitor's own.
      await page.keyboard.press("Enter");
      expect(await state(page)).toBe(built);
      await expect(page.locator("#toast")).toContainText("What you built is on the table");
      await expect(page.locator("#toast").getByRole("button", { name: "Undo" })).toBeVisible();
      await page.keyboard.press("Control+z");
      expect(await state(page)).toBe(own);
      await clean(page, problems);
    });

    test("shows the visitor's own Kreisel after a reload in the middle of the lesson", async ({ page }) => {
      const { problems, own } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      await clickSteps(page, 0, [0, 4, 8]);
      expect(await hitsOf(page, 0)).toEqual([0, 4, 8]);
      // While the lesson has the table, what the browser keeps is the visitor's own Kreisel, however long it takes.
      await page.waitForTimeout(700);
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(own);

      await page.reload();
      await expect(status(page)).toContainText("hits");
      expect(await state(page)).toBe(own);
      expect(await lending(page)).toBe(false);
      await page.waitForTimeout(1200);
      await expect(page.locator("#tour")).toBeHidden();
      await clean(page, problems);
    });

    test("steps aside when the visitor starts anew in the middle of the lesson: the new Kreisel replaces their own, not the lesson's", async ({ page }) => {
      const { problems, own } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      await clickSteps(page, 0, [0]);
      await fromBar(page, "kreisel-menu", "Techno Kreisel");
      await expect(page.locator("#tour")).toBeHidden();
      expect(await lending(page)).toBe(false);
      expect(await page.evaluate(() => window.kreisel.app.project.style)).toBe("techno");
      // It steps aside without a message of its own: the page's message about the new Kreisel stays, with its way
      // back. Where the guide went is said by its announcer alone.
      expect(await toastOf(page)).toBe("The techno Kreisel is here.");
      await expect(page.locator("#tour-said")).toHaveText(/^The guide is closed\. You find it again under the question mark/);
      await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
      expect(await state(page)).toBe(own);
      await clean(page, problems);
    });

    test("keeps its card when the question mark is asked while it has the table, and writes nothing into the visitor's Kreisel once it was closed", async ({ page }) => {
      const { problems, own } = await withOwnKreisel(page);
      await startLesson(page, "beat");
      await onTask(page, "beat", 0);
      // A look at the list would sweep away what is being built: the card stays on its task.
      await fromBar(page, "help-open", /Guide/);
      expect(await guideOf(page)).toMatchObject({ view: "task", lesson: "beat", index: 0, done: false });
      expect(await lending(page)).toBe(true);
      await expect(page.locator("#tour-title")).toHaveText(BEAT.name);

      // "Show me" sets the four kicks one after the other. Closed before they are all there, the rest is not set: the
      // Kreisel on the table is the visitor's own again by then.
      await page.locator("#tour-show").click();
      await page.locator("#tour-skip").click();
      await expect(page.locator("#tour")).toBeHidden();
      expect(await lending(page)).toBe(false);
      await page.waitForTimeout(1300);
      expect(await state(page)).toBe(own);
      expect(await keptKreisel(page)).toBe(own);
      await clean(page, problems);
    });
  });

  test.describe("for a keyboard and a screen reader", () => {
    test("is a named part of the page with an announcer of its own, not a window", async ({ page }) => {
      await listen(page);
      const problems = await open(page);
      const tour = page.locator("#tour");
      const announcer = page.locator("#tour-said");
      /** The announcer is there for a screen reader: in the page, not in the card, not hidden, with nothing in it but words. */
      const announcerThere = (): Promise<boolean> =>
        page.evaluate(() => {
          const node = document.getElementById("tour-said");
          if (!node || node.hidden || node.closest("[hidden], [aria-hidden='true'], [inert]") || node.children.length > 0) return false;
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && node.getAttribute("role") === "status" && !document.getElementById("tour")!.contains(node);
        });

      // Before the guide is asked for: the card is not shown, the announcer is there already, and silent.
      await expect(tour).toBeHidden();
      await expect(announcer).toBeAttached();
      await expect(announcer).toHaveText("");
      expect(await announcerThere()).toBe(true);

      await openList(page);
      // A part of the page with its heading as its name. Nothing about it is a window, and it does not speak by itself.
      expect(await tour.evaluate((node) => node.tagName)).toBe("SECTION");
      await expect(tour).toHaveRole("region");
      await expect(tour).toHaveAccessibleName("Lessons");
      await expect(page.locator("#tour-title")).toHaveRole("heading");
      for (const attribute of ["role", "aria-modal", "aria-live", "tabindex"]) await expect(tour).not.toHaveAttribute(attribute);
      await expect(page.locator("#tour [aria-live], #tour [role='status'], #tour [role='alert'], #tour [role='dialog']")).toHaveCount(0);
      await expect(page.locator("#tour-said button, #tour-said a, #tour-said [tabindex]")).toHaveCount(0);
      await expect(page.locator("#tour-list")).toHaveRole("group");
      await expect(page.locator("#tour-list")).toHaveAccessibleName("Pick a lesson");
      // A lesson's chip says its name and what it is for in its own name; nothing more hangs on it as a tooltip.
      await expect(chip(page, "live")).toHaveAccessibleName(`${lessonOf("live").name}: ${lessonOf("live").promise}`);
      await expect(chip(page, "live")).not.toHaveAttribute("title");
      await expect(page.locator("#tour-skip")).toHaveAccessibleName("Close the guide");
      await expect(announcer).toHaveText(/^Lessons\. 7 to pick from/);
      expect(await announcerThere()).toBe(true);
      // Nothing under the card is locked away.
      await expect(page.locator("[inert]")).toHaveCount(0);
      expect(await page.evaluate(() => document.querySelector("main")!.getAttribute("aria-hidden"))).toBeNull();

      await chip(page, "live").click();
      await onTask(page, "live", 0);
      await expect(tour).toHaveAccessibleName(lessonOf("live").name);
      // The place in the sentence is a button that says what it does; the mark around a part of the page is for the eye only.
      const goTo = page.locator("#tour-text .guide-goto");
      await expect(goTo).toHaveAccessibleName((await wordsOf(page, lessonOf("live")))[0]!.place!);
      await expect(goTo).toHaveAttribute("title", /focus/);
      await expect(goTo).toHaveAccessibleDescription(/focus/);
      // "Show me" would start the Kreisel for this task (an effect needs something to work on), and says so.
      await expect(page.locator("#tour-show")).toHaveAccessibleName("Show me: the Kreisel starts playing");
      await expect(page.locator("#tour-mark")).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator("#tour-mark")).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.getElementById("tour-mark")!).pointerEvents)).toBe("none");
      // The button that goes on says what it does while the task is still to do.
      await expect(goOn(page)).toHaveAccessibleName("Skip");
      expect(await announcerThere()).toBe(true);

      await page.locator("#tour-skip").click();
      await expect(tour).toBeHidden();
      // Put away, the announcer is still there (and silent about it: the page's message says where the guide waits).
      await page.waitForTimeout(700);
      await expect(announcer).not.toContainText("closed");
      expect(await toastOf(page)).toMatch(WAITS);
      expect(await announcerThere()).toBe(true);
      await clean(page, problems);
    });

    test("says every step once: the task when it comes, that it was done, and what was in its way", async ({ page }) => {
      test.setTimeout(120_000);
      await listen(page);
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const announcer = page.locator("#tour-said");
      const wheel = page.locator("#kreisel");
      const shownAs = tasksFor(FIRST, false).map((task) => task.shown);
      /** A task as it is said when it comes: its count, its sentence, the keyboard's way. */
      const step = (index: number): string => `Step ${index + 1} of 5. ${words[index]!.text} ${words[index]!.keys}`;
      // On a first visit the guide says first that it is there, and how to get to it and rid of it.
      const first = `A guide lies under the wheel: F6 goes to it, Escape puts it away. ${FIRST.name}. ${step(0)}`;
      const done = (index: number): string => `Done. ${words[index]!.after}`;

      await onTask(page, "first", 0);
      await expect(announcer).toHaveText(first);
      expect(await saidSoFar(page)).toEqual([first]);
      // What happens on the page meanwhile is not said again by the guide.
      await wheel.focus();
      await page.keyboard.press("5");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("7");
      await page.waitForTimeout(700);
      expect(await saidSoFar(page)).toEqual([first]);

      await page.keyboard.press("Space");
      await ticked(page, "first", 0);
      await expect(announcer).toHaveText(done(0));
      expect(await saidSoFar(page)).toEqual([first, done(0)]);
      await onTask(page, "first", 1);
      await expect(announcer).toHaveText(step(1));
      await page.waitForTimeout(700);
      expect(await saidSoFar(page)).toEqual([first, done(0), step(1)]);

      // "Show me" says what it did (the kick is out for a moment), then the guide says that the task was done, and
      // the next task when it comes.
      await page.locator("#tour-show").focus();
      await page.keyboard.press("Enter");
      await ticked(page, "first", 1);
      await expect(announcer).toHaveText(done(1));
      await onTask(page, "first", 2);
      await expect(announcer).toHaveText(step(2));
      expect(await saidSoFar(page)).toEqual([first, done(0), step(1), shownAs[1], done(1), step(2)]);

      // A note that goes into another ring is answered once, however long it lies there.
      await wheel.focus();
      await page.keyboard.press("5");
      const bass = await hitsOf(page, 4);
      const free = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((one) => !bass.includes(one))!;
      const pointer = await page.evaluate(() => window.kreisel.app.keyCursor ?? -1);
      for (let moves = (free - pointer + 16) % 16; moves > 0; moves -= 1) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await expect(announcer).toHaveText(/^That went into the Bass\./);
      await page.waitForTimeout(900);
      expect((await saidSoFar(page)).slice(6)).toHaveLength(1);

      // "Back" says the task it brings, once; so does "Skip".
      await page.locator("#tour-back").focus();
      await page.keyboard.press("Enter");
      await onTask(page, "first", 1);
      await expect(announcer).toHaveText(step(1));
      await page.waitForTimeout(700);
      expect((await saidSoFar(page)).slice(7)).toEqual([step(1)]);
      for (const index of [2, 3]) {
        await goOn(page).focus();
        await page.keyboard.press("Enter");
        await onTask(page, "first", index);
        await expect(announcer).toHaveText(step(index));
      }
      // A task that "Show me" does in the same breath is one message: what was shown, and that it is done.
      await page.locator("#tour-show").focus();
      await page.keyboard.press("Enter");
      await ticked(page, "first", 3);
      await expect(announcer).toHaveText(`${shownAs[3]} ${done(3)}`);
      expect((await saidSoFar(page)).slice(8)).toEqual([step(2), step(3), `${shownAs[3]} ${done(3)}`]);

      // Put away, the guide leaves the last word to the page's message; and what its announcer said does not stay
      // on the page for whoever reads it line by line later.
      await page.keyboard.press("Escape");
      await expect(page.locator("#tour")).toBeHidden();
      expect(await toastOf(page)).toMatch(WAITS);
      await expect(announcer).toHaveText("", { timeout: 15_000 });
      expect(await saidSoFar(page)).toHaveLength(11);
      await clean(page, problems);
    });

    test("puts the keyboard on the card when it is asked for from the menu with the keyboard, and on the task's place when a lesson is started", async ({ page }) => {
      const problems = await open(page);
      const menu = page.locator("#context");
      // Enter on the question mark, down to the guide, Enter: the list, with the keyboard on the lesson it recommends.
      await page.locator("#help-open").focus();
      await page.keyboard.press("Enter");
      await expect(menu.getByRole("menuitem", { name: /Help and keys/ })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: /Guide/ })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu).toBeHidden();
      await expect(page.locator("#tour-title")).toHaveText("Lessons");
      await expect(chip(page, "first")).toBeFocused();
      await expect(chip(page, "first")).toHaveClass(/primary/);
      // Tab goes through the lessons, and the card says what the one in focus is for.
      await page.keyboard.press("Tab");
      await expect(chip(page, "beat")).toBeFocused();
      await expect(page.locator("#tour-keys")).toContainText(lessonOf("beat").promise);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(chip(page, "live")).toBeFocused();
      // Enter starts one, and the keyboard is on the name of the place where its first task happens.
      await page.keyboard.press("Enter");
      await onTask(page, "live", 0);
      const goTo = page.locator("#tour-text .guide-goto");
      await expect(goTo).toBeFocused();

      // Tab goes on through the card's buttons and leaves it: it is no trap. What follows it is the page.
      await page.keyboard.press("Tab");
      await expect(page.locator("#tour-show")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(goOn(page)).toBeFocused();
      await page.keyboard.press("Tab");
      expect(await keyboardOnCard(page)).toBe(false);
      expect(await nobodyHasTheKeyboard(page)).toBe(false);
      await page.keyboard.press("Shift+Tab");
      await expect(goOn(page)).toBeFocused();
      // And backwards out of it, past its first button, to the top bar.
      await page.locator("#tour-skip").focus();
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator("#help-open")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator("#tour-skip")).toBeFocused();

      // Closed from the card with Enter on ×, the keyboard is where the visitor came from: the question mark.
      await page.keyboard.press("Enter");
      await expect(page.locator("#tour")).toBeHidden();
      await expect(page.locator("#help-open")).toBeFocused();
      await clean(page, problems);
    });

    test("goes to the card and back with F6, from wherever the keyboard is", async ({ page }) => {
      const problems = await firstLook(page);
      const wheel = page.locator("#kreisel");
      const goTo = page.locator("#tour-text .guide-goto");
      await onTask(page, "first", 0);
      // The card says so itself.
      await expect(page.locator("#tour-f6")).toContainText("F6");
      // From the wheel to the card: the keyboard is on the name of the task's place. And back to the wheel.
      await wheel.focus();
      await page.keyboard.press("F6");
      await expect(goTo).toBeFocused();
      await page.keyboard.press("F6");
      await expect(wheel).toBeFocused();
      // From a control of the page, and back to that control.
      await inRow(page, 4, "pick").focus();
      await page.keyboard.press("F6");
      await expect(goTo).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(goOn(page)).toBeFocused();
      await page.keyboard.press("F6");
      await expect(inRow(page, 4, "pick")).toBeFocused();
      // From nowhere (nothing has the keyboard), the way back leads to the wheel.
      await inRow(page, 4, "pick").blur();
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await page.keyboard.press("F6");
      await expect(goTo).toBeFocused();
      await page.keyboard.press("F6");
      await expect(wheel).toBeFocused();
      // Nothing was done by it: the card is on its first task, and nothing plays.
      expect(await guideOf(page)).toMatchObject({ lesson: "first", index: 0, done: false });
      expect(await playing(page)).toBe(false);
      await clean(page, problems);
    });

    test("takes the keyboard from a button of the card to the wheel when a ring's digit or an arrow is pressed, so that Enter sets a hit", async ({ page }) => {
      const problems = await open(page);
      const wheel = page.locator("#kreisel");
      await page.locator("#help-open").focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      // In the list the arrows are nobody's: the keyboard stays on the lesson it is on.
      await chip(page, "beat").focus();
      await page.keyboard.press("ArrowRight");
      await expect(chip(page, "beat")).toBeFocused();
      await page.keyboard.press("Enter");
      await onTask(page, "beat", 0);
      await expect(page.locator("#tour-text .guide-goto")).toBeFocused();

      // The card's line about the keys says "1 picks the Kick": pressed with the keyboard still on the card, the digit
      // takes the keyboard to the wheel, and Enter sets a hit there instead of pressing the card's button again.
      await page.keyboard.press("1");
      await expect(wheel).toBeFocused();
      expect(await page.evaluate(() => window.kreisel.app.selected)).toBe(0);
      /** The step the keyboard's pointer is on. */
      const pointer = (): Promise<number> => page.evaluate(() => window.kreisel.app.keyCursor ?? -1);
      await page.keyboard.press("ArrowRight");
      const first = await pointer();
      await page.keyboard.press("Enter");
      expect(await hitsOf(page, 0)).toEqual([first]);
      // From "Skip", an arrow does the same, and moves the pointer along the ring as it does.
      await goOn(page).focus();
      for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowRight");
      await expect(wheel).toBeFocused();
      expect(await pointer()).toBe((first + 4) % 16);
      await page.keyboard.press("Enter");
      expect(await hitsOf(page, 0)).toEqual([first, (first + 4) % 16].sort((one, other) => one - other));
      expect(await guideOf(page)).toMatchObject({ lesson: "beat", index: 0, done: false });
      // Any other key stays with the button: the space bar presses "Skip", it does not start the Kreisel.
      await goOn(page).focus();
      await page.keyboard.press("Space");
      await onTask(page, "beat", 1);
      await expect(goOn(page)).toBeFocused();
      expect(await playing(page)).toBe(false);
      await clean(page, problems);
    });

    test("leaves the keyboard with the Kreisel when the guide is used with the mouse: Enter sets a hit, the space bar starts", async ({ page }) => {
      const problems = await open(page);
      // The menu's row, a lesson's chip: clicked, neither takes the keyboard.
      await openList(page);
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await chip(page, "beat").click();
      await onTask(page, "beat", 0);
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      // What the card's line about the keys says: 1 picks the Kick, the arrows move along it, Enter sets a hit.
      await page.keyboard.press("1");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      expect(await hitsOf(page, 0)).toEqual([0]);
      expect(await guideOf(page)).toMatchObject({ lesson: "beat", index: 0, done: false });
      // The place's name in the sentence, clicked: the keyboard is where it was.
      await page.locator("#tour-text .guide-goto").click();
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      // "Show me", clicked: the space bar is still start and stop.
      await page.locator("#tour-show").click();
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await page.keyboard.press("Space");
      expect(await playing(page)).toBe(true);
      await ticked(page, "beat", 0);
      await goOn(page).click();
      await onTask(page, "beat", 1);
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      await page.keyboard.press("Space");
      expect(await playing(page)).toBe(false);
      expect(await guideOf(page)).toMatchObject({ lesson: "beat", index: 1, done: false });
      await clean(page, problems);
    });

    test("puts the keyboard where a task happens from the name of the place in its sentence", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      const goTo = page.locator("#tour-text .guide-goto");
      /** The keyboard on the place's name in the sentence, and Enter. */
      const go = async (): Promise<void> => {
        await goTo.focus();
        await page.keyboard.press("Enter");
      };

      // The play button: the button in the bar that is the same as the wheel's middle.
      await onTask(page, "first", 0);
      await expect(goTo).toHaveText(words[0]!.place!);
      await go();
      await expect(page.locator("#play")).toBeFocused();
      await page.keyboard.press("Enter");
      await ticked(page, "first", 0);
      // A task that was done on the page leaves the keyboard where it was, and so does the next one when it comes.
      await expect(page.locator("#play")).toBeFocused();
      await onTask(page, "first", 1);
      await expect(page.locator("#play")).toBeFocused();

      // The speaker beside Kick: that button.
      await go();
      await expect(inRow(page, 0, "mute")).toBeFocused();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await ticked(page, "first", 1);
      await expect(inRow(page, 0, "mute")).toBeFocused();
      await onTask(page, "first", 2);
      await expect(inRow(page, 0, "mute")).toBeFocused();

      // The Melody: the wheel, with that ring picked and the keyboard's pointer on it, so that Enter sets a note at once.
      await page.keyboard.press("1");
      await go();
      await expect(page.locator("#kreisel")).toBeFocused();
      expect(await page.evaluate(() => [window.kreisel.app.selected, window.kreisel.app.focus, window.kreisel.app.keyCursor])).toEqual([6, "ring", 0]);
      await page.keyboard.press("Enter");
      expect(await hitsOf(page, 6)).toEqual([0]);
      for (let note = 0; note < 2; note += 1) {
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
      }
      await ticked(page, "first", 2);
      await expect(page.locator("#kreisel")).toBeFocused();

      // The arrow beside the sound's name: that arrow, not the one before the name.
      await onTask(page, "first", 3);
      await go();
      await expect(page.locator(".sound-row").getByRole("button", { name: "Next sound" })).toBeFocused();
      await page.keyboard.press("Enter");
      await ticked(page, "first", 3);
      expect(await page.evaluate(() => document.activeElement?.closest(".sound-row") != null)).toBe(true);

      // Stutter: its button, which Enter holds for as long as it is down.
      await onTask(page, "first", 4);
      await go();
      await expect(pad(page, "stotter")).toBeFocused();
      await page.keyboard.down("Enter");
      await expect(pad(page, "stotter")).toHaveClass(/held/);
      await page.waitForTimeout(800);
      await page.keyboard.up("Enter");
      await ticked(page, "first", 4);
      await ended(page, "first");
      await expect(pad(page, "stotter")).toBeFocused();
      await clean(page, problems);
    });

    test("shows the place once more when its name in the sentence is clicked: the mark moves again", async ({ page }) => {
      const problems = await firstLook(page);
      /** The motions that run on the mark around a part of the page. */
      const running = (): Promise<number> => page.evaluate(() => document.getElementById("tour-mark")!.getAnimations().filter((motion) => motion.playState === "running").length);
      await onTask(page, "first", 0);
      await goOn(page).click();
      await onTask(page, "first", 1);
      await expect(page.locator("#tour-mark")).toBeVisible();
      // It moves a few times when it comes, and then stands.
      expect(await running()).toBe(1);
      await expect.poll(running, { timeout: 8000 }).toBe(0);
      await page.locator("#tour-text .guide-goto").click();
      expect(await running()).toBe(1);
      // The click took nothing else: the keyboard is where it was, the task is as it was.
      expect(await nobodyHasTheKeyboard(page)).toBe(true);
      expect(await guideOf(page)).toMatchObject({ lesson: "first", index: 1, done: false });
      await clean(page, problems);
    });

    test("builds a beat with arrows and Enter from the first marked step, and puts the keyboard on “Keep it” at the end", async ({ page }) => {
      const problems = await open(page);
      const own = await state(page);
      await page.locator("#help-open").focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await chip(page, "beat").focus();
      await page.keyboard.press("Enter");
      await onTask(page, "beat", 0);
      // Started with the keyboard, the lesson has it on the name of the place: Enter there leads to the wheel, with
      // the keyboard's pointer on the first marked step.
      await expect(page.locator("#tour-text .guide-goto")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#kreisel")).toBeFocused();
      expect(await page.evaluate(() => [window.kreisel.app.selected, window.kreisel.app.keyCursor])).toEqual([0, 0]);
      await page.keyboard.press("Enter");
      for (let hit = 0; hit < 3; hit += 1) {
        for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
      }
      expect(await hitsOf(page, 0)).toEqual([0, 4, 8, 12]);
      await ticked(page, "beat", 0);
      await expect(page.locator("#kreisel")).toBeFocused();

      // On to the end with the card's button: there the keyboard is on the answer that keeps what was built, not on the ×.
      await goOn(page).focus();
      await page.keyboard.press("Enter");
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await expect(goOn(page)).toBeFocused();
        await page.keyboard.press("Enter");
      }
      await ended(page, "beat");
      await expect(page.locator("#tour-keep")).toBeFocused();
      // Tab goes on to "Back to mine"; Enter there gives the Kreisel from before back, and the keyboard stays on the card.
      await page.keyboard.press("Tab");
      await expect(page.locator("#tour-mine")).toBeFocused();
      await page.keyboard.press("Enter");
      expect(await lending(page)).toBe(false);
      expect(await state(page)).toBe(own);
      expect(await keyboardOnCard(page)).toBe(true);
      await expect(page.locator("#tour-list .chip.primary")).toBeFocused();
      await clean(page, problems);
    });

    test("closes with Escape what was opened last first, then the guide, and the keyboard is never left on nothing", async ({ page }) => {
      test.setTimeout(60_000);
      const problems = await open(page);
      const tour = page.locator("#tour");
      const palette = page.locator("#palette");
      const offer = page.locator("#toast").getByRole("button", { name: "Keep what I built" });
      const own = await state(page);
      await startLesson(page, "sounds");
      await onTask(page, "sounds", 0);
      // The palette is opened from the wheel, as the task asks.
      await page.locator("#kreisel").focus();
      await page.keyboard.press("p");
      await expect(palette).toBeVisible();
      await ticked(page, "sounds", 0);
      await onTask(page, "sounds", 1);
      expect((await guideOf(page)).mark).toEqual({ kind: "node", selector: "#palette" });

      // Escape with the keyboard inside the palette: the palette goes, the keyboard is on the sound's name that
      // opens it again, and the guide stays on its task.
      await palette.locator(".palette-row .chip:visible").first().focus();
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
      await expect(page.locator("#sound-pick")).toBeFocused();
      await expect(tour).toBeVisible();
      expect(await guideOf(page)).toMatchObject({ view: "task", lesson: "sounds", index: 1 });
      // The task is about the palette, which is closed now: the card says so and marks what opens it.
      await expect(hint(page)).toHaveText(/^The palette is closed/);
      expect((await guideOf(page)).mark).toEqual({ kind: "node", selector: "#sound-pick" });
      await expect.poll(() => inTheWay(page)).toEqual([]);
      // The keyboard's pointer on the wheel is put away before the guide, too.
      await page.locator("#kreisel").focus();
      await page.keyboard.press("ArrowRight");
      expect(await page.evaluate(() => window.kreisel.app.keyCursor)).not.toBeNull();
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => window.kreisel.app.keyCursor)).toBeNull();
      await expect(tour).toBeVisible();
      // With nothing else open, Escape puts the guide away. The lesson worked on a copy: the visitor's own Kreisel
      // is back, the page says so, and the keyboard is on what that message offers.
      await page.keyboard.press("Escape");
      await expect(tour).toBeHidden();
      expect((await guideOf(page)).view).toBe("off");
      expect(await state(page)).toBe(own);
      expect(await toastOf(page)).toMatch(OWN_IS_BACK);
      await expect(offer).toBeFocused();

      // With the keyboard on the card, Escape closes the guide at once, whatever else is open.
      await dismiss(page);
      await startLesson(page, "sounds");
      await onTask(page, "sounds", 0);
      await page.locator("#sound-pick").click();
      await expect(palette).toBeVisible();
      await goOn(page).focus();
      await page.keyboard.press("Escape");
      await expect(tour).toBeHidden();
      await expect(palette).toBeVisible();
      await expect(offer).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
      expect(await nobodyHasTheKeyboard(page)).toBe(false);
      await clean(page, problems);
    });

    test("closes at once with Escape from the card on a first visit, and the keyboard goes to the question mark", async ({ page }) => {
      const problems = await firstLook(page);
      await onTask(page, "first", 0);
      // A first visit, Tab into the card, Escape: closed, and the keyboard is on the question mark.
      await page.locator("#help-open").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("#tour-skip")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator("#tour")).toBeHidden();
      await expect(page.locator("#help-open")).toBeFocused();
      expect(await toastOf(page)).toMatch(WAITS);
      expect((await keptOf(page)).seen).toBe("1");
      await clean(page, problems);
    });

    test("gives the keyboard to the question mark, never to nothing, when the menu was opened with the mouse and its row picked with the keys", async ({ page }) => {
      const problems = await open(page);
      const menu = page.locator("#context");
      // The menu opened with a click; the arrows step into it, Enter takes the guide's row.
      await page.locator("#help-open").click();
      await expect(menu).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: /Guide/ })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#tour-title")).toHaveText("Lessons");
      expect(await keyboardOnCard(page)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator("#tour")).toBeHidden();
      expect(await nobodyHasTheKeyboard(page)).toBe(false);
      await expect(page.locator("#help-open")).toBeFocused();
      await clean(page, problems);
    });
  });

  test.describe("never in the way", () => {
    test("lies off the wheel, the status line and the place it names on every task, and the ring's panel still fits", async ({ page }) => {
      const problems = await firstLook(page);
      const wheelWidth = async (): Promise<number> => Math.round((await page.locator("#kreisel").boundingBox())!.width);
      await onTask(page, "first", 0);
      await expect.poll(() => inTheWay(page)).toEqual([]);
      const width = await wheelWidth();
      // The wheel stays large: the card takes a strip under it, not the wheel's room.
      expect(width).toBeGreaterThan(380);
      for (const index of [1, 2, 3, 4]) {
        await goOn(page).click();
        await onTask(page, "first", index);
        await expect.poll(() => inTheWay(page), { message: `first steps, step ${index + 1}` }).toEqual([]);
        await expect.poll(() => outOfReach(page), { message: `first steps, step ${index + 1}` }).toEqual([]);
      }
      await goOn(page).click();
      await ended(page, "first");
      await expect.poll(() => inTheWay(page), { message: "the end" }).toEqual([]);
      await expect.poll(() => outOfReach(page)).toEqual([]);

      // Two more lessons, task by task: one on the wheel and the list, one around the wheel.
      for (const id of ["beat", "live"]) {
        await chip(page, id).click();
        for (const index of tasksFor(lessonOf(id), false).keys()) {
          await onTask(page, id, index);
          await expect.poll(() => inTheWay(page), { message: `${id}, step ${index + 1}` }).toEqual([]);
          await expect.poll(() => outOfReach(page), { message: `${id}, step ${index + 1}` }).toEqual([]);
          await goOn(page).click();
        }
        await ended(page, id);
        await expect.poll(() => inTheWay(page), { message: `${id}, the end` }).toEqual([]);
        await expect.poll(() => outOfReach(page), { message: `${id}, the end` }).toEqual([]);
        if (id === "beat") await page.locator("#tour-mine").click();
      }
      // The list of lessons, with all seven.
      await page.locator("#tour-skip").click();
      await openList(page);
      await expect.poll(() => inTheWay(page), { message: "the list" }).toEqual([]);
      await expect.poll(() => outOfReach(page), { message: "the list" }).toEqual([]);

      // Once it is put away, the wheel has its room back.
      await page.locator("#tour-skip").click();
      await expect.poll(wheelWidth).toBeGreaterThan(width);
      await clean(page, problems);
    });

    test("is as tall whatever a task shows and at a lesson's end, so that the wheel keeps its size; the list of lessons is hardly taller", async ({ page }) => {
      test.setTimeout(60_000);
      const problems = await firstLook(page);
      interface Sizes { what: string; card: number; wheel: number }
      /** How tall the card is and how wide the wheel, once the card has its place. */
      const sizes = async (what: string): Promise<Sizes> => {
        await expect.poll(() => inTheWay(page), { message: what }).toEqual([]);
        return page.evaluate((name) => ({ what: name, card: Math.round(document.getElementById("tour")!.getBoundingClientRect().height * 10) / 10, wheel: Math.round(document.getElementById("kreisel")!.getBoundingClientRect().width) }), what);
      };
      const seen: Sizes[] = [];
      // A task while the Kreisel stands; one with the word that nothing plays; the same while it plays, and done.
      await onTask(page, "first", 0);
      seen.push(await sizes("step 1, while it stands"));
      await goOn(page).click();
      await onTask(page, "first", 1);
      await expect(hint(page)).toBeVisible();
      seen.push(await sizes("step 2, with the word that nothing plays"));
      await pressHub(page);
      await expect(hint(page)).toBeHidden();
      seen.push(await sizes("step 2, while it plays"));
      await page.locator("#tour-show").click();
      await ticked(page, "first", 1);
      seen.push(await sizes("step 2, done"));
      await goOn(page).click();
      // The other tasks, the last also with a near miss answered.
      for (const index of [2, 3, 4]) {
        await onTask(page, "first", index);
        seen.push(await sizes(`step ${index + 1}`));
        if (index === 4) {
          await pad(page, "stotter").click();
          await expect(hint(page)).toBeVisible();
          seen.push(await sizes("step 5, with a near miss answered"));
        }
        await goOn(page).click();
      }
      // The end of a lesson: with the lessons to go on with, and with the question whether what was made stays.
      await ended(page, "first");
      seen.push(await sizes("the end of the first steps"));
      await chip(page, "beat").click();
      await onTask(page, "beat", 0);
      await page.locator("#tour-show").click();
      await ticked(page, "beat", 0);
      await goOn(page).click();
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await goOn(page).click();
      }
      await ended(page, "beat");
      seen.push(await sizes("the end of Build a beat, with its question"));
      await page.locator("#tour-mine").click();
      await expect(page.locator("#tour-list .chip")).toHaveCount(6);
      seen.push(await sizes("the end of Build a beat, answered"));
      expect(seen).toEqual(seen.map((one) => ({ what: one.what, card: seen[0]!.card, wheel: seen[0]!.wheel })));

      // The list of lessons has all seven to show: it may be a little taller, and the wheel that much smaller.
      await openList(page);
      await expect(page.locator("#tour")).toHaveClass(/listing/);
      const list = await sizes("the list");
      await chip(page, "beat").hover();
      const pointed = await sizes("the list, with the pointer on a lesson");
      expect(pointed).toMatchObject({ card: list.card, wheel: list.wheel });
      expect(list.card - seen[0]!.card).toBeGreaterThanOrEqual(0);
      expect(list.card - seen[0]!.card).toBeLessThanOrEqual(12);
      expect(seen[0]!.wheel - list.wheel).toBeLessThanOrEqual(12);
      await clean(page, problems);
    });

    test("keeps the page's messages above itself, and under the row's band while the row is shown", async ({ page }) => {
      const problems = await open(page);
      /** How far the message and the card lie on one another (nothing, if they are apart), once the message has come to rest. */
      const overlap = async (): Promise<number> => {
        const read = (): Promise<number[]> =>
          page.evaluate(() => {
            const toast = document.getElementById("toast")!.getBoundingClientRect();
            const card = document.getElementById("tour")!.getBoundingClientRect();
            return [toast.top, toast.bottom, card.top, card.bottom];
          });
        await expect.poll(async () => {
          const first = await read();
          await page.waitForTimeout(120);
          return Math.abs((await read())[0]! - first[0]!);
        }).toBeLessThan(0.5);
        const [top, bottom, cardTop, cardBottom] = (await read()) as [number, number, number, number];
        return Math.max(0, Math.round((Math.min(bottom, cardBottom) - Math.max(top, cardTop)) * 10) / 10);
      };
      await startLesson(page, "live");
      await reached(page, "live", 0);
      // A short message lies above the card, not on it; its buttons can be pressed, and so can the card's.
      await page.locator("#lights-toggle").click();
      await expect(page.locator("#toast")).toContainText("Light show off.");
      const short = await overlap();
      await page.locator("#toast").getByRole("button", { name: "Close message" }).click({ trial: true });
      await expect.poll(() => outOfReach(page)).toEqual([]);
      // A long one, too.
      await page.locator("#lights-toggle").click();
      await expect(page.locator("#toast")).toContainText("Light show on:");
      const long = await overlap();
      await expect.poll(() => outOfReach(page)).toEqual([]);

      // With the row shown, the card lies above the row's band and the message is a slim one under it.
      await page.evaluate(() => {
        window.kreisel.app.scenes.setPlays("row");
        window.kreisel.app.dismiss();
      });
      await expect(page.locator("html")).toHaveAttribute("data-row");
      await expect.poll(() => inTheWay(page)).toEqual([]);
      await page.locator("#lights-toggle").click();
      await expect(page.locator("#toast")).toContainText("Light show off.");
      const slim = await overlap();
      await page.locator("#toast").getByRole("button", { name: "Close message" }).click({ trial: true });
      await expect.poll(() => outOfReach(page)).toEqual([]);
      await page.locator("#lights-toggle").click();
      expect({ short, long, slim }).toEqual({ short: 0, long: 0, slim: 0 });
      await clean(page, problems);
    });

    test("keeps the palette of sounds above itself, and its own buttons in reach beside it", async ({ page }) => {
      test.setTimeout(60_000);
      const problems = await open(page);
      /** How far the palette reaches below the card's upper edge (nothing, if it ends above the card). */
      const over = (): Promise<number> =>
        page.evaluate(() => Math.max(0, Math.round((document.getElementById("palette")!.getBoundingClientRect().bottom - document.getElementById("tour")!.getBoundingClientRect().top) * 10) / 10));
      const palette = page.locator("#palette");
      await startLesson(page, "sounds");
      await onTask(page, "sounds", 0);
      await page.locator("#sound-pick").click();
      await ticked(page, "sounds", 0);
      await onTask(page, "sounds", 1);
      await expect(palette).toBeVisible();
      // The palette is the place of this task: marked, and off the card.
      await expect.poll(() => inTheWay(page)).toEqual([]);
      // The card's buttons stay in reach while the palette is open, and every sound of the palette is in reach inside it.
      await expect.poll(() => outOfReach(page)).toEqual([]);
      await page.locator("#tour-show").click({ trial: true });
      await palette.locator(".palette-row .chip:visible").last().scrollIntoViewIfNeeded();
      await palette.locator(".palette-row .chip:visible").last().click({ trial: true });
      expect((await palette.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      const plain = await over();

      // With the row shown, the card lies above the row's band: the palette ends above it there as well.
      await page.evaluate(() => window.kreisel.app.scenes.setPlays("row"));
      await expect(page.locator("html")).toHaveAttribute("data-row");
      await expect(palette).toBeVisible();
      await expect.poll(() => outOfReach(page)).toEqual([]);
      await expect.poll(() => inTheWay(page)).toEqual([]);
      const withRow = await over();
      expect({ plain, withRow }).toEqual({ plain: 0, withRow: 0 });
      await clean(page, problems);
    });

    test("keeps the palette open when “Show me” is pressed for a task that happens in it", async ({ page }) => {
      const problems = await open(page);
      await startLesson(page, "sounds");
      await onTask(page, "sounds", 0);
      await page.locator("#sound-pick").click();
      await ticked(page, "sounds", 0);
      // "Next" is pressed on the card: the palette is not put away by that either.
      await goOn(page).click();
      await onTask(page, "sounds", 1);
      await expect(page.locator("#palette")).toBeVisible();
      const before = await soundsOf(page);
      await page.locator("#tour-show").click();
      await ticked(page, "sounds", 1);
      expect(await soundsOf(page)).not.toEqual(before);
      // The sound that was picked shows where it was picked.
      await expect(page.locator("#palette")).toBeVisible();
      await clean(page, problems);
    });

    test("lies in the window under the wheel for whoever asked for less motion, too", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const problems = await firstLook(page);
      await onTask(page, "first", 0);
      // Looked at as it came, before anything else happens on the page.
      await page.waitForTimeout(600);
      expect(await inTheWay(page)).toEqual([]);
      await goOn(page).click();
      await onTask(page, "first", 1);
      await page.waitForTimeout(300);
      expect(await inTheWay(page)).toEqual([]);
      await clean(page, problems);
    });

    test("works the same for whoever asked for less motion, and its mark stands still", async ({ page }) => {
      test.setTimeout(60_000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const problems = await firstLook(page);
      const words = await wordsOf(page, FIRST);
      /** The motions on the mark around a part of the page. */
      const moving = (): Promise<number> => page.evaluate(() => document.getElementById("tour-mark")!.getAnimations().filter((motion) => Number(motion.effect?.getComputedTiming().activeDuration ?? 0) > 1).length);
      await onTask(page, "first", 0);
      await page.locator("#kreisel").focus();
      await page.keyboard.press("Space");
      expect(await ticked(page, "first", 0)).toEqual(praising(FIRST, words, 0));
      // The wheel does not answer in light.
      expect(await page.evaluate(() => window.kreisel.light())).toMatchObject({ sparks: 0, waves: 0 });
      // The next task comes by itself all the same, and the mark around its place stands still.
      expect(await onTask(page, "first", 1)).toEqual(asking(FIRST, words, 1));
      await expect(page.locator("#tour-mark")).toBeVisible();
      expect(await moving()).toBe(0);
      await inRow(page, 0, "mute").click();
      await inRow(page, 0, "mute").click();
      await ticked(page, "first", 1);
      await goOn(page).click();
      await onTask(page, "first", 2);
      await page.locator("#tour-show").click();
      await ticked(page, "first", 2);
      await goOn(page).click();
      await onTask(page, "first", 3);
      await expect(page.locator("#tour-mark")).toBeVisible();
      expect(await moving()).toBe(0);
      // Its name in the sentence shows the place again without motion as well.
      await page.locator("#tour-text .guide-goto").click();
      expect(await moving()).toBe(0);
      expect(await page.evaluate(() => document.getAnimations().filter((motion) => Number(motion.effect?.getComputedTiming().activeDuration ?? 0) > 1).length)).toBe(0);
      await goOn(page).click();
      await onTask(page, "first", 4);
      await holdPad(page, "stotter");
      await ticked(page, "first", 4);
      await goOn(page).click();
      expect((await ended(page, "first")).text).toBe(FIRST.end);
      await clean(page, problems);
    });

    test("keeps all of its buttons in a window as small as 360 by 640", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      const problems = await firstLook(page);
      const sideways = (): Promise<number> => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
      for (const index of [0, 1, 2, 3, 4]) {
        await onTask(page, "first", index);
        // Here the card is a sheet along the foot of the window, and the place it names comes into view above it.
        await expect(page.locator("html")).toHaveAttribute("data-guide", "sheet");
        await atRest(page);
        await expect.poll(() => outOfReach(page), { message: `step ${index + 1}` }).toEqual([]);
        await expect.poll(() => inTheWayOfAFinger(page), { message: `step ${index + 1}` }).toEqual([]);
        expect(await sideways()).toBeLessThanOrEqual(0);
        await goOn(page).click();
      }
      await ended(page, "first");
      await expect.poll(() => outOfReach(page), { message: "the end" }).toEqual([]);
      // The list, with all seven lessons.
      await page.locator("#tour-skip").click();
      await page.evaluate(() => window.kreisel.app.guide.open());
      await expect(page.locator("#tour-list .chip")).toHaveCount(7);
      await expect.poll(() => outOfReach(page), { message: "the list" }).toEqual([]);
      expect(await sideways()).toBeLessThanOrEqual(0);
      // And the end of a lesson that asks a question.
      await chip(page, "beat").click();
      await onTask(page, "beat", 0);
      await page.locator("#tour-show").click();
      await ticked(page, "beat", 0);
      await goOn(page).click();
      for (const index of [1, 2, 3]) {
        await onTask(page, "beat", index);
        await goOn(page).click();
      }
      await ended(page, "beat");
      await expect(page.locator("#tour-keep")).toBeVisible();
      await expect.poll(() => outOfReach(page), { message: "the end of Build a beat" }).toEqual([]);
      await page.locator("#tour-mine").click();
      await clean(page, problems);
    });
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  /** Holds a finger on a point of the window for a while. */
  async function holdFinger(page: Page, x: number, y: number, ms: number): Promise<void> {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(ms);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  }
  const middleOf = async (page: Page, selector: string): Promise<{ x: number; y: number }> => {
    const box = (await page.locator(selector).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  /** What the card reads on a task for a finger: the sentence in a finger's words, and no line about keys. */
  const asksAFinger = (lesson: Chapter, words: readonly Words[], index: number, quiet = false): Card => ({ ...asking(lesson, words, index, quiet ? QUIET.touch : null), keys: "" });

  test("leads through the first steps by taps on a phone: the card is a sheet at the foot, and each place comes into view above it", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await firstLook(page);
    const words = await wordsOf(page, FIRST, true);
    const keys = page.locator("#tour-keys");
    /** The card is on this task: it speaks of taps, has no line about keys, and the place is in view above the sheet. */
    const arrive = async (index: number): Promise<void> => {
      expect(await onTask(page, "first", index), `step ${index + 1}`).toEqual(asksAFinger(FIRST, words, index));
      expect(words[index]!.text).not.toMatch(/[Cc]lick/);
      await expect(keys).toBeHidden();
      await atRest(page);
      await expect.poll(() => inTheWayOfAFinger(page), { message: `step ${index + 1}` }).toEqual([]);
      await expect.poll(() => outOfReach(page), { message: `step ${index + 1}` }).toEqual([]);
    };

    // It came by itself, as a sheet: nothing has the keyboard, nothing sounds.
    await arrive(0);
    expect(await page.evaluate(() => window.kreisel.app.guide.touch)).toBe(true);
    expect(await nobodyHasTheKeyboard(page)).toBe(true);
    expect(await playing(page)).toBe(false);
    await expect(page.locator("#tour")).toHaveClass(/sheet/);
    const hub = await middleOf(page, "#kreisel");
    await page.touchscreen.tap(hub.x, hub.y);
    expect(await ticked(page, "first", 0)).toEqual(praising(FIRST, words, 0));
    expect(await playing(page)).toBe(true);

    await arrive(1);
    await inRow(page, 0, "mute").tap();
    expect(await audible(page, 0)).toBe(false);
    await inRow(page, 0, "mute").tap();
    expect((await ticked(page, "first", 1)).count).toBe("Done");

    await arrive(2);
    await focus(page, 6);
    for (const step of [2, 6, 11]) {
      const spot = await where(page, 6, step);
      await page.touchscreen.tap(spot.x, spot.y);
    }
    expect((await ticked(page, "first", 2)).count).toBe("Done");
    expect(await hitsOf(page, 6)).toEqual([2, 6, 11]);

    await arrive(3);
    await page.locator(".sound-row").getByRole("button", { name: "Next sound" }).tap();
    expect((await ticked(page, "first", 3)).count).toBe("Done");

    await arrive(4);
    const stutter = await middleOf(page, '#fx [data-fx="stotter"]');
    await holdFinger(page, stutter.x, stutter.y, 900);
    expect((await ticked(page, "first", 4)).count).toBe("Done");

    const end = await ended(page, "first");
    expect(end).toMatchObject({ title: FIRST.name, count: "Done", text: FIRST.end, offers: others("first"), recommended: "beat", praised: true });
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await keptOf(page)).toEqual({ seen: "1", lessons: { done: ["first"], at: null } });
    // A finger's buttons: none of the card's is smaller than 44 px.
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#tour button")].filter((button) => button.getClientRects().length > 0 && button.getBoundingClientRect().height < 44).map((button) => button.textContent))).toEqual([]);
    // A finger has no pointer to rest on a lesson: what each is for stands on its chip.
    await expect(chip(page, "beat").locator(".promise")).toBeVisible();
    await expect(chip(page, "beat").locator(".promise")).toHaveText(lessonOf("beat").promise);
    await clean(page, problems);
  });

  test("goes on by itself on a phone after “Show me” was tapped, and says where it waits when it is put away", async ({ page }) => {
    const problems = await firstLook(page);
    const words = await wordsOf(page, FIRST, true);
    await onTask(page, "first", 0);
    await page.locator("#tour-show").tap();
    expect(await ticked(page, "first", 0)).toEqual(praising(FIRST, words, 0));
    // The next task comes when the words were read, although the finger was last on the card.
    expect(await onTask(page, "first", 1)).toEqual(asksAFinger(FIRST, words, 1));
    await page.locator("#tour-skip").tap();
    await expect(page.locator("#tour")).toBeHidden();
    // A phone has no question mark in its bar: the guide waits behind the three dots.
    expect(await toastOf(page)).toMatch(WAITS_ON_A_PHONE);
    await expect(page.locator("#toast")).toBeInViewport();
    await clean(page, problems);
  });

  test("is found in the menu on a phone, and leaves out what a finger cannot do", async ({ page }) => {
    const problems = await open(page);
    await openList(page, true);
    await expect(page.locator("#tour-list .chip")).toHaveCount(7);
    await expect(page.locator("html")).toHaveAttribute("data-guide", "sheet");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);

    // "Play it live" has a task that needs the right button of a mouse: a finger gets one task fewer.
    const lesson = lessonOf("live");
    const words = await wordsOf(page, lesson, true);
    expect(words).toHaveLength(lesson.tasks.length - 1);
    await chip(page, "live").tap();
    for (const index of words.keys()) {
      // Its tasks are about what is heard, and nothing plays: the card says so, in a finger's words.
      expect(await onTask(page, "live", index), `step ${index + 1}`).toEqual(asksAFinger(lesson, words, index, words[index]!.quiet));
      expect(`${words[index]!.text} ${QUIET.touch}`).not.toMatch(/[Cc]lick|space bar/);
      await expect(page.locator("#tour-keys")).toBeHidden();
      await atRest(page);
      await expect.poll(() => inTheWayOfAFinger(page), { message: `step ${index + 1}` }).toEqual([]);
      await expect.poll(() => outOfReach(page), { message: `step ${index + 1}` }).toEqual([]);
      await goOn(page).tap();
    }
    // Skipped through, it is not ticked.
    expect((await ended(page, "live")).praised).toBe(false);

    // The × puts it away; the menu brings the list back.
    await page.locator("#tour-skip").tap();
    await expect(page.locator("#tour")).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-guide");
    await openList(page, true);
    await expect(chip(page, "live")).not.toHaveClass(/finished/);
    await clean(page, problems);
  });

  test("keeps its × and its lessons within the window's width on a phone where lessons are picked", async ({ page }) => {
    const problems = await open(page);
    /** The card's buttons that reach past the window's sides. */
    const pastTheSides = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("#tour button")].filter((button) => button.getClientRects().length > 0).flatMap((button) => {
          const box = button.getBoundingClientRect();
          return box.left < -0.5 || box.right > window.innerWidth + 0.5 ? [`${button.id || button.dataset.lesson || "a button"}: from ${Math.round(box.left)} to ${Math.round(box.right)} of ${window.innerWidth}`] : [];
        }));
    /** Whether the × is in the window and nothing lies on it. */
    const closeInReach = (): Promise<boolean> =>
      page.evaluate(() => {
        const box = document.getElementById("tour-skip")!.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && top !== null && document.getElementById("tour-skip")!.contains(top);
      });
    const sideways = (): Promise<number> => page.evaluate(() => document.getElementById("tour")!.scrollWidth - document.getElementById("tour")!.clientWidth);
    await openList(page, true);
    await expect(page.locator("#tour-list .chip")).toHaveCount(7);
    // The lessons stand one under the other, each with what it is for, wrapped where it is long: nothing reaches
    // past the window's sides, and the sheet does not scroll sideways.
    expect(await pastTheSides()).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(1);
    await expect(chip(page, "sample").locator(".promise")).toHaveText(lessonOf("sample").promise);
    expect(await closeInReach()).toBe(true);
    await expect.poll(() => inTheWayOfAFinger(page).then((wrong) => wrong.filter((one) => /sheet|wider/.test(one)))).toEqual([]);
    // Seven lessons are more than the sheet is tall: it scrolls in itself, and its head with the × stays in view.
    await page.evaluate(() => { document.getElementById("tour")!.scrollTop = 10_000; });
    await expect(chip(page, "share")).toBeInViewport();
    expect(await closeInReach()).toBe(true);
    expect(await pastTheSides()).toEqual([]);
    // The same at the end of a lesson.
    await chip(page, "share").tap();
    await onTask(page, "share", 0);
    await goOn(page).tap();
    await onTask(page, "share", 1);
    await goOn(page).tap();
    await ended(page, "share");
    await expect(page.locator("#tour-list .chip")).toHaveCount(7);
    expect(await pastTheSides()).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(1);
    expect(await closeInReach()).toBe(true);
    await clean(page, problems);
  });

  test("lends the table to “Build a beat” on a phone and gives the Kreisel from before back", async ({ page }) => {
    const problems = await open(page);
    const lesson = lessonOf("beat");
    const words = await wordsOf(page, lesson, true);
    const own = await state(page);
    await openList(page, true);
    await chip(page, "beat").tap();
    expect(await onTask(page, "beat", 0)).toEqual(asksAFinger(lesson, words, 0, true));
    expect(await lending(page)).toBe(true);
    expect(await allHits(page)).toBe(0);
    await atRest(page);
    await expect.poll(() => inTheWayOfAFinger(page)).toEqual([]);
    await focus(page, 0);
    for (const step of [0, 4, 8, 12]) {
      const spot = await where(page, 0, step);
      await page.touchscreen.tap(spot.x, spot.y);
    }
    expect((await ticked(page, "beat", 0)).count).toBe("Done");
    expect(await hitsOf(page, 0)).toEqual([0, 4, 8, 12]);
    const built = await state(page);
    await page.locator("#tour-skip").tap();
    await expect(page.locator("#tour")).toBeHidden();
    expect(await lending(page)).toBe(false);
    expect(await state(page)).toBe(own);
    expect(await toastOf(page)).toMatch(OWN_IS_BACK);
    // The message's button is in reach of a finger, and brings back what was built.
    await page.locator("#toast").getByRole("button", { name: "Keep what I built" }).tap();
    expect(await state(page)).toBe(built);
    await clean(page, problems);
  });

  test("speaks of taps on a phone, never of clicks or of keys, also once a task was done", async ({ page }) => {
    const problems = await open(page);
    // Every sentence a finger gets in the seven lessons: the task, and what is said when it was done.
    const said = (await Promise.all(CHAPTERS.map((lesson) => wordsOf(page, lesson, true)))).flat().flatMap((words) => [words.text, words.after]);
    expect(said.length).toBeGreaterThan(40);
    expect([...said, QUIET.touch].filter((text) => /[Cc]lick|Shift|space bar|\bCtrl\b/.test(text))).toEqual([]);
    await clean(page, problems);
  });
});
