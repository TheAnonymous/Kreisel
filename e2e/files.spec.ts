import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { copyLink, heard, onPhone, open, state, status } from "./helpers";

/*
 * What leaves the page and comes back: the link, the browser's memory, saved
 * sound, and the page without a network.
 */

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("shares the Kreisel as a link and keeps your own", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.keyboard.press("n");
    await page.locator("#bpm").fill("133");
    await page.locator("#bpm").blur();
    const shared = await state(page);
    await copyLink(page);
    await expect(page.locator("#toast")).toContainText("Link copied");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/Kreisel\/#k=1\.[0-9A-Za-z_-]+$/);
    expect(link.length).toBeLessThan(1200);

    const other = await context.newPage();
    await open(other);
    const mine = await state(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("A shared Kreisel");
    expect(await state(other)).toBe(shared);
    expect(other.url()).not.toContain("#");
    await other.locator("#toast").getByRole("button", { name: "Back to mine" }).click();
    expect(await state(other)).toBe(mine);

    await other.goto(`${new URL(link).origin}/Kreisel/#k=1.kaputt`);
    await expect(other.locator("#toast")).toContainText("could not be opened");
  });

  test("remembers the Kreisel over a restart", async ({ page }) => {
    await open(page);
    await page.keyboard.press("n");
    await page.locator("#pump").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.kreisel.app.project.pump)).toBeCloseTo(0.32);
    const before = await state(page);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(status(page)).toContainText("Melody:");
    expect(await state(page)).toBe(before);
  });

  test("saves as Opus: the scene and a recording", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 180 }));
    await page.locator("#record-more").click();
    const rendered = page.waitForEvent("download");
    await page.locator("#context").getByText("Save as Opus").click();
    const saved = await rendered;
    // The name stays an Opus file's, also in Firefox (which renames files whose type it thinks it knows better).
    expect(saved.suggestedFilename()).toBe("kreisel.opus");
    await expect(page.locator("#toast")).toContainText("The scene saved as Opus");
    const scene = await heard(page, saved);
    // Eight bars at 180 BPM are a little over ten seconds, plus what rings out; in stereo, ended properly.
    expect(scene.seconds).toBeGreaterThan(10.6);
    expect(scene.seconds).toBeLessThan(14);
    expect(scene.channels).toBe(2);
    expect(scene.ended).toBe(true);
    // The browser plays what it wrote: as long as the file says, and not silent.
    expect(Math.abs(scene.decoded - scene.seconds)).toBeLessThan(0.05);
    expect(scene.peak).toBeGreaterThan(0.2);
    expect(scene.peak).toBeLessThanOrEqual(1);
    // A tenth and less of what the WAV weighed.
    expect(scene.bytes).toBeGreaterThan(60_000);
    expect(scene.bytes).toBeLessThan(500_000);

    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(1800);
    const taken = page.waitForEvent("download");
    await page.locator("#record").click();
    const take = await taken;
    expect(take.suggestedFilename()).toBe("kreisel-recording.opus");
    await expect(page.locator("#toast")).toContainText("Recording saved as Opus");
    const recording = await heard(page, take);
    expect(recording.seconds).toBeGreaterThan(1);
    expect(recording.seconds).toBeLessThan(5);
    expect(recording.peak).toBeGreaterThan(0.05);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("saves a WAV where the browser cannot write Opus", async ({ page }) => {
    await page.addInitScript(() => {
      // A browser without the encoder, as older ones are.
      delete (window as { AudioEncoder?: unknown }).AudioEncoder;
    });
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 180 }));
    await page.locator("#record-more").click();
    const rendered = page.waitForEvent("download");
    await page.locator("#context").getByText("Save as Opus").click();
    const wav = await rendered;
    expect(wav.suggestedFilename()).toBe("kreisel.wav");
    await expect(page.locator("#toast")).toContainText("saved as WAV (this browser cannot write Opus)");
    const bytes = readFileSync(await wav.path());
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    // Eight bars at 180 BPM are a little over ten seconds of 16-bit stereo.
    expect(bytes.length).toBeGreaterThan(1_500_000);
    let peak = 0;
    for (let offset = 44; offset + 1 < bytes.length; offset += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(6000);
    expect(peak).toBeLessThan(32_500);
    expect(problems).toEqual([]);
  });

  test("also starts without a network", async ({ page, context }) => {
    await open(page);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 10_000 }).toBe("activated");
    await context.setOffline(true);
    await page.reload();
    await expect(status(page)).toContainText("Melody: 7 hits");
    await context.setOffline(false);
  });
});
