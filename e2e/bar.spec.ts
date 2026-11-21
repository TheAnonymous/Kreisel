import { expect, test } from "@playwright/test";
import { onLaptop, onPhone, open, openRelay } from "./helpers";

/*
 * The bar: every thing has its place. The Kreisel's name, the speaker,
 * "Teilen", the arrow at "Aufnehmen" and the question mark each open the menu
 * for what they are about; a phone has one sheet with the same groups.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("hat für jedes Ding einen Platz in der Leiste", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");

    // The bar is one row at this size, and the three dots are a phone's.
    expect(await page.evaluate(() => {
      const top = (selector: string): number => document.querySelector(selector)!.getBoundingClientRect().top;
      return Math.abs(top(".actions") - top(".knobs")) < 30 && document.documentElement.scrollWidth <= window.innerWidth;
    })).toBe(true);
    await expect(page.locator("#more")).toBeHidden();

    // Each button opens its own menu under itself, says that it is open, and puts it away at a second press.
    const places: readonly (readonly [string, readonly string[]])[] = [
      ["kreisel-menu", ["Neu anfangen", "Leerer Kreisel", "Techno-Kreisel", "Werks-Kreisel", "Die Würfel werfen", "Zur Musik-Werkstatt"]],
      ["sound", ["Lautstärke", "Druck"]],
      ["share", ["Link kopieren", "Reihum: von Hand zu Hand"]],
      ["record-more", ["Aufnehmen, was du hörst", "Als Opus speichern"]],
      ["help-open", ["Hilfe und Tasten", "Tour: die ersten Schritte"]],
    ];
    for (const [id, rows] of places) {
      const opener = page.locator(`#${id}`);
      await opener.click();
      await expect(menu).toBeVisible();
      await expect(opener).toHaveAttribute("aria-expanded", "true");
      for (const row of rows) await expect(menu).toContainText(row);
      const button = (await opener.boundingBox())!;
      const sheet = (await menu.boundingBox())!;
      expect(sheet.y).toBeGreaterThanOrEqual(button.y + button.height);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(1366);
      await opener.click();
      await expect(menu).toBeHidden();
      await expect(opener).toHaveAttribute("aria-expanded", "false");
    }

    // One menu at a time: another button takes it over. Escape puts it away.
    await page.locator("#share").click();
    await page.locator("#help-open").click();
    await expect(menu).toContainText("Hilfe und Tasten");
    await expect(menu).not.toContainText("Link kopieren");
    await expect(page.locator("#share")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator("#help-open")).toHaveAttribute("aria-expanded", "false");

    // The speaker: both controls move what they say and the menu stays; the right button puts one back, and a
    // step back is shown where the control stands.
    const sums = (): Promise<number[]> => page.evaluate(() => [window.kreisel.app.project.volume, window.kreisel.app.project.pressure]);
    await page.locator("#sound").click();
    await page.locator("#volume").fill("50");
    await page.locator("#pressure").fill("60");
    expect(await sums()).toEqual([0.5, 0.6]);
    await expect(menu).toBeVisible();
    await page.locator("#pressure").click({ button: "right" });
    expect((await sums())[1]).toBe(0);
    await expect(page.locator("#pressure")).toHaveValue("0");
    await page.keyboard.press("Control+z");
    expect((await sums())[1]).toBe(0.6);
    await expect(page.locator("#pressure")).toHaveValue("60");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // By keyboard: Enter on a button puts the keyboard into its menu, the arrows step, Escape hands it back.
    await page.locator("#share").focus();
    await page.keyboard.press("Enter");
    await expect(menu.getByRole("menuitem", { name: /Link kopieren/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: /Reihum/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator("#share")).toBeFocused();
    await page.locator("#share").blur();

    // While a round of Reihum is going, "Teilen" says so, and the round comes first in its menu.
    await expect(page.locator("#share .label")).toHaveText("Teilen");
    await openRelay(page);
    await page.locator("#relay-name").fill("Jodie");
    await page.locator("#relay-send").click();
    await expect(page.locator("#share .label")).toHaveText("Reihum · 2");
    // A finished turn puts the window away by itself.
    await expect(page.locator("#reihum")).toBeHidden();
    await page.locator("#share").click();
    await expect(menu.getByRole("menuitem").first()).toContainText("Reihum: Zug 2 ist deiner");
    await page.keyboard.press("Escape");

    // The name starts anew, and what lay on the table comes back.
    const before = await page.evaluate(() => window.kreisel.state());
    await page.locator("#kreisel-menu").click();
    await menu.getByRole("menuitem", { name: "Leerer Kreisel" }).click();
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => window.kreisel.state())).not.toBe(before);
    await page.locator("#toast").getByRole("button", { name: "Zurück" }).click();
    expect(await page.evaluate(() => window.kreisel.state())).toBe(before);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("hat am Handy ein Blatt mit denselben Gruppen", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    for (const id of ["sound", "record-more", "help-open"]) await expect(page.locator(`#${id}`)).toBeHidden();

    await page.locator("#more").tap();
    await expect(menu).toBeVisible();
    for (const group of ["Klang", "Neu anfangen", "Die Würfel werfen", "Teilen", "Aufnahme", "Ansicht", "Hilfe"]) {
      await expect(menu.getByRole("heading", { name: group, exact: true })).toBeAttached();
    }
    // The sheet hangs under the bar's button and ends on the screen: what does not fit is reached by scrolling.
    const dots = (await page.locator("#more").boundingBox())!;
    const sheet = (await menu.boundingBox())!;
    expect(sheet.y).toBeGreaterThanOrEqual(dots.y + dots.height);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const tour = menu.getByRole("menuitem", { name: /Tour/ });
    await tour.scrollIntoViewIfNeeded();
    await expect(tour).toBeInViewport();

    // A switch shows whether it is on and keeps the sheet; a control moves what it says.
    const lights = menu.getByRole("menuitemcheckbox", { name: "Lichtspiel" });
    await expect(lights).toHaveAttribute("aria-checked", "true");
    await lights.tap();
    await expect(lights).toHaveAttribute("aria-checked", "false");
    await expect(menu).toBeVisible();
    await lights.tap();
    await expect(lights).toHaveAttribute("aria-checked", "true");
    await page.locator("#volume").scrollIntoViewIfNeeded();
    await page.locator("#volume").fill("40");
    expect(await page.evaluate(() => window.kreisel.app.project.volume)).toBe(0.4);

    // The dots put it away again; "Teilen" in the bar is the menu a laptop has there.
    await page.locator("#more").tap();
    await expect(menu).toBeHidden();
    await page.locator("#share").tap();
    await expect(menu).toContainText("Link kopieren");
    await expect(menu).toContainText("Reihum: von Hand zu Hand");
    await page.locator("#share").tap();
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
