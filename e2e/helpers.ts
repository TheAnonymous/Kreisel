import { readFileSync } from "node:fs";
import { expect, type Download, type Page } from "@playwright/test";
import { serialize } from "../src/codec";
import { factoryProject } from "../src/model";
import { readOggOpus } from "../src/ogg";
import { STORAGE_KEY } from "../src/store";

/*
 * What the browser tests share. They look at the built app behind the preview
 * server, which sends the production Content-Security-Policy: whatever the
 * live site would block fails here.
 *
 * There is a file a subject. In each, the tests "am Laptop" are for mouse and
 * keyboard and the tests "am Handy" for a finger; Firefox takes a second look
 * at what it can (see playwright.config.ts, which picks by these names).
 */

declare global {
  interface Window {
    cspViolations: string[];
  }
}

/** The Werks-Kreisel as the browser keeps a Kreisel. Most tests begin with it on the table, as if it had been loaded from the menu. */
const WERK = serialize(factoryProject());

/** Collects what goes wrong on the page: errors, and whatever the Content-Security-Policy blocks. */
async function watch(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return problems;
}

/**
 * Opens the Kreisel as someone who has been here before, with the Werks-Kreisel on the table;
 * with `firstVisit`, as someone who has not seen the tour yet (then it comes).
 */
export async function open(page: Page, path = "./", firstVisit = false): Promise<string[]> {
  const problems = await watch(page);
  await page.addInitScript(([seen, key, werk]) => {
    if (seen) localStorage.setItem("kreisel.hinweis", "1");
    // Only where nothing is kept yet: after a reload the page has to find what the test left.
    if (localStorage.getItem(key) === null) localStorage.setItem(key, werk);
  }, [!firstVisit, STORAGE_KEY, WERK] as const);
  await page.goto(path);
  await expect(page.locator("#status")).toContainText("Schläge");
  return problems;
}

/** Opens the Kreisel as on a very first visit: nothing is kept in the browser, so the techno Kreisel is on the table and the tour comes. */
export async function firstLook(page: Page): Promise<string[]> {
  const problems = await watch(page);
  await page.goto("./");
  await expect(page.locator("#status")).toContainText("Melodie");
  return problems;
}

export const status = (page: Page) => page.locator("#status");
export const state = (page: Page): Promise<string> => page.evaluate(() => window.kreisel.state());
export const where = (page: Page, track: number, step: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([ring, at]) => window.kreisel.where(ring ?? 0, at ?? 0), [track, step]);

/** Picks a ring and waits until it has grown to its full width. */
export async function focus(page: Page, track: number): Promise<void> {
  await page.evaluate((ring) => window.kreisel.app.select(ring), track);
  await expect.poll(async () => {
    const first = await where(page, track, 0);
    await page.waitForTimeout(80);
    const second = await where(page, track, 0);
    return Math.abs(first.y - second.y);
  }).toBeLessThan(0.05);
}

/** Where a point of the open paint box is on the page (time and height, both 0..1). */
export const sheet = (page: Page, t: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([time, height]) => window.kreisel.sheet(time ?? 0, height ?? 0), [t, y]);

/** One stroke of the brush through the given points. */
export async function paint(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  const start = await sheet(page, first[0], first[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of rest) {
    const spot = await sheet(page, point[0], point[1]);
    await page.mouse.move(spot.x, spot.y, { steps: 5 });
  }
  await page.mouse.up();
}

/** Picks a ready-made sound of the ring in focus by its name, in the palette, and puts the palette away again. */
export async function pickSound(page: Page, name: string): Promise<void> {
  const palette = page.locator("#palette");
  if (!(await palette.isVisible())) await page.locator("#sound-pick").click();
  await palette.getByRole("button", { name, exact: true }).click();
  await page.locator("#palette-done").click();
  await expect(palette).toBeHidden();
}

export const bodyOf = (page: Page, track: number) => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.body, track);
export const voiceOf = (page: Page, track: number) => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.voice, track);
/** Where a place on the body on the workbench is on the page (0 its middle, 1 its edge). */
export const knockAt = (page: Page, where: number): Promise<{ x: number; y: number }> => page.evaluate((place) => window.kreisel.knock(place), where);

/** What a saved Opus file says about itself, and what the browser hears when it decodes it. */
export async function heard(page: Page, download: Download): Promise<{ seconds: number; channels: number; ended: boolean; decoded: number; peak: number; bytes: number }> {
  const bytes = readFileSync(await download.path());
  const file = readOggOpus(bytes);
  expect(file).not.toBeNull();
  const decoded = await page.evaluate(async (data) => {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(Uint8Array.from(data).buffer);
    let peak = 0;
    for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
    await context.close();
    return { seconds: buffer.duration, peak };
  }, [...bytes]);
  return { seconds: file!.samples / 48_000, channels: file!.channels, ended: file!.ended, decoded: decoded.seconds, peak: decoded.peak, bytes: bytes.length };
}

export const bildOf = (page: Page, track: number) => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.bild, track);
export const soundOf = (page: Page, track: number): Promise<number> => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.sound, track);

/** Where a bar of the piece's ring is on the page, at a tension of 0..1. */
export const barAt = (page: Page, bar: number, height: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([index, share]) => window.kreisel.bar(index ?? 0, share ?? 0), [bar, height]);
export const pieceOf = (page: Page) => page.evaluate(() => window.kreisel.app.project.piece);

/** Puts the piece's ring in focus and waits until it has grown to its full width. */
export async function focusPiece(page: Page): Promise<void> {
  await page.evaluate(() => window.kreisel.app.piece.focus());
  // The rim stays where it is while the ring grows inwards: it is the foot of the bars that has to come to rest.
  await expect.poll(async () => {
    const first = await barAt(page, 0, 0);
    await page.waitForTimeout(80);
    const second = await barAt(page, 0, 0);
    const rim = await barAt(page, 0, 1);
    return Math.abs(first.y - second.y) + (second.y > rim.y ? 0 : 1);
  }).toBeLessThan(0.05);
}

/** For `test.skip`: on a phone, where there is neither mouse nor keyboard. */
export const onPhone = ({ isMobile }: { isMobile: boolean }): boolean => isMobile;
/** For `test.skip`: on a laptop, where there is no finger. */
export const onLaptop = ({ isMobile }: { isMobile: boolean }): boolean => !isMobile;

/** Opens the menu under one of the bar's buttons and presses the row with this name. */
export async function fromBar(page: Page, opener: "kreisel-menu" | "sound" | "share" | "record-more" | "help-open" | "more", row: string | RegExp): Promise<void> {
  await page.locator(`#${opener}`).click();
  await page.locator("#context").getByRole("menuitem", { name: row }).click();
}

/** "Teilen", then "Link kopieren". */
export const copyLink = (page: Page): Promise<void> => fromBar(page, "share", /Link kopieren/);
/** "Teilen", then Reihum: the window with the turns. */
export const openRelay = (page: Page): Promise<void> => fromBar(page, "share", /Reihum/);
