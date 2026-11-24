import { expect, test } from "@playwright/test";
import { firstLook, focus, focusPiece, onLaptop, onPhone, open, pieceOf, status } from "./helpers";

/*
 * Where a Kreisel begins: the techno Kreisel of a first visit, the starts in
 * the menu, and the style that the dice and the piece throw in.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("beginnt beim ersten Besuch mit dem Techno-Kreisel, und der spielt", async ({ page }) => {
    const problems = await firstLook(page);
    await expect(page.locator("#tour")).toBeVisible();
    await page.locator("#tour-skip").click();
    await expect(page.locator("#tour")).toBeHidden();

    // Fast, straight, dark, over one chord.
    await expect(page.locator("#bpm")).toHaveValue("150");
    await expect(page.locator("#swing")).toHaveValue("0");
    await expect(page.locator("#scale")).toHaveValue("phrygisch");
    expect(await page.evaluate(() => [window.kreisel.app.project.style, window.kreisel.app.project.scenes[0]!.chords])).toEqual(["techno", [0]]);
    await expect(status(page)).toHaveText("Melodie: leer, 16 Schritte");
    await focus(page, 0);
    await expect(status(page)).toContainText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16");
    await focus(page, 4);
    await expect(status(page)).toContainText("Bass: 11 Schläge");

    // It plays, loud and without clipping, and the acid line slides.
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    let loudest = 0;
    for (let look = 0; look < 40; look += 1) {
      loudest = Math.max(loudest, await page.evaluate(() => window.kreisel.level()));
      await page.waitForTimeout(40);
    }
    expect(loudest).toBeGreaterThan(0.2);
    expect(loudest).toBeLessThanOrEqual(0.99);
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");

    // What a first visit found is kept like any other Kreisel.
    await page.evaluate(() => window.kreisel.app.rings.setTrack(0, { level: 0.5 }));
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.locator("#bpm")).toHaveValue("150");
    expect(await page.evaluate(() => [window.kreisel.app.project.style, window.kreisel.app.project.tracks[0]!.level])).toEqual(["techno", 0.5]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lädt beide Kreisel aus dem Menü und würfelt im Stil des Kreisels", async ({ page }) => {
    const problems = await open(page);
    // What concerns the Kreisel as a whole hangs under its name.
    const name = page.locator("#kreisel-menu");
    const menu = page.locator("#context");
    const techno = menu.getByRole("menuitemradio", { name: /Techno/ });
    const free = menu.getByRole("menuitemradio", { name: /frei/ });
    const project = () => page.evaluate(() => window.kreisel.app.project);
    const hits = (track: number) => page.evaluate((ring) => window.kreisel.app.project.scenes[0]!.patterns[ring]!.steps.slice(0, 16).map((step) => step.on), track);

    // The Werks-Kreisel is free; its dice are the old ones.
    await name.click();
    await expect(techno).toHaveAttribute("aria-checked", "false");
    await expect(free).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitem", { name: "Techno-Kreisel" }).click();
    await expect(page.locator("#toast")).toContainText("Der Techno-Kreisel ist da.");
    await expect(page.locator("#bpm")).toHaveValue("150");
    await name.click();
    await expect(techno).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // Whatever the dice throw now, the kick is on every beat and the hi-hat is open between the kicks.
    for (let throws = 0; throws < 6; throws += 1) {
      await page.evaluate(() => window.kreisel.app.rings.diceAll());
      const kick = await hits(0);
      const hat = await hits(2);
      expect([kick[0], kick[4], kick[8], kick[12]]).toEqual([true, true, true, true]);
      expect([hat[2], hat[6], hat[10], hat[14]]).toEqual([true, true, true, true]);
    }
    await focus(page, 0);
    await page.keyboard.press("n");
    await expect(status(page)).toContainText("auf 1, 5, 9, 13");

    // A control goes back to where the techno Kreisel has it, and an empty Kreisel stays techno.
    await page.evaluate(() => {
      window.kreisel.app.setGlobal({ swing: 0.5 });
      window.kreisel.app.resetGlobal("swing");
    });
    expect((await project()).swing).toBe(0);
    await name.click();
    await menu.getByRole("menuitem", { name: "Leerer Kreisel" }).click();
    expect(await page.evaluate(() => [window.kreisel.app.project.style, window.kreisel.app.project.bpm, window.kreisel.app.project.scenes[0]!.chords])).toEqual(["techno", 150, [0]]);

    // "Frei" turns the dice back, without touching what is on the table; the menu stays and shows it.
    await name.click();
    await free.click();
    await expect(page.locator("#toast")).toContainText("Die Würfel werfen wieder frei.");
    await expect(free).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => [window.kreisel.app.project.style, window.kreisel.app.project.bpm])).toEqual(["frei", 150]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    expect((await project()).style).toBe("techno");

    // And the Werks-Kreisel is still there, as it was.
    await name.click();
    await menu.getByRole("menuitem", { name: /Werks-Kreisel/ }).click();
    await expect(page.locator("#toast")).toContainText("Der Werks-Kreisel ist wieder da.");
    await expect(page.locator("#bpm")).toHaveValue("112");
    expect(await page.evaluate(() => [window.kreisel.app.project.style, window.kreisel.app.project.scenes[0]!.chords])).toEqual(["frei", [0, 5, 2, 6]]);
    await focus(page, 6);
    await expect(status(page)).toHaveText("Melodie: 7 Schläge auf 1, 4, 7, 9, 11, 13, 15 von 16");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("würfelt dem Stück eine Techno-Form, bis 256 Takte lang", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.newProject(false, "techno"));
    await focusPiece(page);
    await expect(status(page)).toContainText("Stück: 160 Takte, 4:16 Minuten");
    expect((await pieceOf(page)).order).toEqual([0, 2, 3, 4, 1, 5, 6]);

    await page.locator(".panel-piece").getByRole("button", { name: "256", exact: true }).click();
    await expect(status(page)).toContainText("Stück: 256 Takte, 6:50 Minuten");
    // The row for the length has room for a number of three digits: nothing in it lies over its neighbour.
    expect(await page.evaluate(() => {
      const parts = [...document.querySelector(".panel-piece .line")!.children].map((child) => child.getBoundingClientRect());
      return parts.every((part, index) => index === 0 || part.left >= parts[index - 1]!.right);
    })).toBe(true);
    await page.keyboard.press("n");
    const piece = await pieceOf(page);
    expect(piece.tension).toHaveLength(256);
    // Sixteen bars of intro from the kick alone, then a full section; sixteen bars of outro at the end.
    expect(piece.tension[0]).toBeLessThan(5);
    expect(piece.tension[16]).toBeGreaterThan(24);
    expect(piece.tension[255]).toBeLessThan(5);
    // One step back and forth, and the wheel draws all of it.
    await page.keyboard.press("Control+z");
    expect((await pieceOf(page)).tension).not.toEqual(piece.tension);
    await page.keyboard.press("Control+Shift+z");
    expect((await pieceOf(page)).tension).toEqual(piece.tension);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("zeigt am Handy beim ersten Besuch den Techno-Kreisel, und der spielt", async ({ page }) => {
    const problems = await firstLook(page);
    await expect(page.locator("#tour")).toBeVisible();
    await page.locator("#tour-skip").click();
    await expect(page.locator("#bpm")).toHaveValue("150");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#play").tap();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.locator("#play").tap();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
