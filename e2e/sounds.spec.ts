import { expect, test, type Page } from "@playwright/test";
import { focus, onLaptop, onPhone, open, soundOf, where } from "./helpers";

/*
 * The palettes: fifty ready-made sounds for every ring, in five families of
 * ten. Leafing through them, the palette itself, and that every one of them
 * sounds.
 */

const picked = (page: Page) => page.locator("#sound-pick .sound-name");
const family = (page: Page) => page.locator("#sound-pick .sound-family");
const palette = (page: Page) => page.locator("#palette");
const pressed = (page: Page) => page.locator("#palette .chip[aria-pressed=true]");

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("leafs through fifty sounds and shows them in the palette", async ({ page }) => {
    const problems = await open(page);
    await focus(page, 0);
    await expect(picked(page)).toHaveText("Round");
    await expect(family(page)).toHaveText("Round");

    // The arrows leaf through the palette, round and round.
    await page.getByRole("button", { name: "Next sound" }).click();
    await expect(picked(page)).toHaveText("Velvet");
    expect(await soundOf(page, 0)).toBe(7);
    await expect(page.locator(".track.selected .sound")).toHaveText("Velvet");
    await page.getByRole("button", { name: "Previous sound" }).click();
    await page.getByRole("button", { name: "Previous sound" }).click();
    await expect(picked(page)).toHaveText("Kettle");
    await expect(family(page)).toHaveText("Skewed");
    expect(await soundOf(page, 0)).toBe(52);
    // Trying one sound after another is one step back.
    await page.locator("#undo").click();
    expect(await soundOf(page, 0)).toBe(0);

    // A click on the name opens the palette: five families of ten, each sound one click away.
    await page.locator("#sound-pick").click();
    await expect(palette(page)).toBeVisible();
    await expect(page.locator("#sound-pick")).toHaveAttribute("aria-expanded", "true");
    await expect(palette(page).locator("header")).toContainText("Kick: 50 sounds");
    await expect(palette(page).locator(".palette-name")).toHaveText(["Round", "Hard", "Deep", "Dust", "Skewed"]);
    await expect(palette(page).locator(".chip")).toHaveCount(50);
    await expect(pressed(page)).toHaveText(["Round"]);
    const names = await palette(page).locator(".chip").allTextContents();
    expect(new Set(names).size).toBe(50);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth && document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
    // Once it has unfolded, it stands beside the panel and inside the window.
    const panel = (await page.locator("#panel").boundingBox())!;
    await expect.poll(async () => (await palette(page).boundingBox())!.width).toBe(560);
    const card = (await palette(page).boundingBox())!;
    expect(card.x + card.width).toBeLessThanOrEqual(panel.x);
    expect(card.y + card.height).toBeLessThanOrEqual(768);

    await palette(page).getByRole("button", { name: "Thunder", exact: true }).click();
    expect(await soundOf(page, 0)).toBe(32);
    await expect(pressed(page)).toHaveText(["Thunder"]);
    await expect(picked(page)).toHaveText("Thunder");
    await expect(family(page)).toHaveText("Deep");
    // It stays open while sounds are tried, also when another ring is picked.
    await page.locator(".track", { hasText: "Bass" }).locator(".pick").click();
    await expect(palette(page).locator("header")).toContainText("Bass: 50 sounds");
    await expect(palette(page).locator(".palette-name")).toHaveText(["Sub", "Saw", "Acid", "Rubber", "String"]);
    await expect(pressed(page)).toHaveText(["Rubber"]);
    await page.locator("#palette-dice").click();
    await expect(pressed(page)).not.toHaveText(["Rubber"]);
    const diced = await soundOf(page, 4);
    expect(await page.evaluate((sound) => window.kreisel.palette.includes(sound), diced)).toBe(true);

    // Escape puts it away, and so does a press beside it.
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await page.locator("#sound-pick").click();
    await expect(palette(page)).toBeVisible();
    await page.locator("#status").click();
    await expect(palette(page)).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("also leafs with the keys, dices with the right button and has the sounds in the ring's menu", async ({ page }) => {
    const problems = await open(page);
    await focus(page, 6);
    await page.locator("#kreisel").focus();
    await page.keyboard.press("i");
    await expect(picked(page)).toHaveText("Harp");
    await page.keyboard.press("i");
    await expect(picked(page)).toHaveText("Koto");
    await page.keyboard.press("u");
    await expect(picked(page)).toHaveText("Harp");
    await page.keyboard.press("p");
    await expect(palette(page)).toBeVisible();
    await expect(pressed(page)).toHaveText(["Harp"]);
    await page.keyboard.press("p");
    await expect(palette(page)).toBeHidden();

    // The right button on the name takes some other sound.
    const before = await soundOf(page, 6);
    await page.locator("#sound-pick").click({ button: "right" });
    await expect.poll(() => soundOf(page, 6)).not.toBe(before);
    await expect(page.locator("#context")).toBeHidden();

    // The ring's own menu leafs too, and leads to the palette.
    const menu = page.locator("#context");
    const spot = await where(page, 5, 1);
    await focus(page, 5);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Next sound from the palette" }).click();
    expect(await soundOf(page, 5)).toBe(25);
    // The menu stays open and says what is there now.
    await expect(menu.getByRole("menuitem", { name: "Show all 50 sounds of this ring" })).toHaveText("Velvet piano");
    await menu.getByRole("menuitem", { name: "Previous sound from the palette" }).click();
    expect(await soundOf(page, 5)).toBe(2);
    await expect(menu.getByRole("menuitem", { name: "Show all 50 sounds of this ring" })).toHaveText("E-piano");
    await menu.getByRole("menuitem", { name: "Show all 50 sounds of this ring" }).click();
    await expect(menu).toBeHidden();
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).locator("header")).toContainText("Chords: 50 sounds");
    await page.locator("#palette-done").click();
    await expect(palette(page)).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("lets each of the 350 sounds be heard, all about as loud", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page);
    const heard = await page.evaluate(async () => {
      const rings = [];
      for (let track = 0; track < 7; track += 1) {
        const row = [];
        for (const sound of window.kreisel.palette) row.push(await window.kreisel.hear(track, sound));
        rings.push(row);
      }
      return rings;
    });
    expect(heard).toHaveLength(7);
    for (const [track, row] of heard.entries()) {
      expect(row).toHaveLength(50);
      // The ring's four classics set the level; they stand at the head of the first four families.
      const classics = [0, 10, 20, 30].map((index) => row[index]!);
      const quietest = Math.min(...classics.map((one) => one.loud));
      const loudest = Math.max(...classics.map((one) => one.loud));
      const ceiling = Math.max(...classics.map((one) => one.peak));
      for (const [index, one] of row.entries()) {
        const where = `ring ${track}, sound ${index} of its palette`;
        expect(Number.isFinite(one.peak) && Number.isFinite(one.loud), where).toBe(true);
        // None is silent, none stands out: no more than 12 dB below the quietest classic or 3 dB above the loudest, and no peak far above theirs.
        expect(one.loud, where).toBeGreaterThan(quietest / 4);
        expect(one.loud, where).toBeLessThan(loudest * 1.42);
        expect(one.peak, where).toBeLessThan(ceiling * 1.6);
        expect(one.seconds, where).toBeGreaterThan(0.005);
        expect(one.seconds, where).toBeLessThan(2.9);
      }
      // And they are fifty sounds, not one sound fifty times.
      const prints = new Set(row.map((one) => `${one.peak.toFixed(3)} ${one.seconds.toFixed(2)} ${Math.round(one.bright)}`));
      expect(prints.size, `ring ${track}`).toBe(50);
    }
    expect(problems).toEqual([]);
  });

  test("lets the sound pad shape the new sounds too and remembers them over a restart", async ({ page }) => {
    const problems = await open(page);
    // Brightness: a bell has more overtones with the point on the right. Length: a kick and a bell ring longer with the point at the top.
    const bright = await page.evaluate(async () => [await window.kreisel.hear(6, 21, 0.1, 0.5), await window.kreisel.hear(6, 21, 0.9, 0.5)]);
    expect(bright[1]!.bright).toBeGreaterThan(bright[0]!.bright * 1.3);
    const kick = await page.evaluate(async () => [await window.kreisel.hear(0, 7, 0.5, 0.1), await window.kreisel.hear(0, 7, 0.5, 0.9)]);
    expect(kick[1]!.seconds).toBeGreaterThan(kick[0]!.seconds * 1.5);
    const bell = await page.evaluate(async () => [await window.kreisel.hear(6, 17, 0.5, 0.1), await window.kreisel.hear(6, 17, 0.5, 0.9)]);
    expect(bell[1]!.seconds).toBeGreaterThan(bell[0]!.seconds * 1.5);

    await focus(page, 3);
    await page.locator("#sound-pick").click();
    await palette(page).getByRole("button", { name: "Kalimba", exact: true }).click();
    const sound = await soundOf(page, 3);
    expect(sound).toBe(41);
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.locator("#status")).toContainText("hits");
    expect(await soundOf(page, 3)).toBe(41);
    await expect(page.locator(".track", { hasText: "Drum" }).locator(".sound")).toHaveText("Kalimba");
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("puts the palette at the bottom edge on a phone, and a finger picks", async ({ page }) => {
    const problems = await open(page);
    await focus(page, 2);
    await page.locator("#sound-pick").scrollIntoViewIfNeeded();
    await page.locator("#sound-pick").tap();
    await expect(palette(page)).toBeVisible();
    const view = page.viewportSize()!;
    // Once it has unfolded, it lies along the bottom from edge to edge.
    await expect.poll(async () => {
      const card = (await palette(page).boundingBox())!;
      return Math.abs(card.y + card.height - view.height) + Math.abs(card.x) + Math.abs(card.width - view.width);
    }).toBeLessThan(2);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await palette(page).getByRole("button", { name: "Tambourine", exact: true }).scrollIntoViewIfNeeded();
    await palette(page).getByRole("button", { name: "Tambourine", exact: true }).tap();
    expect(await soundOf(page, 2)).toBe(48);
    await expect(pressed(page)).toHaveText(["Tambourine"]);
    await page.locator("#palette-done").tap();
    await expect(palette(page)).toBeHidden();
    await expect(picked(page)).toHaveText("Tambourine");
    expect(problems).toEqual([]);
  });
});
