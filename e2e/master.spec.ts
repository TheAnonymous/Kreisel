import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onPhone, open, pieceOf, status } from "./helpers";

/*
 * The techno Kreisel as it comes: its piece is a track of 160 bars that
 * works with tension by every means a piece has, and two kinds of weather
 * (sun on the hi-hat, rain on the stab) lie on its scene with tides of their own. What the page shows of that is
 * looked at here, and the stretch from the cool-down over the long break and
 * the anti-drop to the top is measured, rendered faster than it plays. The
 * arc itself, bar by bar, is held by tests/master.test.ts.
 */

const menuOf = (page: Page) => page.locator("#context");
const wedge = (page: Page, bar: number): Promise<{ x: number; y: number }> => page.evaluate((index) => window.kreisel.drop(index), bar);
const over = (now: number, before: number): number => 20 * Math.log10(Math.max(now, 1e-9) / Math.max(before, 1e-9));

/** Takes the techno Kreisel from the menu at the name, as a visitor would, and looks at its piece. */
async function techno(page: Page): Promise<string[]> {
  const problems = await open(page);
  await page.locator("#kreisel-menu").click();
  await menuOf(page).getByRole("menuitem", { name: /Techno Kreisel/ }).click();
  await expect(page.locator("#toast")).toContainText("The techno Kreisel is here.");
  await page.evaluate(() => window.kreisel.app.dismiss());
  await focusPiece(page);
  return problems;
}

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("comes as the techno Kreisel with a piece that works with tension: four drops, each with a build-up of its own", async ({ page }) => {
    const problems = await techno(page);
    await expect(status(page)).toContainText("Piece: 160 bars, 4:16 minutes");
    await expect(status(page)).toContainText("24 bars of break");
    // It waits switched off: the Kreisel plays the scene on the table until the piece is asked for.
    expect((await pieceOf(page)).on).toBe(false);
    await expect(page.locator("#piece-sway")).toHaveText("6 things more ▾");
    await expect(page.locator("#piece-ends")).toHaveText("Phrase ends: 3 ▾");
    // The piece's panel still fits on this screen.
    expect(await page.evaluate(() => { const panel = document.getElementById("panel")!; return panel.scrollHeight - panel.clientHeight <= 2; })).toBe(true);

    // Pointing at a drop says what leads up to it: no two are alike.
    await page.evaluate(() => { window.kreisel.app.piece.toggle(); window.kreisel.app.dismiss(); });
    const tips: [number, string][] = [
      [32, "Drop in bar 33 · Build-up own, 2 bars: riser, roll · click to change"],
      [72, "Drop in bar 73 · Build-up own, 4 bars: riser, roll, lows out, last bar without hi-hat, late drop · click to change"],
      [120, "Drop in bar 121 · Build-up own, 8 bars: riser with a tone, roll, lows out, cloud of reverb, quieter, gap half a bar · click to change"],
      [128, "Drop in bar 129 · Build-up own, 2 bars: riser, roll, last bar without kick · click to change"],
    ];
    for (const [bar, tip] of tips) {
      const at = await wedge(page, bar);
      await page.mouse.move(at.x, at.y);
      await expect(page.locator("#tip")).toHaveText(tip);
    }
    // Seven effects lie on it, and pointing at a bar that has one names it.
    expect(((await pieceOf(page)).marks ?? []).map((mark) => mark.bar)).toEqual([15, 47, 55, 87, 95, 111, 143]);
    const marked: [number, string][] = [[15, "Pause"], [47, "Stutter"], [87, "Thin"], [111, "Dull"], [143, "Echo"]];
    for (const [bar, name] of marked) {
      const at = await barAt(page, bar, 0.5);
      await page.mouse.move(at.x, at.y);
      await expect(page.locator("#tip")).toContainText(`bar ${bar + 1} of 160`);
      await expect(page.locator("#tip")).toContainText(`Effect: ${name}`);
    }
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("can be read as an outline: all rings play together only at the very top", async ({ page }) => {
    const problems = await techno(page);
    const bar = await barAt(page, 30, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menuOf(page).getByRole("menuitem", { name: "Outline …" }).click();
    const dialog = page.locator("#protokoll");
    await expect(dialog).toBeVisible();
    const lines = dialog.locator("#protokoll-lines li");
    await expect(lines).toHaveCount(20);
    const want: [number, string][] = [
      [0, "Bars 1–8: Kick"],
      [1, "Bars 9–16: Kick, Hi-Hat"],
      [2, "Bars 17–24: Kick, Hi-Hat, Drum"],
      [3, "Bars 25–32: Kick, Hi-Hat, Drum, Bass · Build-up"],
      [4, "Bars 33–40: Kick, Snare, Hi-Hat, Drum, Bass · Drop in bar 33"],
      [6, "Bars 49–56: Kick, Snare, Hi-Hat, Bass, Chords"],
      [7, "Bars 57–64: Kick, Snare, Bass, Chords"],
      [8, "Bars 65–72: Snare, Hi-Hat (partly), Bass · Break · Build-up"],
      [9, "Bars 73–80: Kick, Snare, Hi-Hat, Bass, Chords, Melody · Drop in bar 73"],
      [11, "Bars 89–96: Kick, Snare, Hi-Hat, Bass"],
      [12, "Bars 97–104: Kick, Hi-Hat, Bass"],
      [13, "Bars 105–112: Hi-Hat, Chords · Break"],
      [14, "Bars 113–120: Snare (partly), Hi-Hat, Bass, Chords · Break · Build-up"],
      [15, "Bars 121–128: Kick (partly), Snare (partly), Bass · Build-up · Drop in bar 121"],
      [16, "Bars 129–136: all · Drop in bar 129"],
      [17, "Bars 137–144: all"],
      [19, "Bars 153–160: Kick, Hi-Hat (partly), Drum (partly)"],
    ];
    for (const [index, text] of want) await expect(lines.nth(index)).toHaveText(text);
    // "alle" stands at the top and nowhere else.
    expect((await lines.allTextContents()).filter((line) => line.includes(": all"))).toHaveLength(2);
    // The window fits on the page, long as the list is.
    expect(await dialog.evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth; })).toBe(true);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("has two kinds of weather with tides of their own on the scene, and an empty techno Kreisel starts plain", async ({ page }) => {
    const problems = await techno(page);
    await page.evaluate(() => window.kreisel.app.weather.focus());
    await expect(status(page)).toContainText("Sun on Hi-Hat");
    await expect(status(page)).toContainText("Rain on Chords");
    await expect(page.getByLabel("Tides for Sun, in bars")).toHaveValue("20");
    await expect(page.getByLabel("Tides for Rain, in bars")).toHaveValue("12");
    // The browser keeps the piece and the tides: after a reload both are there again.
    const kept = () => page.evaluate(() => { const { piece, scenes } = window.kreisel.app.project; return { piece, tide: scenes[0]!.tide, weather: scenes[0]!.weather }; });
    const before = await kept();
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.locator("#status")).toContainText("Melody");
    expect(await kept()).toEqual(before);

    // An empty techno Kreisel has a clear sky and the plain techno form: nothing is laid for rings that have no hits yet.
    await page.locator("#kreisel-menu").click();
    await menuOf(page).getByRole("menuitem", { name: "Empty Kreisel" }).click();
    const empty = await page.evaluate(() => {
      const { piece, scenes, style } = window.kreisel.app.project;
      const scene = scenes[0]!;
      return { style, bars: piece.tension.length, order: piece.order, laid: [piece.roster, piece.sway, piece.ends, piece.marks, piece.vary].map((part) => part === undefined), sky: scene.weather.flat(2).every((value) => value === 0), tide: scene.tide === undefined };
    });
    expect(empty).toEqual({ style: "techno", bars: 112, order: [0, 2, 1, 3, 4, 5, 6], laid: [true, true, true, true, true], sky: true, tide: true });
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("plays from the cool-down over the long break and the anti-drop up to the very top, as it is laid", async ({ page }) => {
    // One render of forty-eight bars.
    test.setTimeout(240_000);
    const problems = await open(page);
    // Bars 97 to 144 of the piece, cut out as a piece of their own: the cool-down, the long break, the anti-drop, the top.
    const beats = await page.evaluate(async () => {
      const app = window.kreisel.app;
      app.newProject(false, "techno");
      app.store.edit((project) => {
        const piece = project.piece;
        const from = 96;
        const to = 144;
        const cut = <T>(list: T[] | undefined): T[] => (list ?? []).slice(from, to);
        project.piece = {
          ...piece,
          on: true,
          tension: cut(piece.tension),
          scenes: cut(piece.scenes),
          noKick: cut(piece.noKick),
          roster: (piece.roster ?? []).map((list) => (list.length === 0 ? [] : cut(list))),
          drops: (piece.drops ?? []).filter((drop) => drop.bar >= from && drop.bar < to).map((drop) => ({ ...drop, bar: drop.bar - from })),
          marks: (piece.marks ?? []).filter((mark) => mark.bar >= from && mark.bar < to).map((mark) => ({ ...mark, bar: mark.bar - from })),
        };
      });
      return window.kreisel.beats();
    });
    // Forty-eight bars, and a few beats in which the last one rings out.
    expect(beats.length).toBeGreaterThanOrEqual(48 * 4);
    type What = "loud" | "deep" | "high" | "body" | "sharp";
    /** The root mean square over bars `from` up to `to` of the cut (bar 0 is bar 97 of the piece). */
    const mean = (from: number, to: number, what: What): number => { const part = beats.slice(from * 4, to * 4); return Math.sqrt(part.reduce((sum, beat) => sum + beat[what] ** 2, 0) / part.length); };
    const beat = (bar: number, at: number, what: What): number => beats[bar * 4 + at]![what];
    // The long break (bars 105 to 120) has no lows: neither the kick nor, through its first half, the bass.
    expect(over(mean(8, 24, "deep"), mean(0, 7, "deep"))).toBeLessThan(-15);
    // Its first half is the quietest stretch; the acid line coming back and the build-up lift the second.
    expect(over(mean(9, 16, "loud"), mean(0, 7, "loud"))).toBeLessThan(-10);
    expect(mean(16, 23, "loud")).toBeGreaterThan(mean(9, 16, "loud"));
    // The gap: the last half bar before the anti-drop is far quieter than the half before it.
    expect(over(Math.max(beat(23, 2, "body"), beat(23, 3, "body")), Math.max(beat(23, 0, "body"), beat(23, 1, "body")))).toBeLessThan(-6);
    // The anti-drop (bars 121 to 128) brings the lows back at once, as they were before the break …
    expect(Math.abs(over(mean(24, 30, "deep"), mean(0, 7, "deep")))).toBeLessThan(3);
    // … and its last bar is without the kick.
    expect(over(mean(31, 32, "deep"), mean(24, 30, "deep"))).toBeLessThan(-10);
    // The top (bars 129 to 144) has everything: it is sharper than the anti-drop of kick and acid line alone, and has its lows.
    const sharp = (from: number, to: number): number => { const part = beats.slice(from * 4, to * 4); return part.reduce((sum, one) => sum + one.sharp, 0) / part.length; };
    expect(sharp(32, 48) / sharp(24, 30)).toBeGreaterThan(1.2);
    expect(Math.abs(over(mean(32, 48, "deep"), mean(24, 30, "deep")))).toBeLessThan(3);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "Finger");

  test("shows the techno Kreisel's piece with its buttons, and the panel fits the width", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.kreisel.app.newProject(false, "techno"); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    await expect(status(page)).toContainText("Piece: 160 bars, 4:16 minutes");
    await expect(page.locator("#piece-sway")).toHaveText("6 things more ▾");
    await expect(page.locator("#piece-ends")).toHaveText("Phrase ends: 3 ▾");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
