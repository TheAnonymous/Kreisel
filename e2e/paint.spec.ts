import { expect, test } from "@playwright/test";
import { bildOf, onPhone, open, paint, pickSound, sheet, soundOf, state, status } from "./helpers";

/*
 * Klangmalerei: a ring's own sound, painted in the paint box or made to the
 * microphone.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("malt einem Ring einen eigenen Klang", async ({ page }) => {
    const problems = await open(page);
    await page.keyboard.press("1");
    await page.locator("#paint").click();
    await expect(page.locator("#easel")).toBeVisible();
    await expect(page.locator("#brushes")).toBeVisible();
    await expect(page.locator("#tools")).toBeHidden();
    // A ring without a picture gets a first one to start from, and plays it at once.
    await expect(status(page)).toContainText(/Klangmalerei Kick: \d Strich/);
    await expect(page.locator("#own-pick")).toHaveAttribute("aria-pressed", "true");
    expect(await soundOf(page, 0)).toBe(4);

    await page.locator("#bild-clear").click();
    await expect(status(page)).toHaveText("Klangmalerei Kick: noch leer");
    await paint(page, [[0.05, 0.4], [0.15, 0.12], [0.5, 0.1]]);
    await expect(status(page)).toHaveText("Klangmalerei Kick: 1 Strich (1× Summen)");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { intervals: [30, 30, 50, 50, 100, 100] }).toBeGreaterThan(0.02);

    // The third brush, thick, from right to left: a hiss that swells.
    await page.keyboard.press("e");
    await page.keyboard.press("t");
    await paint(page, [[0.6, 0.8], [0.3, 0.8]]);
    expect((await bildOf(page, 0))!.strokes[1]).toMatchObject({ kind: 2, size: 2, swell: true });

    // The right button erases, and undo paints it back.
    const hiss = await sheet(page, 0.45, 0.8);
    await page.mouse.click(hiss.x, hiss.y, { button: "right" });
    await expect(status(page)).toHaveText("Klangmalerei Kick: 1 Strich (1× Summen)");
    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("Klangmalerei Kick: 2 Striche (1× Summen, 1× Zischen)");

    // Back at the wheel, the Kreisel plays the picture.
    await page.keyboard.press("Escape");
    await expect(page.locator("#easel")).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();
    await page.keyboard.press("Shift+m");
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");

    // A built-in sound again; the picture waits, one click brings it back, another opens the paint box.
    await pickSound(page, "Hart");
    expect(await soundOf(page, 0)).toBe(1);
    await expect(page.locator("#own-pick")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#own-pick").click();
    expect(await soundOf(page, 0)).toBe(4);
    await expect(page.locator("#easel")).toBeHidden();
    await page.locator("#own-pick").click();
    await expect(page.locator("#easel")).toBeVisible();
    await page.locator("#easel-done").click();
    await expect(page.locator("#easel")).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("hält gemalte Töne in der Stimmung und lange Noten an der Linie", async ({ page }) => {
    await open(page);
    await page.keyboard.press("5");
    await page.locator("#paint").click();
    await page.locator("#bild-clear").click();
    // A hum drawn roughly along the root: it sticks to the line.
    await paint(page, [[0.03, 0.118], [0.4, 0.106], [0.8, 0.114]]);
    // The bass's root is 55 Hz: one octave above the bottom of the sheet's nine, 65535 / 9.
    const root = 7282;
    const along = (await bildOf(page, 4))!.strokes[0]!.points;
    expect(along).toHaveLength(4);
    expect([along[1], along[3]]).toEqual([root, root]);
    // Browsers round the pointer's place differently by a pixel.
    expect(Math.abs(along[0]! - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(along[2]! - 204)).toBeLessThanOrEqual(1);
    // A hiss does not stick, and neither does a tone far from every line.
    await paint(page, [[0.1, 0.55], [0.3, 0.57]]);
    const free = (await bildOf(page, 4))!.strokes[1]!.points;
    expect(free[1]).not.toBe(free[3]);

    // The first picture may or may not have held; emptying the sheet does not change that.
    await page.locator("#hold").uncheck();
    expect((await bildOf(page, 4))!.hold).toBeNull();
    await page.locator("#hold").check();
    expect((await bildOf(page, 4))!.hold).toBe(82);
    const handle = await sheet(page, 82 / 255, 1);
    await page.mouse.move(handle.x, handle.y + 7);
    await page.mouse.down();
    const moved = await sheet(page, 0.5, 1);
    await page.mouse.move(moved.x, moved.y + 7, { steps: 5 });
    await page.mouse.up();
    expect((await bildOf(page, 4))!.hold).toBeGreaterThan(120);
    expect((await bildOf(page, 4))!.strokes).toHaveLength(2);
    await page.locator("#hold").uncheck();
    expect((await bildOf(page, 4))!.hold).toBeNull();
    // Drums are struck: no hold to offer.
    await page.keyboard.press("1");
    await expect(page.locator("#hold-box")).toBeHidden();
  });

  test("merkt sich Klangbilder und nimmt sie im Link mit", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.keyboard.press("5");
    await page.locator("#paint").click();
    await page.locator("#bild-keep").click();
    await expect(page.locator("#toast")).toContainText("Gemerkt");
    await expect(page.locator(".kept")).toHaveCount(1);
    const bass = await bildOf(page, 4);

    // From the shelf into another ring.
    await page.keyboard.press("7");
    await expect(status(page)).toHaveText("Klangmalerei Melodie: noch leer");
    await page.locator(".kept-pick").click();
    expect((await bildOf(page, 6))!.strokes).toEqual(bass!.strokes);
    expect(await soundOf(page, 6)).toBe(4);

    await page.keyboard.press("Escape");
    const shared = await state(page);
    await page.locator("#share").click();
    await expect(page.locator("#toast")).toContainText("Link kopiert");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link.length).toBeLessThan(1600);
    const other = await context.newPage();
    await open(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("Ein geteilter Kreisel");
    expect(await state(other)).toBe(shared);
    expect((await bildOf(other, 4))!.strokes).toEqual(bass!.strokes);

    // The shelf outlives the project.
    await page.waitForTimeout(500);
    await page.reload();
    await page.evaluate(() => window.kreisel.app.newProject(true));
    await page.keyboard.press("3");
    await page.locator("#paint").click();
    await expect(page.locator(".kept")).toHaveCount(1);
    await page.locator(".kept-drop").click();
    await expect(page.locator(".kept")).toHaveCount(0);
  });

  test("macht einen Klang vor", async ({ page }) => {
    const problems = await open(page);
    await page.keyboard.press("1");
    await page.locator("#paint").click();
    await page.locator("#bild-clear").click();
    await page.locator("#bild-listen").click();
    await expect(page.locator("#listening")).toBeVisible();
    await expect(page.locator("#toast")).toContainText("So habe ich dich verstanden", { timeout: 15_000 });
    await expect(page.locator("#listening")).toBeHidden();
    // The stand-in microphone plays a falling tone: a humming stroke that ends lower than it began, moved down to where a kick lives.
    const strokes = (await bildOf(page, 0))!.strokes;
    const hum = strokes.find((stroke) => stroke.kind === 0)!;
    expect(hum.points[1]).toBeGreaterThan(hum.points[hum.points.length - 1]!);
    expect(hum.points[hum.points.length - 1]).toBeLessThan(12_000);
    expect(await soundOf(page, 0)).toBe(4);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
