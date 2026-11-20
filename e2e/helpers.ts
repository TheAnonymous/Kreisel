import { readFileSync } from "node:fs";
import { expect, type Download, type Page } from "@playwright/test";
import { readOggOpus } from "../src/ogg";

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

/** Opens the Kreisel as someone who has been here before; with `firstVisit`, as someone who has not (then the tour comes). */
export async function open(page: Page, path = "./", firstVisit = false): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await page.addInitScript((seen) => {
    if (seen) localStorage.setItem("kreisel.hinweis", "1");
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  }, !firstVisit);
  await page.goto(path);
  await expect(page.locator("#status")).toContainText("Schläge");
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
  await expect.poll(async () => {
    const first = await barAt(page, 0, 1);
    await page.waitForTimeout(80);
    const second = await barAt(page, 0, 0);
    const third = await barAt(page, 0, 1);
    return Math.abs(first.y - third.y) + (second.y > third.y ? 0 : 1);
  }).toBeLessThan(0.05);
}

/** For `test.skip`: on a phone, where there is neither mouse nor keyboard. */
export const onPhone = ({ isMobile }: { isMobile: boolean }): boolean => isMobile;
/** For `test.skip`: on a laptop, where there is no finger. */
export const onLaptop = ({ isMobile }: { isMobile: boolean }): boolean => !isMobile;
