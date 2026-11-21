import { expect, test, type Page } from "@playwright/test";
import { technoSounds } from "../src/sounds/index";
import { focus, onLaptop, onPhone, open, soundOf } from "./helpers";

/*
 * The genre's sounds: the techno group at the head of a techno Kreisel's
 * palettes, the dice that throw from it, and the hi-hat that is one voice
 * there, so that a closed hit cuts off the open one before it.
 */

const palette = (page: Page) => page.locator("#palette");
const group = (page: Page) => page.locator(".palette-techno .chip");
/** The palette's own fifty, without the ten that the techno group shows a second time. */
const fifty = (page: Page) => page.locator("#palette > .palette-row .chip");
const numbers = (track: number): number[] => technoSounds(track).map((one) => one.sound);
const inWindow = async (page: Page): Promise<boolean> => {
  const card = (await palette(page).boundingBox())!;
  const scrolls = await palette(page).evaluate((element) => element.scrollHeight - element.clientHeight > 1);
  return card.y >= 0 && card.y + card.height <= 768 && !scrolls;
};

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("stellt im Techno-Kreisel die Techno-Gruppe vor die Palette, und die Würfel werfen aus ihr", async ({ page }) => {
    const problems = await open(page);
    const dice = page.locator("#palette-dice");

    // The Werks-Kreisel's palette is the fifty in their five families, and nothing else.
    await focus(page, 2);
    await page.locator("#sound-pick").click();
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).locator(".palette-name")).toHaveText(["Seide", "Blech", "Shaker", "Zisch", "Becken"]);
    await expect(palette(page).locator(".chip")).toHaveCount(50);
    await expect(page.locator(".palette-techno")).toHaveCount(0);
    await expect(dice).toHaveAttribute("title", "Irgendeinen Klang aus der Palette nehmen");

    // A techno Kreisel's palette begins with the ring's techno group: ten of the fifty, shown a second time.
    await page.evaluate(() => window.kreisel.app.newProject(false, "techno"));
    await expect(palette(page).locator(".palette-name")).toHaveText(["Techno · zehn von den fünfzig", "Seide", "Blech", "Shaker", "Zisch", "Becken"]);
    await expect(group(page)).toHaveText(["Maschine", "Blech", "Schelle", "Rost", "Offen", "Zisch", "Shaker", "Ride", "Crash", "China"]);
    await expect(fifty(page)).toHaveCount(50);
    await expect(palette(page).locator("header")).toContainText("Hi-Hat: 50 Klänge");
    // The techno Kreisel's hi-hat is the drum machine's: it is marked in the group and where it stands in its family.
    expect(await soundOf(page, 2)).toBe(numbers(2)[0]);
    await expect(palette(page).locator(".chip[aria-pressed=true]")).toHaveText(["Maschine", "Maschine"]);
    await expect(page.locator("#sound-pick .sound-family")).toHaveText("Blech");
    expect(await inWindow(page)).toBe(true);

    // A click in the group takes the sound itself: the ride is the first of the cymbals, number 43.
    await page.locator(".palette-techno").getByRole("button", { name: "Ride", exact: true }).click();
    expect(await soundOf(page, 2)).toBe(43);
    await expect(palette(page).locator(".chip[aria-pressed=true]")).toHaveText(["Ride", "Ride"]);
    await expect(page.locator("#sound-pick .sound-name")).toHaveText("Ride");
    await expect(page.locator("#sound-pick .sound-family")).toHaveText("Becken");
    // With a cymbal on the ring, the ring's dice give it a time-keeper's hits, none of them open.
    for (let throws = 0; throws < 4; throws += 1) {
      const pitches = await page.evaluate(() => {
        const app = window.kreisel.app;
        app.rings.dice(2);
        return app.project.scenes[0]!.patterns[2]!.steps.slice(0, 16).filter((step) => step.on).map((step) => step.pitch);
      });
      expect(pitches.length).toBeGreaterThanOrEqual(4);
      expect(pitches.every((pitch) => pitch <= 0)).toBe(true);
    }
    // A sound that is not in the group is marked once.
    await fifty(page).getByText("Samt", { exact: true }).click();
    await expect(palette(page).locator(".chip[aria-pressed=true]")).toHaveText(["Samt"]);

    // The dice throw from the group: the button in the palette, and the right button on the sound's name.
    await expect(dice).toHaveAttribute("title", "Einen der zehn Techno-Klänge dieses Rings nehmen");
    let before = await soundOf(page, 2);
    for (let throws = 0; throws < 6; throws += 1) {
      if (throws % 2 === 0) await dice.click();
      else await page.locator("#sound-pick").click({ button: "right" });
      const now = await soundOf(page, 2);
      expect(numbers(2)).toContain(now);
      expect(now).not.toBe(before);
      before = now;
    }
    // The arrows still leaf through all fifty.
    await page.evaluate(() => window.kreisel.app.rings.setSound(2, 0));
    await page.getByRole("button", { name: "Nächster Klang" }).click();
    expect(await soundOf(page, 2)).toBe(7);

    // Every ring has its group. The bass has the acid machine under its palette as well, and all of it is in view.
    await focus(page, 4);
    await expect(group(page)).toHaveText(["Acid", "Kantig", "Zwitscher", "Gift", "Schnapp", "Gurgel", "Knurr", "Fuzz", "Sub", "Dunkel"]);
    await expect(page.locator("#palette-machine")).toBeVisible();
    await expect(page.locator("#palette-machine")).toHaveAttribute("aria-pressed", "true");
    await expect(palette(page).locator(".chip[aria-pressed=true]")).toHaveCount(0);
    expect(await inWindow(page)).toBe(true);
    await focus(page, 6);
    await expect(group(page)).toHaveText(["Schrei", "Säge", "Sync", "Trance", "Breit", "Quinte", "Gleiter", "Sirene", "Roboter", "Quadrat"]);
    // The ring's menu has the same dice, and says what they do.
    await page.locator(".track", { hasText: "Melodie" }).locator(".pick").click({ button: "right" });
    await page.locator("#context").getByRole("menuitem", { name: "Einen der zehn Techno-Klänge dieses Rings nehmen" }).click();
    expect(numbers(6)).toContain(await soundOf(page, 6));
    expect(await soundOf(page, 6)).not.toBe(3);
    await page.keyboard.press("Escape");

    // The style switched to free: the group leaves the palette, and the dice throw from all fifty again.
    await page.evaluate(() => window.kreisel.app.toggleStyle());
    await expect(page.locator(".palette-techno")).toHaveCount(0);
    await expect(palette(page).locator(".chip")).toHaveCount(50);
    await expect(dice).toHaveAttribute("title", "Irgendeinen Klang aus der Palette nehmen");
    await page.evaluate(() => window.kreisel.app.toggleStyle());
    await expect(group(page)).toHaveCount(10);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("schneidet im Techno-Kreisel die offene Hi-Hat mit der geschlossenen ab", async ({ page }) => {
    // Ten renders of the Kreisel.
    test.setTimeout(90_000);
    const problems = await open(page);
    const louder = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);
    // The hi-hat's ring by itself and dry: one open hit, loud, and (with `shut`) a quiet closed one a step after it.
    // What the cut-off takes away is the open hit's ringing after that step, so it is measured on sounds that ring long.
    const hat = (style: "techno" | "frei", sound: number, shut: boolean) => page.evaluate(async ([manner, number, closed]) => {
      const app = window.kreisel.app;
      app.newProject(true, "techno");
      app.setGlobal({ pressure: 0, style: manner });
      for (let ring = 0; ring < 7; ring += 1) app.rings.setTrack(ring, { mute: ring !== 2, drive: 0, hall: 0, echo: 0 });
      app.rings.setTrack(2, { sound: number });
      app.rings.addNote(2, 2, { pitch: 3, vel: 2 }, "probe");
      if (closed) app.rings.addNote(2, 3, { pitch: 0, vel: 0 }, "probe");
      return window.kreisel.whole();
    }, [style, sound, shut] as const);
    const crash = 45;
    const offen = 34;

    // As a drum machine has it, the closed hit cuts the open one off; where every hit rings out, the crash rings on over it.
    const cut = await hat("techno", crash, true);
    const ringing = await hat("frei", crash, true);
    expect(louder(ringing, cut)).toBeGreaterThan(1.5);
    expect(cut.peak).toBeGreaterThan(0.02);
    expect(cut.peak).toBeCloseTo(ringing.peak, 1);
    // It is the ring that is one voice, not one sound: an open hat is cut off as well, with less to lose.
    expect(louder(await hat("frei", offen, true), await hat("techno", offen, true))).toBeGreaterThan(0.4);
    // Without a closed hit nothing is cut: the open hit rings out the same either way.
    expect(Math.abs(louder(await hat("frei", crash, false), await hat("techno", crash, false)))).toBeLessThan(0.2);

    // The techno Kreisel's own hi-hat is open far enough to ring into the closed hit after it; all of it is no louder than before.
    const whole = await page.evaluate(async () => {
      const app = window.kreisel.app;
      app.newProject(false, "techno");
      const open = app.project.scenes[0]!.patterns[2]!.steps.filter((step) => step.on && step.pitch > 0).map((step) => step.pitch);
      return { open, heard: await window.kreisel.whole() };
    });
    expect(whole.open).toEqual([6, 6, 6, 6]);
    expect(whole.heard.peak).toBeLessThanOrEqual(0.99);
    expect(whole.heard.crest).toBeLessThan(12);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("zeigt am Handy die Techno-Gruppe zuerst, drei nebeneinander, und ein Finger wählt", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.kreisel.app.newProject(false, "techno");
      window.kreisel.app.select(1);
    });
    await page.locator("#sound-pick").scrollIntoViewIfNeeded();
    await page.locator("#sound-pick").tap();
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).locator(".palette-name").first()).toHaveText("Techno · zehn von den fünfzig");
    await expect(group(page)).toHaveCount(10);
    // Three abreast: the fourth stands under the first. (Where they stand in the row, not on the screen: the palette is still unfolding.)
    const places = await group(page).evaluateAll((chips) => chips.map((chip) => [(chip as HTMLElement).offsetLeft, (chip as HTMLElement).offsetTop] as const));
    expect(places[3]![0]).toBe(places[0]![0]);
    expect(places[3]![1]).toBeGreaterThan(places[0]![1]);
    expect(places[1]![1]).toBe(places[0]![1]);
    await page.locator(".palette-techno").getByRole("button", { name: "Schrot", exact: true }).tap();
    expect(numbers(1)).toContain(await soundOf(page, 1));
    await expect(page.locator("#sound-pick .sound-name")).toHaveText("Schrot");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
