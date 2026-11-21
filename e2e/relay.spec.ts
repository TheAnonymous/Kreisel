import { expect, test, type Page } from "@playwright/test";
import { focus, onPhone, open, openRelay, state, status, where } from "./helpers";

/*
 * Reihum: the Kreisel goes from hand to hand as a link, a turn each.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("geht reihum von Hand zu Hand im Link", async ({ page, context, browser, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const problems = await open(page);
    const kick = (who: Page): Promise<string> => who.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[0]!.steps.slice(0, 16).map((step) => (step.on ? "x" : ".")).join(""));
    const turns = (who: Page) => who.evaluate(() => window.kreisel.app.relay.round?.turns.map((turn) => turn.name) ?? null);

    // The first turn: a name is needed, and the first person picks the rule.
    await openRelay(page);
    await expect(page.locator("#reihum")).toBeVisible();
    await page.locator("#relay-send").click();
    await expect(page.locator("#relay-message")).toContainText("Trag erst deinen Namen ein");
    await page.locator("#relay-name").fill("Jodie");
    await expect(page.locator("#relay-message")).toBeHidden();
    await page.locator("#relay-rules input").nth(1).check();
    await page.locator("#relay-send").click();
    await expect(page.locator("#toast")).toContainText("Zug 1 ist abgeschlossen");
    await expect(page.locator("#reihum")).toBeHidden();
    await expect(page.locator("#share .label")).toHaveText("Reihum · 2");
    const first = await page.evaluate(() => navigator.clipboard.readText());

    // Someone else, with a browser of their own, takes the second turn. The rule says: one ring.
    const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
    await elsewhere.grantPermissions(["clipboard-read", "clipboard-write"]);
    const guest = await elsewhere.newPage();
    await open(guest);
    await guest.goto(first);
    await expect(guest.locator("#toast")).toContainText("Reihum: Jodie hat Zug 1 gemacht. Du bist dran.");
    // Dice may land on the very pattern that lies there already: the kick is thrown until it has changed.
    await guest.keyboard.press("1");
    await expect
      .poll(async () => {
        await guest.keyboard.press("n");
        return kick(guest);
      })
      .not.toBe("x...x...x...x...");
    for (const key of ["5", "n"]) await guest.keyboard.press(key);
    await openRelay(guest);
    await expect(guest.locator("#relay-rules")).toBeHidden();
    await expect(guest.locator("#relay-rule")).toContainText("Spielregel dieser Runde: Ein Ring.");
    await expect(guest.locator("#relay-now")).toHaveText("Dein Zug (Nr. 2): Kick, Bass angefasst.");
    await guest.locator("#relay-name").fill("Mika");
    await guest.locator("#relay-send").click();
    await expect(guest.locator("#relay-message")).toContainText("ein Ring pro Zug. Du hast 2 angefasst (Kick, Bass)");
    await guest.keyboard.press("Escape");
    await guest.keyboard.press("Control+z");
    await openRelay(guest);
    await expect(guest.locator("#relay-now")).toHaveText("Dein Zug (Nr. 2): Kick angefasst.");
    await guest.locator("#relay-send").click();
    await expect(guest.locator("#toast")).toContainText("Zug 2 ist abgeschlossen");
    const second = await guest.evaluate(() => navigator.clipboard.readText());
    expect(second.length).toBeLessThan(1500);
    const answered = await kick(guest);
    expect(answered).not.toBe("x...x...x...x...");

    // Back with the first person: both turns are there, and the first can be heard again.
    await page.goto(second);
    await expect(page.locator("#toast")).toContainText("Reihum: Mika hat Zug 2 gemacht. Du bist dran.");
    expect(await turns(page)).toEqual(["Jodie", "Mika"]);
    expect(await kick(page)).toBe(answered);
    await openRelay(page);
    await expect(page.locator(".turn")).toHaveCount(2);
    await page.locator(".turn").first().getByText("Anhören").click();
    await expect(page.locator("#lookback")).toContainText("Rückblick: Zug 1 von Jodie");
    expect(await kick(page)).toBe("x...x...x...x...");
    // Looking back, nothing can be changed, but it plays.
    await page.keyboard.press("1");
    await page.keyboard.press("n");
    await expect(page.locator("#toast")).toContainText("Das ist ein Rückblick");
    expect(await kick(page)).toBe("x...x...x...x...");
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");
    await page.locator("#lookback").getByText("Zurück zu jetzt").click();
    await expect(page.locator("#lookback")).toBeHidden();
    expect(await kick(page)).toBe(answered);

    // Going on from the first turn drops the second; undo brings it back.
    await openRelay(page);
    await page.locator(".turn").first().getByText("Von hier weiter").click();
    await expect(page.locator("#toast")).toContainText("Du baust von Zug 1 weiter");
    expect(await turns(page)).toEqual(["Jodie"]);
    expect(await kick(page)).toBe("x...x...x...x...");
    await page.keyboard.press("Control+z");
    expect(await turns(page)).toEqual(["Jodie", "Mika"]);
    expect(await kick(page)).toBe(answered);

    // A round can be ended; the Kreisel stays.
    await openRelay(page);
    await page.locator("#relay-end").click();
    expect(await turns(page)).toBeNull();
    await expect(page.locator("#share .label")).toHaveText("Teilen");
    expect(await kick(page)).toBe(answered);
    await elsewhere.close();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("spielt Stille Post im Link", async ({ page, context, browser, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const veiled = (who: Page): Promise<number[]> => who.evaluate(() => [0, 1, 2, 3, 4, 5, 6].filter((ring) => window.kreisel.app.relay.veiled(ring)));
    const finish = async (who: Page, name: string, rule?: number): Promise<void> => {
      await openRelay(who);
      await who.locator("#relay-name").fill(name);
      if (rule !== undefined) await who.locator("#relay-rules input").nth(rule).check();
      await who.locator("#relay-send").click();
    };

    // It starts with one ring on an empty Kreisel: the factory groove is too much.
    await finish(page, "Jodie", 2);
    await expect(page.locator("#relay-message")).toContainText("Stille Post beginnt mit einem einzigen Ring");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.kreisel.app.newProject(true);
      window.kreisel.app.dismiss();
    });
    await page.keyboard.press("1");
    await page.keyboard.press("n");
    await finish(page, "Jodie", 2);
    await expect(page.locator("#toast")).toContainText("Zug 1 ist abgeschlossen");

    // The second person hears the kick and builds a bass to it.
    const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
    await elsewhere.grantPermissions(["clipboard-read", "clipboard-write"]);
    const guest = await elsewhere.newPage();
    await open(guest, "./");
    await guest.goto(await page.evaluate(() => navigator.clipboard.readText()));
    await expect(guest.locator("#toast")).toContainText("Stille Post von Jodie: Du hörst nur den Ring davor.");
    expect(await veiled(guest)).toEqual([]);
    await guest.keyboard.press("5");
    await guest.keyboard.press("n");
    await finish(guest, "Mika");
    await expect(guest.locator("#toast")).toContainText("Zug 2 ist abgeschlossen");

    // Back with the first: now the bass is heard and the kick is under the cloth, out of sight, hearing and reach.
    await page.goto(await guest.evaluate(() => navigator.clipboard.readText()));
    await expect(page.locator("#toast")).toContainText("Stille Post von Mika");
    expect(await veiled(page)).toEqual([0]);
    expect(await page.evaluate(() => window.kreisel.app.audible(0))).toBe(false);
    expect(await page.evaluate(() => window.kreisel.app.audible(4))).toBe(true);
    await expect(page.locator(".track.veiled")).toHaveCount(1);
    await expect(page.locator(".track.veiled .sound")).toHaveText("verdeckt");
    const before = await state(page);
    await page.keyboard.press("1");
    await expect(status(page)).toHaveText("Kick: verdeckt (Stille Post)");
    await expect(page.locator(".veil-text")).toBeVisible();
    await page.keyboard.press("n");
    await expect(page.locator("#toast")).toContainText("Dieser Ring ist verdeckt");
    await focus(page, 0);
    const spot = await where(page, 0, 6);
    await page.mouse.click(spot.x, spot.y);
    expect(await state(page)).toBe(before);
    // No listening back before the reveal.
    await openRelay(page);
    await expect(page.locator(".turn").first().getByText("Anhören")).toBeDisabled();
    await page.keyboard.press("Escape");

    // The third turn takes a free ring; then the round is revealed.
    await page.keyboard.press("2");
    await page.keyboard.press("n");
    await finish(page, "Jodie");
    await expect(page.locator("#toast")).toContainText("Zug 3 ist abgeschlossen");
    expect(await veiled(page)).toEqual([0, 4]);
    await openRelay(page);
    await page.locator("#relay-reveal").click();
    await expect(page.locator("#toast")).toContainText("Aufgedeckt");
    expect(await veiled(page)).toEqual([]);
    await expect(page.locator(".track.veiled")).toHaveCount(0);
    await openRelay(page);
    await expect(page.locator(".turn").first().getByText("Anhören")).toBeEnabled();
    await elsewhere.close();
  });
});
