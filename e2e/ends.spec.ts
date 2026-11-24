import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onPhone, open, pieceOf } from "./helpers";

/*
 * The ends of the phrases (the last kick left out, a crash on the one, a
 * cymbal played backwards) and effect marks (one of the five live effects
 * laid on a bar of the piece). Both are set from the piece's panel and its
 * menu; what they do is measured on short pieces, rendered faster than they
 * play.
 */

const menuOf = (page: Page) => page.locator("#context");
const over = (now: number, before: number): number => 20 * Math.log10(Math.max(now, 1e-9) / Math.max(before, 1e-9));
const colour = (page: Page, at: { x: number; y: number }): Promise<number[]> =>
  page.evaluate((point) => {
    const canvas = document.getElementById("kreisel") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    return Array.from(canvas.getContext("2d")!.getImageData(Math.round((point.x - box.left) * scale), Math.round((point.y - box.top) * scale), 1, 1).data);
  }, at);

/**
 * A techno piece of eight bars at the top, without build-ups, measured in sixteenths. With `solo` only that ring is
 * heard, dry and without the Nachbeben; with −1 no ring is heard at all. `setup` lays what is to be measured.
 */
const hear = (page: Page, solo: number, setup: string) => page.evaluate(async ([ring, code]) => {
  const app = window.kreisel.app;
  window.plainTechno();
  app.setGlobal({ pressure: 0 });
  app.rumble.shape(-1);
  for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== ring, hall: 0, echo: 0, ...(track === ring ? { level: 0.3 } : {}) });
  app.store.edit((project) => {
    const line = Array.from({ length: 8 }, () => 31);
    project.piece = { on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6] };
  });
  new Function("app", code)(app);
  return window.kreisel.beats(4);
}, [solo, setup] as const);
/** The loudest sixteenth among steps `from` up to `to` of bar `bar`. */
const most = (parts: { loud: number }[], bar: number, from: number, to: number): number => Math.max(...parts.slice(bar * 16 + from, bar * 16 + to).map((part) => part.loud));
const mean = (parts: { loud: number; deep: number; sharp: number }[], bar: number, what: "loud" | "deep" | "sharp"): number => {
  const part = parts.slice(bar * 16, bar * 16 + 16);
  return what === "sharp" ? part.reduce((sum, beat) => sum + beat.sharp * beat.loud ** 2, 0) / Math.max(1e-12, part.reduce((sum, beat) => sum + beat.loud ** 2, 0)) : Math.sqrt(part.reduce((sum, beat) => sum + beat[what] ** 2, 0) / part.length);
};

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("sets the phrase ends in the piece's panel and lays effects on a bar", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.plainTechno();
      window.kreisel.app.store.edit((project) => { project.piece.on = true; });
      window.kreisel.app.dismiss();
    });
    await focusPiece(page);
    const button = page.locator("#piece-ends");
    const menu = menuOf(page);
    await expect(button).toHaveText("Phrase ends ▾");
    await button.click();
    await expect(menu).toContainText("Phrase ends");
    expect(await menu.evaluate((node) => { const box = node.getBoundingClientRect(); return node.scrollHeight <= node.clientHeight + 1 && box.top >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth; })).toBe(true);
    await menu.getByRole("menuitemcheckbox", { name: /^Last kick left out/ }).click();
    await menu.getByRole("menuitemradio", { name: /every 16 bars/ }).click();
    await menu.getByRole("menuitemcheckbox", { name: /^Backwards cymbal/ }).click();
    await expect(button).toHaveText("Phrase ends: 3 ▾");
    expect((await pieceOf(page)).ends).toEqual({ kick: true, crash: 16, swell: true });
    // The fills are in the same list, and the chip beside the button follows.
    await menu.getByRole("menuitemcheckbox", { name: /^Fills/ }).click();
    await expect(page.locator("#piece-vary")).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveText("Phrase ends: 4 ▾");
    await menu.getByRole("menuitemradio", { name: /every 32 bars/ }).click();
    await menu.getByRole("menuitemcheckbox", { name: /^Last kick left out/ }).click();
    await button.click();
    await expect(menu).toBeHidden();
    expect((await pieceOf(page)).ends).toEqual({ kick: false, crash: 32, swell: true });
    // The piece's panel still fits on this screen.
    expect(await page.evaluate(() => { const panel = document.getElementById("panel")!; return panel.scrollHeight - panel.clientHeight <= 2; })).toBe(true);

    // Effects on a bar: the right button's menu has the five as switches, and the ring gets a dot there.
    const spot = await page.evaluate(() => window.kreisel.mark(30));
    const before = await colour(page, spot);
    const bar = await barAt(page, 30, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await expect(menu).toContainText("Piece · bar 31");
    const effect = (name: RegExp) => menu.getByRole("menuitemradio", { name });
    await effect(/^Stutter/).click();
    await effect(/^Echo/).click();
    await expect(effect(/^Stutter/)).toHaveAttribute("aria-checked", "true");
    await expect(effect(/^Dull/)).toHaveAttribute("aria-checked", "false");
    expect((await pieceOf(page)).marks).toEqual([{ bar: 30, fx: 12 }]);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await colour(page, spot)).join()).not.toBe(before.join());
    await page.mouse.move(bar.x, bar.y);
    await expect(page.locator("#tip")).toContainText("Effect: Stutter, Echo");
    // The piece's menu leads to the phrase ends too.
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menu.getByRole("menuitem", { name: /^Phrase ends: 3/ }).click();
    await expect(menu.getByRole("menuitemradio", { name: /every 32 bars/ })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // The link carries both in the piece's eighth part, and they are there again after a reload.
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { z: unknown[] };
    expect(state.z[7]).toEqual({ e: 4 | 8, m: [30, 12] });
    const kept = await pieceOf(page);
    await page.evaluate(() => window.kreisel.app.store.save());
    await page.reload();
    await expect(page.locator("#status")).toContainText("Melody");
    expect(await pieceOf(page)).toEqual(kept);
    // Taking the effects away again takes the dot away.
    await page.evaluate(() => { window.kreisel.app.piece.toggleMark(30, 4); window.kreisel.app.piece.toggleMark(30, 8); });
    expect((await pieceOf(page)).marks).toBeUndefined();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("plays the phrase ends: the last kick is left out, a crash falls on the one, a cymbal swells in backwards", async ({ page }) => {
    // Three renders of eight bars.
    test.setTimeout(120_000);
    const problems = await open(page);
    // The kick by itself: in the last bar of the phrase its last beat is empty, in the bar before it is not.
    const kick = await hear(page, 0, "app.piece.setEnds({ kick: true });");
    expect(most(kick, 6, 12, 14)).toBeGreaterThan(0.02);
    expect(most(kick, 7, 13, 16)).toBeLessThan(most(kick, 6, 12, 14) * 0.2);
    expect(most(kick, 7, 8, 10)).toBeGreaterThan(0.02);
    // No ring at all: only what the ends of the phrases play is heard. A crash on the very first beat …
    const ends = await hear(page, -1, "app.piece.setEnds({ crash: 16, swell: true });");
    expect(most(ends, 0, 0, 2)).toBeGreaterThan(0.01);
    expect(most(ends, 3, 0, 16)).toBeLessThan(0.0005);
    // … and a cymbal that swells through the second half of the eighth bar, loudest right before the next phrase.
    expect(most(ends, 7, 0, 7)).toBeLessThan(0.0005);
    expect(most(ends, 7, 14, 16)).toBeGreaterThan(0.005);
    expect(most(ends, 7, 14, 16)).toBeGreaterThan(most(ends, 7, 9, 11) * 2);
    // Without them nothing is heard.
    const nothing = await hear(page, -1, "");
    expect(Math.max(...nothing.map((part) => part.loud))).toBeLessThan(0.0005);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("plays the effects that lie on a bar: Dull, Thin, Stutter, Echo and Pause", async ({ page }) => {
    // Four renders of eight bars.
    test.setTimeout(150_000);
    const problems = await open(page);
    // Dumpf on the third bar: the bass is far less sharp there, and what it was in the bars around it.
    const bass = await hear(page, 4, "app.piece.toggleMark(2, 1);");
    expect(mean(bass, 2, "sharp")).toBeLessThan(mean(bass, 1, "sharp") * 0.7);
    expect(Math.abs(mean(bass, 4, "sharp") / mean(bass, 1, "sharp") - 1)).toBeLessThan(0.15);
    // On the kick: Dünn on the third bar takes its lows, Stotter on the fifth empties its second half (the two
    // steps it repeats have no kick), Pause on the seventh empties its last beat.
    const kick = await hear(page, 0, "app.piece.toggleMark(2, 2); app.piece.toggleMark(4, 4); app.piece.toggleMark(6, 16);");
    expect(over(mean(kick, 2, "deep"), mean(kick, 1, "deep"))).toBeLessThan(-10);
    expect(Math.abs(over(mean(kick, 3, "deep"), mean(kick, 1, "deep")))).toBeLessThan(1.5);
    expect(most(kick, 4, 0, 6)).toBeGreaterThan(0.02);
    expect(most(kick, 4, 10, 16)).toBeLessThan(most(kick, 4, 0, 6) * 0.2);
    expect(most(kick, 5, 8, 16)).toBeGreaterThan(0.02);
    expect(most(kick, 6, 8, 10)).toBeGreaterThan(0.02);
    expect(most(kick, 6, 13, 16)).toBeLessThan(most(kick, 6, 8, 10) * 0.2);
    expect(most(kick, 7, 12, 14)).toBeGreaterThan(0.02);
    // Echo on the fourth bar: the snare's last beat rings on into the fifth, where the dry snare has silence between its hits.
    const quietest = (parts: { loud: number }[], bar: number): number => Math.min(...parts.slice(bar * 16, bar * 16 + 8).map((part) => part.loud));
    const dry = await hear(page, 1, "");
    const thrown = await hear(page, 1, "app.piece.toggleMark(3, 8);");
    expect(over(quietest(thrown, 4), quietest(dry, 4))).toBeGreaterThan(10);
    expect(Math.abs(over(quietest(thrown, 2), quietest(dry, 2)))).toBeLessThan(1);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("leaves the fill out too under a “Pause”: the last beat of the bar is empty", async ({ page }) => {
    // Two renders of eight bars.
    test.setTimeout(90_000);
    const problems = await open(page);
    // The fill at the end of a phrase: a kick more in the second half of the last beat, where the bar before has only the last kick ringing out.
    const fill = await hear(page, 0, "app.piece.toggleVary();");
    expect(most(fill, 7, 14, 16)).toBeGreaterThan(most(fill, 6, 14, 16) * 2);
    // A pause laid on that bar empties its last beat, and the fill stays out with everything else.
    const paused = await hear(page, 0, "app.piece.toggleVary(); app.piece.toggleMark(7, 16);");
    expect(most(paused, 7, 8, 10)).toBeGreaterThan(0.02);
    expect(most(paused, 7, 13, 16)).toBeLessThan(most(paused, 7, 8, 10) * 0.2);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
