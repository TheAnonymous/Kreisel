import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onLaptop, onPhone, open, pieceOf } from "./helpers";

/*
 * The build-up before a drop: the piece's ring shows every drop (a ramp
 * through the bars of its build-up, a red wedge on the rim where it lands),
 * a click on the wedge opens the kit of that drop, and the piece's panel has
 * the kit of all drops. What a build-up then does to the sound is measured
 * beat by beat on short pieces, rendered faster than they play.
 */

const SMALL = { bars: 1, riser: 1, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false };
const MEDIUM = { ...SMALL, bars: 4, roll: true, lows: true };
const BIG = { ...MEDIUM, bars: 8, riser: 2, wash: true, dip: true, gap: 1 };

/** Where the mark of the drop that lands in bar `bar` is on the page. */
const wedge = (page: Page, bar: number): Promise<{ x: number; y: number }> => page.evaluate((index) => window.kreisel.drop(index), bar);
/** The colour of the wheel at a point of the page. */
const colour = (page: Page, at: { x: number; y: number }): Promise<number[]> =>
  page.evaluate((point) => {
    const canvas = document.getElementById("kreisel") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    return Array.from(canvas.getContext("2d")!.getImageData(Math.round((point.x - box.left) * scale), Math.round((point.y - box.top) * scale), 1, 1).data);
  }, at);
const red = [228, 87, 46];
const near = (color: number[], want: number[]): boolean => Math.abs(color[0]! - want[0]!) + Math.abs(color[1]! - want[1]!) + Math.abs(color[2]! - want[2]!) < 60;
const menuOf = (page: Page) => page.locator("#context");

/** The techno Kreisel with its own piece of 112 bars: drops in bar 17 (small) and in bar 65 (out of the break, big). The piece is switched on and in focus. */
async function technoPiece(page: Page): Promise<string[]> {
  const problems = await open(page);
  await page.evaluate(() => {
    window.kreisel.app.newProject(false, "techno");
    window.kreisel.app.store.edit((project) => { project.piece.on = true; });
    window.kreisel.app.dismiss();
  });
  await focusPiece(page);
  return problems;
}

const over = (now: number, before: number): number => 20 * Math.log10(Math.max(now, 1e-9) / Math.max(before, 1e-9));
/** In the pieces `hear` measures, the last beat before the drop and the first of the drop. */
const LAST = 31;
const DROP = 32;
/**
 * A techno piece of sixteen bars whose drop lands in bar 9, with this build-up, measured beat by beat (or in `parts`
 * parts of a beat). With `solo` only that ring is heard, dry; `setup` shapes the Kreisel further.
 */
const hear = (page: Page, build: Record<string, unknown>, solo = -1, parts = 1, setup = "") => page.evaluate(async ([kit, only, split, code]) => {
  const app = window.kreisel.app;
  app.newProject(false, "techno");
  if (only >= 0) {
    app.setGlobal({ pressure: 0 });
    for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== only, hall: 0, echo: 0 });
  }
  app.store.edit((project) => {
    const line = Array.from({ length: 16 }, (_, bar) => (bar < 8 ? 18 : 31));
    project.piece = { on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6] };
  });
  new Function("app", code)(app);
  app.store.edit((project) => { project.piece.build = { bars: 0, riser: 0, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false, ...kit }; });
  return window.kreisel.beats(split);
}, [build, solo, parts, setup] as const);

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("zeigt jeden Drop am Stück-Ring: einen roten Keil am Rand und eine Rampe für seinen Build-up", async ({ page }) => {
    const problems = await technoPiece(page);
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: BIG }]);
    // A wedge where a drop lands, and none where none does.
    expect(near(await colour(page, await wedge(page, 16)), red)).toBe(true);
    expect(near(await colour(page, await wedge(page, 64)), red)).toBe(true);
    expect(near(await colour(page, await wedge(page, 40)), red)).toBe(false);
    // The ramp of the big build-up lies over the eight bars before the drop: halfway through it covers the foot of the bars.
    const under = await barAt(page, 60, 0.25);
    const before = await colour(page, under);
    await page.evaluate(() => window.kreisel.app.piece.sizeBuild(64, "klein"));
    await expect.poll(async () => (await colour(page, under)).join()).not.toBe(before.join());
    await page.evaluate(() => window.kreisel.app.undo());
    await expect.poll(async () => (await colour(page, under)).join()).toBe(before.join());
    // A drop without a build-up keeps its wedge, hollow.
    await page.evaluate(() => window.kreisel.app.piece.sizeBuild(16, "keiner"));
    await expect.poll(async () => near(await colour(page, await wedge(page, 16)), red)).toBe(false);
    await page.evaluate(() => window.kreisel.app.undo());
    // A piece that is switched off is only hinted at, and so are its drops.
    await page.evaluate(() => window.kreisel.app.piece.toggle());
    await expect.poll(async () => near(await colour(page, await wedge(page, 64)), red)).toBe(false);
    await page.evaluate(() => { window.kreisel.app.piece.toggle(); window.kreisel.app.dismiss(); });
    await expect.poll(async () => near(await colour(page, await wedge(page, 64)), red)).toBe(true);

    // Pointing at a wedge says what leads up to that drop.
    const mark = await wedge(page, 64);
    await page.mouse.move(mark.x, mark.y);
    await expect(page.locator("#tip")).toHaveText("Drop in Takt 65 · Build-up groß, 8 Takte: Riser mit Ton, Roll, Tiefen raus, Hall-Wolke, leiser, Lücke ein Schlag · klicken zum Ändern");
    const first = await wedge(page, 16);
    await page.mouse.move(first.x, first.y);
    await expect(page.locator("#tip")).toHaveText("Drop in Takt 17 · Build-up klein, 1 Takt: Riser · klicken zum Ändern");
    // The line can still be painted right beside a wedge: inside the band, a click is a stroke.
    const inside = await barAt(page, 64, 0.5);
    await page.mouse.click(inside.x, inside.y);
    await expect(menuOf(page)).toBeHidden();
    expect((await pieceOf(page)).tension[64]).toBeLessThan(20);
    await page.evaluate(() => window.kreisel.app.undo());
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("öffnet mit einem Klick auf den Keil den Baukasten des Drops: Größe, Länge, Zutaten und der Moment", async ({ page }) => {
    const problems = await technoPiece(page);
    const menu = menuOf(page);
    const mark = await wedge(page, 64);
    // The kit opens with the click, not as the button comes down; pulled away first, nothing opens.
    await page.mouse.move(mark.x, mark.y);
    await page.mouse.down();
    await expect(menu).toBeHidden();
    await page.mouse.move(mark.x - 60, mark.y - 60, { steps: 4 });
    await page.mouse.up();
    await expect(menu).toBeHidden();
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: BIG }]);
    await page.mouse.click(mark.x, mark.y);
    await expect(menu).toContainText("Drop in Takt 65 · Build-up");
    const size = (name: RegExp) => menu.getByRole("menuitemradio", { name });
    const part = (name: RegExp | string) => menu.getByRole("menuitemcheckbox", { name });
    await expect(size(/^Groß/)).toHaveAttribute("aria-checked", "true");
    await expect(size(/läuft 8 Takte/)).toHaveAttribute("aria-checked", "true");
    await expect(part(/^Snare-Roll, am Ende Zweiunddreißigstel/)).toHaveAttribute("aria-checked", "true");
    await expect(part(/^Hall-Wolke/)).toHaveAttribute("aria-checked", "true");
    await expect(part("Letzter Takt ohne Kick")).toHaveAttribute("aria-checked", "false");
    await expect(size(/^Der letzte Schlag vor dem Drop/)).toHaveAttribute("aria-checked", "true");

    // A size sets everything at once, and the menu stays open and true.
    await size(/^Mittel/).click();
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: MEDIUM }]);
    await expect(size(/läuft 4 Takte/)).toHaveAttribute("aria-checked", "true");
    await expect(part(/^Hall-Wolke/)).toHaveAttribute("aria-checked", "false");
    // Below it every part by itself: then the build-up is nobody's size.
    await part("Leiser werden").click();
    await size(/läuft 2 Takte/).click();
    await size(/Rauschen und ein Ton/).click();
    await size(/^Der letzte halbe Takt/).click();
    await size(/^Später Drop/).click();
    await part("Letzter Takt ohne Hi-Hat").click();
    await expect(part(/^Snare-Roll, am Ende Sechzehntel/)).toHaveAttribute("aria-checked", "true");
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: { ...MEDIUM, bars: 2, riser: 2, dip: true, hat: true, gap: 2, late: true } }]);
    for (const name of [/^Kein Build-up/, /^Klein/, /^Mittel/, /^Groß/]) await expect(size(name)).toHaveAttribute("aria-checked", "false");
    // No build-up has no parts: they wait until it has a length again.
    await size(/^Kein Build-up/).click();
    await expect(part(/^Snare-Roll/)).toBeDisabled();
    await expect(size(/^Später Drop/)).toBeDisabled();
    await size(/läuft 4 Takte/).click();
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: { ...SMALL, bars: 4 } }]);

    // "Wieder wie alle Drops" gives the drop's own build-up up; the row then has nothing to do.
    const again = menu.getByRole("menuitem", { name: "Wieder wie alle Drops" });
    await again.click();
    expect((await pieceOf(page)).drops).toBeUndefined();
    await expect(again).toBeDisabled();
    await expect(size(/^Klein/)).toHaveAttribute("aria-checked", "true");
    // "Für alle Drops übernehmen" makes it the build-up of the piece, and can be taken back.
    await size(/^Groß/).click();
    await menu.getByRole("menuitem", { name: "Für alle Drops übernehmen" }).click();
    await expect(menu).toBeHidden();
    expect([(await pieceOf(page)).build, (await pieceOf(page)).drops]).toEqual([BIG, undefined]);
    await expect(page.locator("#piece-build")).toHaveText("alle Drops: groß ▾");
    await expect(page.locator("#toast")).toContainText("Alle Drops haben jetzt diesen Build-up.");
    await page.locator("#toast").getByRole("button", { name: "Zurück" }).click();
    expect([(await pieceOf(page)).build, (await pieceOf(page)).drops]).toEqual([undefined, [{ bar: 64, build: BIG }]]);
    await expect(page.locator("#piece-build")).toHaveText("alle Drops: klein ▾");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("führt vom Rechtsklick auf einen Takt des Build-ups zu seinem Baukasten, und spielt ihn an", async ({ page }) => {
    const problems = await technoPiece(page);
    const menu = menuOf(page);
    // A bar that leads up to the drop, and the bar of the drop itself.
    for (const bar of [58, 64]) {
      const at = await barAt(page, bar, 0.5);
      await page.mouse.click(at.x, at.y, { button: "right" });
      await expect(menu).toContainText(`Stück · Takt ${bar + 1}`);
      const row = menu.getByRole("menuitem", { name: /^Build-up vor dem Drop in Takt 65/ });
      await expect(row).toContainText("Build-up groß, 8 Takte");
      await row.click();
      await expect(menu).toContainText("Drop in Takt 65 · Build-up");
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }
    // A bar that leads nowhere has no such row; the build-up of all drops is in every piece menu.
    const calm = await barAt(page, 30, 0.5);
    await page.mouse.click(calm.x, calm.y, { button: "right" });
    await expect(menu).toContainText("Stück · Takt 31");
    await expect(menu.getByRole("menuitem", { name: /^Build-up vor dem Drop/ })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: /^Build-up aller Drops: klein/ }).click();
    await expect(menu).toContainText("Alle Drops · Build-up");
    // One drop has its own: the kit of all can take it along.
    await menu.getByRole("menuitemradio", { name: /^Mittel/ }).click();
    expect((await pieceOf(page)).drops).toHaveLength(1);
    await menu.getByRole("menuitem", { name: "Auch für den Drop mit eigenem Build-up" }).click();
    expect([(await pieceOf(page)).build, (await pieceOf(page)).drops]).toEqual([MEDIUM, undefined]);
    await expect(menu.getByRole("menuitem", { name: /eigenem Build-up/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // "Anhören" plays from two bars before the build-up, and leaves the kit open to go on trying.
    const mark = await wedge(page, 64);
    await page.mouse.click(mark.x, mark.y, { button: "right" });
    await expect(menu).toContainText("Drop in Takt 65 · Build-up");
    await menu.getByRole("menuitem", { name: "Anhören ab Takt 59" }).click();
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => [window.kreisel.app.playing, window.kreisel.app.project.piece.on, window.kreisel.app.piece.start])).toEqual([true, true, 58]);
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piece.playhead())).not.toBeNull();
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.kreisel.app.togglePlay());
    // The drop goes when the line no longer jumps and the kick no longer comes back: its menu has nothing to show then.
    await page.mouse.click(mark.x, mark.y);
    await expect(menu).toBeVisible();
    await page.evaluate(() => window.kreisel.app.store.edit((project) => { project.piece.tension = project.piece.tension.map(() => 31); delete project.piece.noKick; }));
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("baut auf, wie der Baukasten sagt: Die Tiefen gehen, es wird leiser, die Lücke ist still, und der Drop bringt alles zurück", async ({ page }) => {
    // Eight renders of sixteen bars.
    test.setTimeout(240_000);
    const problems = await open(page);
    const plain = await hear(page, {});
    // A drop that lands with a crash and nothing before it: what the bars after a drop are measured against (the master answers a crash).
    const landed = await hear(page, { bars: 1 });
    // The lows go through the four bars of the middle build-up, and are back with the drop.
    const medium = await hear(page, MEDIUM);
    expect(over(medium[LAST]!.deep, plain[LAST]!.deep)).toBeLessThan(-15);
    expect(over(medium[LAST - 8]!.deep, plain[LAST - 8]!.deep)).toBeLessThan(-3);
    expect(over(medium[LAST]!.deep, medium[LAST - 8]!.deep)).toBeLessThan(-8);
    expect(Math.abs(over(medium[LAST - 16]!.deep, plain[LAST - 16]!.deep))).toBeLessThan(1);
    expect(Math.abs(over(medium[DROP + 1]!.deep, landed[DROP + 1]!.deep))).toBeLessThan(1);
    // The drop is the loudest thing for bars: well above the beat before it.
    expect(over(medium[DROP]!.loud, medium[LAST]!.loud)).toBeGreaterThan(3);
    expect(Math.abs(over(plain[DROP]!.loud, plain[LAST]!.loud))).toBeLessThan(1.5);

    // "Leiser werden" by itself: close to three dB by the end, whatever the master does, and back at once.
    const dip = await hear(page, { bars: 4, dip: true });
    expect(over(dip[LAST]!.loud, plain[LAST]!.loud)).toBeLessThan(-2);
    expect(over(dip[LAST]!.loud, plain[LAST]!.loud)).toBeGreaterThan(-4);
    expect(over(dip[LAST - 8]!.loud, plain[LAST - 8]!.loud)).toBeLessThan(-0.8);
    expect(Math.abs(over(dip[DROP + 1]!.loud, landed[DROP + 1]!.loud))).toBeLessThan(0.5);

    // The big one: eight bars down, a beat of nothing but what rings out, and then everything.
    const big = await hear(page, BIG);
    expect(over(big[LAST - 1]!.loud, plain[LAST - 1]!.loud)).toBeLessThan(-5);
    expect(over(big[LAST]!.loud, big[LAST - 1]!.loud)).toBeLessThan(-4);
    expect(over(big[DROP]!.loud, big[LAST]!.loud)).toBeGreaterThan(8);
    expect(Math.abs(over(big[DROP + 1]!.loud, landed[DROP + 1]!.loud))).toBeLessThan(0.5);
    // It stays under the ceiling. (The Kreisel on the table is still the one just measured.)
    expect((await page.evaluate(() => window.kreisel.whole())).peak).toBeLessThan(1);
    // What rings in the gap is the cloud of hall: without it the gap is far quieter.
    const dryGap = await hear(page, { ...BIG, wash: false });
    expect(over(big[LAST]!.loud, dryGap[LAST]!.loud)).toBeGreaterThan(3);

    // The gap, on one ring by itself and dry: silent from its first sixteenth on (the master lets a moment through), and the ring is back on the one.
    const bass = await hear(page, { bars: 1, gap: 2 }, 4, 4);
    const step = (bar: number, index: number): number => bass[bar * 16 + index]!.loud;
    expect(Math.max(...[9, 10, 11, 12, 13, 14, 15].map((index) => step(7, index)))).toBeLessThan(0.0005);
    expect(Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((index) => step(6, index)))).toBeGreaterThan(0.02);
    expect(Math.max(step(8, 0), step(8, 1))).toBeGreaterThan(0.02);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("spielt den Riser mit Ton, den Roll bis zum Drop und den späten Drop", async ({ page }) => {
    // Eight renders of sixteen bars.
    test.setTimeout(240_000);
    const problems = await open(page);
    // A late drop: the tuned drum waits a beat, the bass does not.
    for (const [ring, waits] of [[3, true], [4, false]] as const) {
      const onTime = await hear(page, { bars: 1 }, ring);
      const late = await hear(page, { bars: 1, late: true }, ring);
      if (waits) expect(over(late[DROP]!.body, onTime[DROP]!.body)).toBeLessThan(-8);
      else expect(Math.abs(over(late[DROP]!.body, onTime[DROP]!.body))).toBeLessThan(0.5);
      expect(Math.abs(over(late[DROP + 1]!.body, onTime[DROP + 1]!.body))).toBeLessThan(0.5);
    }

    // The riser with a tone is brighter at its end than what plays without it.
    const plain = await hear(page, {});
    const tone = await hear(page, { bars: 4, riser: 2 });
    expect(over(tone[LAST]!.high, plain[LAST]!.high)).toBeGreaterThan(1);
    expect(Math.abs(over(tone[LAST - 16]!.high, plain[LAST - 16]!.high))).toBeLessThan(0.5);

    // The roll on a snare's ring with nothing of its own: louder and denser all the way, and done with the drop.
    const empty = "app.rings.clear(1); app.rings.setTrack(1, { level: 1 });";
    const roll = await hear(page, { bars: 4, roll: true }, 1, 1, empty);
    const still = await hear(page, { bars: 4 }, 1, 1, empty);
    expect(Math.max(...still.slice(16, DROP).map((beat) => beat.body))).toBeLessThan(0.001);
    expect(roll[LAST - 15]!.loud).toBeGreaterThan(0.005);
    expect(over(roll[LAST]!.loud, roll[LAST - 15]!.loud)).toBeGreaterThan(4);
    expect(roll[LAST - 16 - 1]!.loud).toBeLessThan(0.001);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lässt beim Spielen nichts stehen: Nach einem Build-up, und wenn das Stück mittendrin aufhört, ist der Klang wieder offen", async ({ page }) => {
    test.slow();
    const problems = await technoPiece(page);
    // A fast piece of eight bars with the big build-up before its drop in bar 5 (which then begins in its middle).
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.setGlobal({ bpm: 180 });
      app.store.edit((project) => {
        const line = [18, 18, 18, 18, 31, 31, 31, 31];
        project.piece = { on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6], build: { bars: 8, riser: 2, roll: true, lows: true, wash: true, dip: true, kick: false, hat: false, gap: 1, late: true } };
      });
      app.piece.playFrom(1);
    });
    const playhead = (): Promise<number | null> => page.evaluate(() => window.kreisel.app.piece.playhead());
    // Through the build-up and over the drop: it goes on playing, and is heard after the drop.
    await expect.poll(playhead, { timeout: 15_000 }).toBeGreaterThan(5);
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 5000 }).toBeGreaterThan(0.05);
    // Stopped in the middle of the next build-up and started again in a bar without one: the sound is whole.
    await expect.poll(playhead, { timeout: 15_000 }).toBeLessThan(4);
    await expect.poll(playhead, { timeout: 15_000 }).toBeGreaterThan(2.2);
    await page.evaluate(() => window.kreisel.app.togglePlay());
    await page.evaluate(() => { window.kreisel.app.piece.sizeBuild(null, "keiner"); window.kreisel.app.piece.playFrom(5); });
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 5000 }).toBeGreaterThan(0.2);
    await page.evaluate(() => window.kreisel.app.togglePlay());
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("öffnet am Handy mit einem Tippen auf den Keil den Baukasten, und er passt auf die Seite", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.kreisel.app.newProject(false, "techno"); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    const mark = await wedge(page, 64);
    await page.touchscreen.tap(mark.x, mark.y);
    const menu = menuOf(page);
    await expect(menu).toContainText("Drop in Takt 65 · Build-up");
    // The tap opened the kit and did nothing else: on a phone the menu lies under the finger, and no row of it was pressed.
    await page.waitForTimeout(400);
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: BIG }]);
    await expect(menu.getByRole("menuitemcheckbox", { name: "Leiser werden" })).toHaveAttribute("aria-checked", "true");
    expect(await menu.evaluate((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight; })).toBe(true);
    await menu.getByRole("menuitemradio", { name: /^Mittel/ }).tap();
    expect((await pieceOf(page)).drops).toEqual([{ bar: 64, build: MEDIUM }]);
    // Every row can be reached: the last one scrolls into view and works.
    const again = menu.getByRole("menuitem", { name: "Wieder wie alle Drops" });
    await again.scrollIntoViewIfNeeded();
    await again.tap();
    expect((await pieceOf(page)).drops).toBeUndefined();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
