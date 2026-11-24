import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onLaptop, onPhone, open, pieceOf, status } from "./helpers";

/*
 * The roster ("Roster"): with the piece in focus and its second tool in
 * hand, the seven rings show the whole piece, a ring is filled where it
 * plays, and a click turns a phrase of eight bars around. What the piece then
 * plays is measured on short pieces, rendered faster than they play.
 */

const PHRASES = 14;
const none = "0".repeat(PHRASES);
/** One digit a phrase for a ring: 0 the tension decides, 1 it plays, 2 it rests (for the kick, a break). */
const laid = (page: Page, ring: number): Promise<string> =>
  page.evaluate((track) => {
    const piece = window.kreisel.app.project.piece;
    const phrases = Math.ceil(piece.tension.length / 8);
    return Array.from({ length: phrases }, (_, phrase) => (track === 0 && piece.noKick?.[phrase * 8] ? 2 : (piece.roster?.[track]?.[phrase * 8] ?? 0))).join("");
  }, ring);
/** The same with the phrases at `at` set to `state`. */
const with_ = (state: number, ...at: number[]): string => Array.from(none, (digit, phrase) => (at.includes(phrase) ? String(state) : digit)).join("");
const lane = (page: Page, ring: number, bar: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([track, index]) => window.kreisel.lane(track ?? 0, index ?? 0), [ring, bar]);
const click = async (page: Page, ring: number, bar: number, button: "left" | "right" = "left"): Promise<void> => {
  const at = await lane(page, ring, bar);
  await page.mouse.click(at.x, at.y, { button });
};
/** What the wheel shows at a ring's lane in a bar: the colour of the canvas there. */
const paint = (page: Page, ring: number, bar: number): Promise<number[]> =>
  page.evaluate(([track, index]) => {
    const canvas = document.getElementById("kreisel") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const at = window.kreisel.lane(track ?? 0, index ?? 0);
    const scale = canvas.width / box.width;
    return Array.from(canvas.getContext("2d")!.getImageData(Math.round((at.x - box.left) * scale), Math.round((at.y - box.top) * scale), 1, 1).data);
  }, [ring, bar]);
const tool = (page: Page, name: string) => page.locator("#piece-tools").getByRole("radio", { name });
/** The plain techno Kreisel, whose piece has 112 bars (a break in bars 49 to 64), the piece in focus. */
async function technoPiece(page: Page): Promise<string[]> {
  const problems = await open(page);
  await page.evaluate(() => { window.plainTechno(); window.kreisel.app.dismiss(); });
  await focusPiece(page);
  return problems;
}

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("shows the whole piece in the seven rings with the tool “Roster”, and a click switches a phrase", async ({ page }) => {
    const problems = await technoPiece(page);
    const teal = [39, 167, 156];
    const near = (color: number[], want: number[]): boolean => color[3]! > 200 && Math.abs(color[0]! - want[0]!) + Math.abs(color[1]! - want[1]!) + Math.abs(color[2]! - want[2]!) < 70;

    // The piece has two tools of its own beside the wheel; the ring tools are put away meanwhile.
    await expect(page.locator("#piece-tools")).toBeVisible();
    await expect(page.locator("#tools")).toBeHidden();
    await expect(tool(page, "Tension")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#piece-roster")).toBeHidden();
    await tool(page, "Roster").click();
    await expect(tool(page, "Roster")).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => window.kreisel.app.piece.laying)).toBe(true);
    await expect(page.locator("#piece-roster")).toBeVisible();
    await expect(page.locator("#panel")).toContainText("filled means the ring plays there");
    expect(await page.evaluate(() => { const panel = document.getElementById("panel")!; return panel.scrollHeight - panel.clientHeight; })).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A ring is filled where it plays: the bass in bar 21, where the tension has reached it, and not in bar 13.
    await expect.poll(async () => near(await paint(page, 4, 20), teal)).toBe(true);
    expect((await paint(page, 4, 12))[3]).toBeLessThan(90);
    // The techno Kreisel's break is the kick resting, and nothing else is laid.
    expect(await laid(page, 0)).toBe(with_(2, 6, 7));
    expect((await pieceOf(page)).roster).toBeUndefined();

    // A click where the tension has not reached the ring lays it in for the eight bars; the wheel shows it, and the pointer is told.
    await click(page, 4, 12);
    expect(await laid(page, 4)).toBe(with_(1, 1));
    await expect.poll(async () => near(await paint(page, 4, 12), teal)).toBe(true);
    expect(near(await paint(page, 4, 9), teal)).toBe(true);
    expect((await paint(page, 4, 6))[3]).toBeLessThan(90);
    const at = await lane(page, 4, 12);
    await page.mouse.move(at.x + 1, at.y + 1);
    await expect(page.locator("#tip")).toHaveText("Bass · bars 9 to 16: plays although the tension is not there yet");
    // A second click gives it back to the tension, and nothing is left of it.
    await click(page, 4, 12);
    expect((await pieceOf(page)).roster).toBeUndefined();
    await expect.poll(async () => (await paint(page, 4, 12))[3]!).toBeLessThan(90);

    // A click where the ring plays lays it out; it is pale there, since the tension would let it play.
    await click(page, 2, 66);
    expect(await laid(page, 2)).toBe(with_(2, 8));
    await expect.poll(async () => { const color = await paint(page, 2, 66); return color[3]! > 30 && color[3]! < 160; }).toBe(true);
    await page.keyboard.press("Control+z");
    expect(await laid(page, 2)).toBe(none);

    // The kick laid out is a break, kept where a break always was; a click on the break gives the kick back.
    await click(page, 0, 20);
    expect((await pieceOf(page)).noKick?.slice(16, 24)).toEqual(Array.from({ length: 8 }, () => true));
    expect((await pieceOf(page)).roster).toBeUndefined();
    await expect(page.locator("#panel")).toContainText("24 bars of break");
    await click(page, 0, 20);
    expect(await laid(page, 0)).toBe(with_(2, 6, 7));

    // "Tension" shows the rings' steps again, and a click on a ring picks the ring.
    await tool(page, "Tension").click();
    expect(await page.evaluate(() => window.kreisel.app.piece.laying)).toBe(false);
    await click(page, 4, 12);
    expect((await pieceOf(page)).roster).toBeUndefined();
    expect(await page.evaluate(() => [window.kreisel.app.piece.focused, window.kreisel.app.selected])).toEqual([false, 4]);
    await expect(page.locator("#tools")).toBeVisible();
    await expect(page.locator("#piece-tools")).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("lays several phrases and rings with one stroke, and the right button shows all seven rings of the phrase", async ({ page }) => {
    const problems = await technoPiece(page);
    const menu = page.locator("#context");
    await tool(page, "Roster").click();

    // A stroke along a ring: every phrase it comes over gets what the first click made, and all of it is one step back.
    let from = await lane(page, 5, 34);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (const bar of [38, 42, 46, 50, 54]) {
      const to = await lane(page, 5, bar);
      await page.mouse.move(to.x, to.y, { steps: 4 });
    }
    await page.mouse.up();
    expect(await laid(page, 5)).toBe(with_(2, 4, 5, 6));
    await page.keyboard.press("Control+z");
    expect((await pieceOf(page)).roster).toBeUndefined();

    // A stroke across the rings takes each of them along.
    from = await lane(page, 1, 84);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (const ring of [2, 3]) {
      const to = await lane(page, ring, 84);
      await page.mouse.move(to.x, to.y, { steps: 4 });
    }
    await page.mouse.up();
    expect([await laid(page, 1), await laid(page, 2), await laid(page, 3), await laid(page, 4)]).toEqual([with_(2, 10), with_(2, 10), with_(2, 10), none]);
    await page.keyboard.press("Control+z");

    // The right button: all seven rings of the phrase, each with its three states.
    await click(page, 2, 66, "right");
    await expect(menu.locator("header")).toHaveText("Piece · bars 65 to 72");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(21);
    const state = (ring: string, what: string) => menu.getByRole("menuitemradio", { name: `${ring}: ${what}` });
    await expect(state("Hi-Hat", "the tension decides in these bars")).toHaveAttribute("aria-checked", "true");
    await state("Hi-Hat", "rests in these bars").click();
    expect(await laid(page, 2)).toBe(with_(2, 8));
    await expect(menu).toBeVisible();
    await expect(state("Hi-Hat", "rests in these bars")).toHaveAttribute("aria-checked", "true");
    await state("Hi-Hat", "plays in these bars, whatever the tension says").click();
    expect(await laid(page, 2)).toBe(with_(1, 8));
    await state("Hi-Hat", "the tension decides in these bars").click();
    expect((await pieceOf(page)).roster).toBeUndefined();
    // The kick has the same three; laid out it is the break.
    await state("Kick", "rests in these bars").click();
    expect(await laid(page, 0)).toBe(with_(2, 6, 7, 8));
    await state("Kick", "the tension decides in these bars").click();
    expect(await laid(page, 0)).toBe(with_(2, 6, 7));

    // Every ring at once for these bars, and back; and playing from the phrase.
    await menu.getByRole("menuitem", { name: "All play in these bars" }).click();
    for (let ring = 0; ring < 7; ring += 1) expect(await laid(page, ring)).toBe(ring === 0 ? "00000022100000" : with_(1, 8));
    await menu.getByRole("menuitem", { name: "All by the tension" }).click();
    expect((await pieceOf(page)).roster).toBeUndefined();
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Play from here" }).click();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.kreisel.app.piece.start)).toBe(64);
    await page.locator("#play").click();

    // The whole piece from the panel: all rings play (the place to take away from), or the tension alone decides again.
    await page.locator("#roster-fill").click();
    for (let ring = 0; ring < 7; ring += 1) expect(await laid(page, ring)).toBe("1".repeat(PHRASES));
    expect((await pieceOf(page)).noKick).toBeUndefined();
    await expect(page.locator("#toast")).toContainText("All rings now play through the whole piece");
    await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
    expect(await laid(page, 0)).toBe(with_(2, 6, 7));
    await click(page, 2, 66);
    await page.locator("#roster-clear").click();
    // Nothing is laid any more. The drop in bar 65 stays one without the break (the tension jumps there too), and keeps its build-up.
    expect(Object.keys(await pieceOf(page))).toEqual(["on", "tension", "scenes", "order", "drops"]);
    await expect(page.locator("#toast")).toContainText("The breaks are gone too");
    await page.keyboard.press("Control+z");
    expect([await laid(page, 0), await laid(page, 2)]).toEqual([with_(2, 6, 7), with_(2, 8)]);

    // On the piece's own ring the right button is what it was.
    const bar = await barAt(page, 20, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Piece · bar 21");
    await page.keyboard.press("Escape");
    expect(problems).toEqual([]);
  });

  test("can be laid with the keyboard, and the link carries it", async ({ page }) => {
    const problems = await technoPiece(page);
    const menu = page.locator("#context");
    // W takes the second tool; the arrows go from phrase to phrase and from ring to ring, Enter turns the phrase around.
    await page.keyboard.press("w");
    await expect(tool(page, "Roster")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await page.evaluate(() => [window.kreisel.app.piece.key, window.kreisel.app.piece.lane])).toEqual([8, 2]);
    await expect(status(page)).toHaveText("Hi-Hat · bars 9 to 16: plays by the tension");
    await page.keyboard.press("Enter");
    expect(await laid(page, 2)).toBe(with_(2, 1));
    await expect(status(page)).toHaveText("Hi-Hat · bars 9 to 16: rests although the tension is there");
    // Plus and minus are the tension's and do nothing here; K makes the break as it does on the piece's ring.
    const before = (await pieceOf(page)).tension.join();
    await page.keyboard.press("+");
    expect((await pieceOf(page)).tension.join()).toBe(before);
    await page.keyboard.press("k");
    expect(await laid(page, 0)).toBe(with_(2, 1, 6, 7));
    await page.keyboard.press("k");

    // The menu key opens the phrase's menu at the keyboard's place.
    await page.keyboard.press("ContextMenu");
    await expect(menu.locator("header")).toHaveText("Piece · bars 9 to 16");
    await page.keyboard.press("Escape");

    // What is laid travels with the Kreisel: as the sixth part of the piece, and across a reload.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    expect(await laid(page, 4)).toBe(with_(1, 0));
    const packed = await page.evaluate(() => (JSON.parse(window.kreisel.state()) as { z: unknown[] }).z);
    // The roster is the sixth part; after it comes the build-up that the drop out of the break has of its own.
    expect(packed).toHaveLength(7);
    expect(packed[5]).toEqual(["", "", expect.any(String), "", expect.any(String)]);
    const kept = await pieceOf(page);
    await page.evaluate(() => window.kreisel.app.store.save());
    await page.reload();
    // The techno Kreisel's melody is empty: its status line says so once the page is up again.
    await expect(status(page)).toContainText("Melody");
    expect(await pieceOf(page)).toEqual(kept);

    // Q is the first tool again; there the arrows are bars and Enter plays from the bar.
    await page.evaluate(() => window.kreisel.app.piece.focus());
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    await expect(tool(page, "Tension")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.kreisel.app.piece.key)).toBe(0);
    expect(problems).toEqual([]);
  });

  test("plays what is laid: a ring rests despite the tension and plays without it, and then in full", async ({ page }) => {
    test.slow();
    const problems = await open(page);
    // A techno piece of eight bars at one tension; `solo` is the one ring that is heard, `state` what is laid on it.
    const hear = (solo: number, tension: number, state: number) => page.evaluate(async ([ring, level, lay]) => {
      const app = window.kreisel.app;
      window.plainTechno();
      app.setGlobal({ pressure: 0 });
      for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== ring, hall: 0, echo: 0 });
      app.store.edit((project) => { project.piece = { on: true, tension: Array.from({ length: 8 }, () => level), scenes: Array.from({ length: 8 }, () => 0), order: [0, 2, 1, 3, 4, 5, 6] }; });
      if (lay !== 0) app.piece.layRoster(ring, 0, lay as 1 | 2);
      return window.kreisel.whole();
    }, [solo, tension, state] as const);
    const louder = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);

    // The hi-hat at full tension plays; laid out it is silent.
    expect((await hear(2, 31, 0)).peak).toBeGreaterThan(0.02);
    expect((await hear(2, 31, 2)).peak).toBeLessThan(0.002);
    // The bass at a tension that has not reached it is silent; laid in it plays.
    expect((await hear(4, 12, 0)).peak).toBeLessThan(0.002);
    expect((await hear(4, 12, 1)).peak).toBeGreaterThan(0.05);
    // A ring the tension has only just reached plays under its level; laid in it plays in full.
    const shy = await hear(1, 10, 0);
    const full = await hear(1, 10, 1);
    expect(shy.peak).toBeGreaterThan(0.01);
    expect(louder(full, shy)).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("lays the roster with a finger: a tap switches, a resting finger opens the menu", async ({ page }) => {
    const problems = await technoPiece(page);
    const menu = page.locator("#context");
    await tool(page, "Roster").tap();
    expect(await page.evaluate(() => window.kreisel.app.piece.laying)).toBe(true);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#kreisel").scrollIntoViewIfNeeded();

    // A tap turns the phrase around.
    let at = await lane(page, 4, 12);
    await page.touchscreen.tap(at.x, at.y);
    expect(await laid(page, 4)).toBe(with_(1, 1));

    // A finger that rests: what it did when it came down is taken back, and the phrase's menu opens.
    at = await lane(page, 2, 66);
    const finger = { pointerId: 11, pointerType: "touch", isPrimary: true, button: 0, clientX: at.x, clientY: at.y, bubbles: true };
    await page.locator("#kreisel").dispatchEvent("pointerdown", finger);
    await page.waitForTimeout(800);
    await page.locator("#kreisel").dispatchEvent("pointerup", finger);
    await expect(menu.locator("header")).toHaveText("Piece · bars 65 to 72");
    expect(await laid(page, 2)).toBe(none);
    await menu.getByRole("menuitemradio", { name: "Hi-Hat: rests in these bars" }).tap();
    expect(await laid(page, 2)).toBe(with_(2, 8));
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(problems).toEqual([]);
  });
});
