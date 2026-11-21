import { expect, test } from "@playwright/test";
import { bodyOf, copyLink, heard, knockAt, onLaptop, onPhone, open, pickSound, soundOf, state, status, where } from "./helpers";

/*
 * Klangkörper: a ring's own sound as a body that rings, built on the
 * workbench.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("baut einem Ring einen Klangkörper", async ({ page }) => {
    const problems = await open(page);
    const bench = page.locator("#bench");
    await page.keyboard.press("7");
    await page.locator("#build").click();
    await expect(bench).toBeVisible();
    await expect(page.locator("#mallets")).toBeVisible();
    await expect(page.locator("#tools")).toBeHidden();
    await expect(status(page)).toContainText("Klangkörper Melodie:");
    // A ring without a body gets a first one that suits it, and plays it from then on.
    expect(await bodyOf(page, 6)).not.toBeNull();
    expect(await soundOf(page, 6)).toBe(5);

    // Another kind of body; knocking on it is heard, and where it was last knocked is where the ring strikes it.
    await bench.getByRole("button", { name: "Schale", exact: true }).click();
    expect((await bodyOf(page, 6))!.kind).toBe(4);
    await expect(page.locator(".track.selected .sound")).toHaveText("Schale");
    let spot = await knockAt(page, 0.2);
    await page.mouse.click(spot.x, spot.y);
    expect((await bodyOf(page, 6))!.where).toBeCloseTo(0.2, 1);
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.02);
    spot = await knockAt(page, 0.9);
    await page.mouse.click(spot.x, spot.y);
    expect((await bodyOf(page, 6))!.where).toBeCloseTo(0.9, 1);
    await expect(status(page)).toContainText("Rand");

    // What sets it going is on the top row of keys; a bowed body sounds on.
    await page.keyboard.press("e");
    expect((await bodyOf(page, 6))!.exciter).toBe(2);
    await expect(page.locator("#mallets .tool").nth(2)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("r");
    await expect(status(page)).toContainText("gestrichen");
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.02);

    // The right grip pulls it bigger, the left one tightens it; the wheel changes its size, too.
    await bench.getByRole("button", { name: "Stab", exact: true }).click();
    const before = (await bodyOf(page, 6))!;
    const size = await page.evaluate(() => window.kreisel.grip("size"));
    await page.mouse.move(size.x, size.y);
    await page.mouse.down();
    await page.mouse.move(size.x + (before.size > 0.5 ? -50 : 50), size.y, { steps: 5 });
    await page.mouse.up();
    const sized = (await bodyOf(page, 6))!;
    expect(Math.abs(sized.size - before.size)).toBeGreaterThan(0.1);
    const tight = await page.evaluate(() => window.kreisel.grip("tight"));
    await page.mouse.move(tight.x, tight.y);
    await page.mouse.down();
    await page.mouse.move(tight.x, tight.y + (before.tight > 0.5 ? 45 : -45), { steps: 5 });
    await page.mouse.up();
    expect(Math.abs((await bodyOf(page, 6))!.tight - before.tight)).toBeGreaterThan(0.2);
    spot = await knockAt(page, 0.3);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.wheel(0, sized.size > 0.5 ? 100 : -100);
    expect(Math.abs((await bodyOf(page, 6))!.size - sized.size)).toBeGreaterThan(0.05);

    // The material: a slider from wood to glass, and the right button puts it back in the middle.
    const material = page.locator("#bench-shape input").nth(2);
    await material.fill("100");
    expect((await bodyOf(page, 6))!.material).toBe(1);
    await expect(page.locator("#bench-shape .label").nth(2)).toHaveText("Material: Glas");
    await material.fill("0");
    await expect(page.locator("#bench-shape .label").nth(2)).toHaveText("Material: Holz");
    await material.click({ button: "right" });
    expect((await bodyOf(page, 6))!.material).toBe(0.5);

    // Dice, one step back, and away with the bench.
    const built = (await bodyOf(page, 6))!;
    await page.keyboard.press("n");
    expect(await bodyOf(page, 6)).not.toEqual(built);
    await page.keyboard.press("Control+z");
    expect(await bodyOf(page, 6)).toEqual(built);
    await page.keyboard.press("Escape");
    await expect(bench).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();

    // In the ring's field the body is one of its sounds: picked with a click, built further with the next.
    const pick = page.locator("#built-pick");
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await expect(pick).toContainText("Klangkörper: Stab");
    await pickSound(page, "Glocke");
    expect(await soundOf(page, 6)).toBe(1);
    await pick.click();
    expect(await soundOf(page, 6)).toBe(5);
    await expect(bench).toBeHidden();
    await pick.click();
    await expect(bench).toBeVisible();
    await page.locator("#bench-done").click();

    // The ring plays its body.
    await page.evaluate(() => window.kreisel.app.rings.toggleSolo(6));
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.04);
    await page.keyboard.press("Space");

    // The right button on another ring leads to its bench; a ring that has no body yet has none to take.
    const kick = await where(page, 0, 2);
    await page.mouse.click(kick.x, kick.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu.getByRole("menuitemradio", { name: "Noch nicht gebaut" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Den Klangkörper dieses Rings bauen" }).click();
    await expect(bench).toBeVisible();
    await expect(page.locator("#bench-title")).toHaveText("Klangkörper: Kick");
    expect(await soundOf(page, 0)).toBe(5);
    // A ring without a body has no bench: picking one puts it away.
    await page.keyboard.press("2");
    await expect(bench).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("nimmt Klangkörper im Link und in der Datei mit", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const problems = await open(page);
    // Only the kick is heard, and it plays a body.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.setGlobal({ bpm: 180 });
      for (let track = 1; track < 7; track += 1) app.rings.setTrack(track, { mute: true });
      app.select(0);
      app.body.open();
      app.body.shape({ kind: 0, size: 0.9, tight: 0.2, material: 0.1, exciter: 0, where: 0.1 });
      app.body.close();
      app.dismiss();
    });
    const shared = await state(page);
    await copyLink(page);
    await expect(page.locator("#toast")).toContainText("Link kopiert");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const other = await context.newPage();
    await open(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("Ein geteilter Kreisel");
    expect(await state(other)).toBe(shared);
    expect(await bodyOf(other, 0)).toEqual({ kind: 0, size: 0.9, tight: 0.2, material: 0.1, exciter: 0, where: 0.1 });
    expect(await soundOf(other, 0)).toBe(5);

    // The saved file holds the body's sound.
    await other.locator("#record-more").click();
    const rendered = other.waitForEvent("download");
    await other.locator("#context").getByText("Als Opus speichern").click();
    const file = await heard(other, await rendered);
    expect(file.peak).toBeGreaterThan(0.15);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("baut einen Klangkörper: die Werkbank passt aufs Handy, ein Finger klopft", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.select(3));
    await page.locator("#build").tap();
    await expect(page.locator("#bench")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#bench").getByRole("button", { name: "Fell", exact: true }).tap();
    await page.locator("#koerper").scrollIntoViewIfNeeded();
    expect((await page.locator("#koerper").boundingBox())!.height).toBeGreaterThan(110);
    const spot = await knockAt(page, 0.6);
    await page.touchscreen.tap(spot.x, spot.y);
    expect((await bodyOf(page, 3))!.where).toBeCloseTo(0.6, 1);
    await page.locator("#mallets .tool").nth(0).tap();
    expect((await bodyOf(page, 3))!.exciter).toBe(0);
    await page.locator("#bench-done").tap();
    await expect(page.locator("#bench")).toBeHidden();
    expect(await soundOf(page, 3)).toBe(5);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
