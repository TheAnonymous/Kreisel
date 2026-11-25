import { expect, test } from "@playwright/test";
import { onLaptop, onPhone, open, status, where } from "./helpers";

/*
 * How the page moves and shows itself: the small motions, the light show and
 * the stage. (The guide of a first visit has a file of its own, guide.spec.ts;
 * here is only how the wheel answers a task that was done.)
 */

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("moves where something changes, and keeps still when less motion is wanted", async ({ page }) => {
    const problems = await open(page);
    /** What is in motion on the wheel two frames from now (a change is looked at in the next frame). */
    const moving = (): Promise<{ popping: number; shrinking: number; sliding: number }> =>
      page.evaluate(async () => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return window.kreisel.motion();
      });
    /** The motions that play on a node or in it right now, by name. */
    const playing = (selector: string): Promise<string[]> =>
      page.evaluate((query) => [...document.querySelectorAll(query)].flatMap((node) => node.getAnimations({ subtree: true })).map((motion) => motion.id || (motion instanceof CSSAnimation ? motion.animationName : "")), selector);
    const still = { popping: 0, shrinking: 0, sliding: 0 };

    // At first the hits of the factory Kreisel are dealt around their rings; then the wheel lies still.
    expect((await moving()).popping).toBeGreaterThan(10);
    await expect.poll(moving).toEqual(still);

    // A hit that is set hops in, one that is taken shrinks away, a ring that is turned slides.
    const free = await where(page, 6, 1);
    await page.mouse.click(free.x, free.y);
    expect(await moving()).toEqual({ popping: 1, shrinking: 0, sliding: 0 });
    await expect.poll(moving).toEqual(still);
    await page.mouse.click(free.x, free.y);
    expect(await moving()).toEqual({ popping: 0, shrinking: 1, sliding: 0 });
    await expect.poll(moving).toEqual(still);
    await page.mouse.move(free.x, free.y);
    await page.mouse.wheel(0, -100);
    expect(await moving()).toEqual({ popping: 0, shrinking: 0, sliding: 1 });
    await expect.poll(moving).toEqual(still);

    // A diced ring deals its new pattern, the dice in its row tumble and the button answers; so does a key.
    await page.locator(".panel-ring .doing .button", { hasText: "Dice" }).click();
    expect(await playing(".track.selected .roll")).toContain("tumble");
    expect(await playing(".panel-ring .doing")).toContain("flash");
    await expect.poll(moving).toEqual(still);
    await page.keyboard.press("Control+z");
    expect(await playing("#undo")).toContain("wind-back");
    await page.keyboard.press("Control+Shift+z");
    expect(await playing("#redo")).toContain("wind-on");

    // Menus unfold, the head of the ring's panel arrives, a held effect shows on its key what it does.
    await page.locator("#help-open").click();
    expect(await playing("#context")).toContain("unfold");
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 400);
    await expect(page.locator("#context")).toBeHidden();
    await page.keyboard.press("5");
    expect(await playing(".panel-head")).toEqual(expect.arrayContaining(["pop", "slide-in"]));
    await page.keyboard.down("KeyC");
    await expect.poll(() => playing('.pad-fx[data-fx="stotter"]')).toContain("stutter");
    await page.keyboard.up("KeyC");
    await expect.poll(() => playing('.pad-fx[data-fx="stotter"]')).not.toContain("stutter");

    // At rest nothing runs (but the ring that beckons to the start, a few times, until the Kreisel has played once).
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().filter((motion) => motion.playState === "running" && !(motion instanceof CSSAnimation && motion.animationName === "beckon")).length))
      .toBe(0);

    // Whoever asked the system for less motion gets none: nothing hops on the wheel, and nothing plays on the page.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(status(page)).toContainText("hits");
    expect(await moving()).toEqual(still);
    const again = await where(page, 6, 1);
    await page.mouse.click(again.x, again.y);
    expect(await moving()).toEqual(still);
    await page.locator(".panel-ring .doing .button", { hasText: "Dice" }).click();
    expect(await moving()).toEqual(still);
    await page.locator("#help-open").click();
    expect(await page.evaluate(() => document.getAnimations().filter((motion) => Number(motion.effect?.getComputedTiming().activeDuration ?? 0) > 1).length)).toBe(0);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("answers a task of the guide that was done with a wave and sparks from the wheel's middle, and keeps still where that is not wanted", async ({ page }) => {
    const problems = await open(page, "./", true);
    const light = (): Promise<{ sparks: number; waves: number; glowing: boolean }> => page.evaluate(() => window.kreisel.light());
    const dark = { sparks: 0, waves: 0, glowing: false };
    const count = page.locator("#tour-count");
    const kick = page.locator('#tracks .track[data-track="0"] .mute');
    /** Waits until the task that is up was noticed as done, and says what the light show has in the air in that moment. */
    const cheered = async (): Promise<{ sparks: number; waves: number; glowing: boolean } | null> => {
      const seen = await page.waitForFunction(() => (window.kreisel.app.guide.done ? window.kreisel.light() : null));
      return seen.jsonValue();
    };

    // The first steps lie under the wheel. Nothing plays, so nothing throws light.
    await expect(count).toHaveText("Step 1 of 5");
    expect(await light()).toEqual(dark);
    await page.locator("#tour-next").click();
    await expect(count).toHaveText("Step 2 of 5");

    // The kick out and back: the task is done, and the wheel answers, although it stands still.
    const answer = page.waitForFunction(() => {
      const air = window.kreisel.light();
      return air.waves > 0 && air.sparks > 0 && air.glowing ? air : null;
    });
    await kick.click();
    await kick.click();
    await expect(count).toHaveText("Done");
    expect((await (await answer).jsonValue())!.sparks).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => window.kreisel.app.playing)).toBe(false);
    // It is a moment's answer: then the table is dark again.
    await expect.poll(light, { timeout: 4000 }).toEqual(dark);

    // With the light show switched off, a task that was done is only said, not lit. (The next task comes by itself
    // once there was time to read what the card says.)
    await expect(count).toHaveText("Step 3 of 5", { timeout: 10_000 });
    await page.locator("#lights-toggle").click();
    await page.locator("#tour-show").click();
    expect(await cheered()).toEqual(dark);
    await page.waitForTimeout(300);
    expect(await light()).toEqual(dark);
    await page.locator("#lights-toggle").click();

    // Whoever asked the system for less motion gets no answer in light either.
    await expect(count).toHaveText("Step 4 of 5", { timeout: 10_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#tour-show").click();
    expect(await cheered()).toEqual(dark);
    await page.waitForTimeout(300);
    expect(await light()).toEqual(dark);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("throws light while it plays, and goes onto the stage", async ({ page }) => {
    const problems = await open(page);
    const light = (): Promise<{ sparks: number; waves: number; glowing: boolean }> => page.evaluate(() => window.kreisel.light());
    const dark = { sparks: 0, waves: 0, glowing: false };
    /** How much is painted on the canvas of the glow under the wheel. */
    const glow = (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.getElementById("licht") as HTMLCanvasElement;
        const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let index = 3; index < data.length; index += 4) sum += data[index] ?? 0;
        return sum;
      });
    expect(await light()).toEqual(dark);
    expect(await glow()).toBe(0);
    // Until the Kreisel has played once, a ring around the hub beckons to the start.
    await expect(page.locator(".invite")).toBeVisible();

    await page.keyboard.press("Space");
    await expect.poll(async () => (await light()).glowing).toBe(true);
    await expect.poll(async () => (await light()).sparks, { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await light()).waves, { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(glow).toBeGreaterThan(0);
    await expect(page.locator(".invite")).toBeHidden();

    // Switched off with the lamp beside the wheel it is dark at once and stays so, also after a reload; switched on, it is back.
    const lights = page.locator("#lights-toggle");
    await expect(lights).toHaveAttribute("aria-pressed", "true");
    await lights.click();
    await expect(page.locator("#toast")).toContainText("Light show off");
    await expect.poll(light).toEqual(dark);
    await page.waitForTimeout(700);
    expect(await light()).toEqual(dark);
    expect(await glow()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("kreisel.licht"))).toBe("0");
    await expect(lights).toHaveAttribute("aria-pressed", "false");
    await lights.click();
    await expect.poll(async () => (await light()).glowing).toBe(true);

    // The stage: only the wheel, larger, in the dark. The tools and the held effects stay at hand.
    const root = page.locator("html");
    const wide = async (): Promise<number> => (await page.locator("#kreisel").boundingBox())!.width;
    const before = await wide();
    await page.keyboard.press("o");
    await expect(root).toHaveAttribute("data-stage", "true");
    await expect(page.locator(".side.left")).toBeHidden();
    await expect(page.locator("#panel")).toBeHidden();
    await expect(page.locator(".bar")).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();
    await expect(page.locator("#fx")).toBeVisible();
    await expect.poll(wide).toBeGreaterThan(before * 1.15);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())).toBe("#0b0910");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    // The wheel still takes a hit there.
    const spot = await where(page, 6, 2);
    const hits = (): Promise<number> => page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[6]!.steps.filter((step) => step.on).length);
    const had = await hits();
    await page.mouse.click(spot.x, spot.y);
    expect(Math.abs((await hits()) - had)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-stage", "false");
    await expect(page.locator(".side.left")).toBeVisible();
    await expect.poll(wide).toBeLessThan(before * 1.05);
    // Its button in the corner beside the wheel leads there and back; a window that opens takes the Kreisel off it.
    const toggle = page.locator("#stage-toggle");
    await toggle.click();
    await expect(root).toHaveAttribute("data-stage", "true");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(root).toHaveAttribute("data-stage", "false");
    await toggle.click();
    await page.evaluate(() => window.kreisel.app.voice.open());
    await expect(root).toHaveAttribute("data-stage", "false");
    await expect(page.locator("#booth")).toBeVisible();
    await page.evaluate(() => {
      window.kreisel.app.voice.close();
      window.kreisel.app.togglePlay();
    });
    expect(await page.evaluate(() => window.kreisel.app.playing)).toBe(false);

    // Whoever asked the system for less motion never sees the light show.
    await expect.poll(light, { timeout: 4000 }).toEqual(dark);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.kreisel.app.togglePlay());
    await page.waitForTimeout(900);
    expect(await light()).toEqual(dark);
    expect(await glow()).toBe(0);
    await page.evaluate(() => window.kreisel.app.togglePlay());
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("goes onto the stage on a phone, and the page is never wider than the window", async ({ page }) => {
    const problems = await open(page);
    // Glow or not, the page is never wider than the window.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);

    // The stage: the button in the corner beside the wheel leads there and back.
    const root = page.locator("html");
    const toggle = page.locator("#stage-toggle");
    await toggle.tap();
    await expect(root).toHaveAttribute("data-stage", "true");
    await expect(page.locator(".side.left")).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await toggle.tap();
    await expect(root).toHaveAttribute("data-stage", "false");
    await expect(page.locator(".side.left")).toBeVisible();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
