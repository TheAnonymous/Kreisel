import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { deserialize, encodeLink } from "../src/codec";
import { emptyStep, SAMPLE_SOUND, type Sample } from "../src/model";
import { FITS, MODES, packSample, sliceOffset } from "../src/sample";
import { focus, fromBar, onLaptop, onPhone, open, soundOf, state, status, where } from "./helpers";

/*
 * The sampler: a ring plays a recording. It comes from a file (picked,
 * dropped or pasted), from the microphone, or from the Kreisel itself,
 * resampled onto a ring. It is played as a one-shot or lies around the ring
 * in slices, and the browser keeps it: a link names a recording and how it is
 * played, the Kreisel's own file carries the sound as well.
 *
 * What a ring plays is measured on the ring by itself, rendered faster than
 * it plays. The test sounds are in e2e/fixtures/samples/ (a pluck on the note
 * A with silence around it, and two bars of drums at 150 BPM, each in every
 * format the sampler reads); scripts/make-sample-fixtures.mjs makes them.
 */

const NAMES = ["Kick", "Snare", "Hi-Hat", "Drum", "Bass", "Chords", "Melody"] as const;
/** The two ways a recording is played, as a sample carries them: all of it at every hit (the page says "One-shot"), or in slices. */
const ONE_SHOT = 0;
const SLICES = 1;

/** The pluck in every form the sampler reads, and what the page calls each. */
const FORMATS = [
  ["hit.wav", "WAV"],
  ["hit-24bit.wav", "WAV"],
  ["hit.aiff", "AIFF"],
  ["hit.mp3", "MP3"],
  ["hit.ogg", "Ogg Vorbis"],
  ["hit.opus", "Opus"],
  ["hit.flac", "FLAC"],
  ["hit.m4a", "AAC (M4A)"],
  ["hit.webm", "WebM"],
] as const;

/** How the board begins to speak of a ring that has no recording. */
const NO_RECORDING = "This ring has no recording yet.";
const NOT_HERE = "This browser does not have “hit”. Load the file again (or the Kreisel's own file, which carries its recordings): until then this ring is silent.";
/** A hit as "A hit on every step" and a resample lay it: there, and nothing else about it. */
const PLAIN_HIT = { ...emptyStep(), on: true };

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/samples/${name}`, import.meta.url));

const sampleOf = (page: Page, ring: number): Promise<Sample | null> => page.evaluate((index) => window.kreisel.app.project.tracks[index]!.sample ?? null, ring);
const trackOf = (page: Page, ring: number) => page.evaluate((index) => window.kreisel.app.project.tracks[index]!, ring);
/** Whether the recording of the ring in focus is "ready", "loading" or "missing" in this browser; "none" for a ring without a sample. */
const recording = (page: Page): Promise<string> => page.evaluate(() => window.kreisel.app.sample.state);
/** What the page said last. */
const said = (page: Page): Promise<string> => page.evaluate(() => window.kreisel.app.toast?.text ?? "");
const dismiss = (page: Page): Promise<void> => page.evaluate(() => window.kreisel.app.dismiss());
const dB = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);
/** All the steps of a ring of so many: where a recording plays through. */
const everyStep = (count: number): number[] => Array.from({ length: count }, (_, step) => step);

/** How long a ring is in the scene on the table, and which of its steps have a hit. */
const ringOf = (page: Page, ring: number): Promise<{ len: number; hits: number[] }> =>
  page.evaluate((index) => {
    const project = window.kreisel.app.project;
    const pattern = project.scenes[project.scene]!.patterns[index]!;
    return { len: pattern.len, hits: pattern.steps.slice(0, pattern.len).flatMap((step, at) => (step.on ? [at] : [])) };
  }, ring);

/** The hits of a ring as they are laid: how loud, how often, how high. */
const hitsOf = (page: Page, ring: number) =>
  page.evaluate((index) => {
    const project = window.kreisel.app.project;
    const pattern = project.scenes[project.scene]!.patterns[index]!;
    return pattern.steps.slice(0, pattern.len).filter((step) => step.on);
  }, ring);

/** Lays a ring's hits anew: on every step, or on the first step only. Not a step back of its own. */
const lay = (page: Page, ring: number, hits: "every step" | "the first step"): Promise<void> =>
  page.evaluate(([index, all]) => {
    window.kreisel.app.store.touch((project) => {
      project.scenes[project.scene]!.patterns[index]!.steps.forEach((step, at) => Object.assign(step, { on: all || at === 0, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 1 }));
    });
  }, [ring, hits === "every step"] as const);

/** The plain techno Kreisel on the table (in G, at 150 BPM, a scene of one bar of chords), and nothing said yet. */
async function begin(page: Page): Promise<string[]> {
  const problems = await open(page);
  await page.evaluate(() => {
    window.plainTechno();
    window.kreisel.app.dismiss();
  });
  return problems;
}

/** The techno Kreisel as it comes, with its pedals, its weather, its hard kick and the kick's Nachbeben. */
async function beginWorn(page: Page): Promise<string[]> {
  const problems = await open(page);
  await page.evaluate(() => {
    window.kreisel.app.newProject(false, "techno");
    window.kreisel.app.dismiss();
  });
  return problems;
}

/** Nothing went wrong on the page, and nothing was blocked. */
async function clean(page: Page, problems: string[]): Promise<void> {
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(problems).toEqual([]);
}

/** Puts a ring in focus and turns its panel over to its sampler. */
async function turnOver(page: Page, ring: number): Promise<void> {
  await focus(page, ring);
  if (await page.locator("#sampler").isHidden()) await page.locator("#sample-open").click();
  await expect(page.locator("#sample-title")).toHaveText(`${NAMES[ring]}: sample`);
}

/** Waits for what was just asked of the sampler: the page has said how it went, and nothing is being read or resampled any more. */
const settled = (page: Page) => page.waitForFunction(() => window.kreisel.app.toast !== null && window.kreisel.app.sample.busy === null, undefined, { timeout: 30_000 });

/** Picks a file in the sampler's file dialog, for the ring in focus, and waits until the page has said what became of it. */
async function pick(page: Page, path: string): Promise<void> {
  await dismiss(page);
  await page.setInputFiles("#sample-file", path);
  await settled(page);
}

/** Loads one of the test sounds onto a ring through its sampler. */
async function load(page: Page, ring: number, name: string): Promise<void> {
  await turnOver(page, ring);
  await pick(page, fixture(name));
}

/** Presses one of the sampler's buttons that take a moment (resampling, a kept recording, saving) and waits until the page has said how it went. */
async function press(page: Page, button: Locator): Promise<void> {
  await dismiss(page);
  await button.click();
  await settled(page);
}

/** Leaves one ring to be heard: the others are muted and the piece is off. Not a step back of its own. */
const only = (page: Page, ring: number): Promise<void> =>
  page.evaluate((index) => {
    window.kreisel.app.store.touch((project) => {
      project.tracks.forEach((track, at) => { track.mute = at !== index; });
      project.piece.on = false;
    });
  }, ring);

/** One ring by itself, rendered faster than it plays (its scene twice through its chords) and measured. */
async function alone(page: Page, ring: number) {
  await only(page, ring);
  return page.evaluate(() => window.kreisel.whole());
}

/** Which place in the beat is the loudest when one ring plays by itself: 0 on the beat, 1 to 3 the sixteenths after it. In the test loop that is where the kick is. */
async function kickAt(page: Page, ring: number): Promise<number> {
  await only(page, ring);
  const loud = await page.evaluate(async () => (await window.kreisel.beats(4)).slice(0, 32).map((part) => part.loud));
  const places = [0, 1, 2, 3].map((place) => loud.reduce((sum, value, index) => sum + (index % 4 === place ? value : 0), 0));
  return places.indexOf(Math.max(...places));
}

/** The Kreisel on the table as a link: what "Copy link" copies (the tests of Firefox cannot read the clipboard). */
const linkOf = async (page: Page): Promise<string> => `./#k=${await encodeLink(deserialize(await state(page)))}`;

/** One of a group's choices on the board, by its name. */
const choice = (page: Page, group: string, name: string) => page.locator(`#${group}`).getByRole("radio", { name, exact: true });

/** Which of a group's choices is taken, and where the Tab key stops in it: the same single place in both. */
const taken = (page: Page, group: string): Promise<{ checked: number[]; stops: number[] }> =>
  page.locator(`#${group} [role=radio]`).evaluateAll((nodes) => ({
    checked: nodes.flatMap((node, index) => (node.getAttribute("aria-checked") === "true" ? [index] : [])),
    stops: nodes.flatMap((node, index) => ((node as HTMLElement).tabIndex === 0 ? [index] : [])),
  }));

/** How far the panel's content is taller than the panel: above 2 px it scrolls. */
const tooTall = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const panel = document.getElementById("panel")!;
    return panel.scrollHeight - panel.clientHeight;
  });

/** The buttons of the recordings this browser keeps, in the sampler's list; with `about`, the one whose hint says so (its name in quotes, its kind, where it came from). */
const kept = (page: Page, about?: string) => page.locator(`#sample-kept .kept-sound .chip${about === undefined ? "" : `[title*="${about}"]`}`);
/** The button that forgets a kept recording, by what it says it forgets. */
const forget = (page: Page, what: string) => page.locator("#sample-kept").getByRole("button", { name: what, exact: true });

/**
 * Hands the page files the way a drag from the desktop or a paste does: as events that carry them. Says what the page
 * showed after each step of a drag (the mark that a file hangs over it), and after those the hint over the wheel as it
 * stood while the file hung there and once it was dropped.
 */
const hand = (page: Page, how: "drop" | "paste", ...files: (readonly [name: string, type: string])[]): Promise<(string | null)[]> =>
  page.evaluate(([way, given]) => {
    const data = new DataTransfer();
    for (const [name, kind, base64] of given) data.items.add(new File([Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0))], name, { type: kind }));
    if (way === "paste") {
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      return [];
    }
    const hints: (string | null)[] = [];
    const marks = ["dragenter", "dragover", "drop"].map((step) => {
      document.body.dispatchEvent(new DragEvent(step, { dataTransfer: data, bubbles: true, cancelable: true }));
      if (step !== "dragenter") hints.push(document.getElementById("stage")?.dataset.drop ?? null);
      return document.documentElement.dataset.dropping ?? null;
    });
    return [...marks, ...hints];
  }, [how, files.map(([name, type]) => [name, type, readFileSync(fixture(name)).toString("base64")] as const)] as const);

test.describe("a sound file of every kind", () => {
  for (const [file, kind] of FORMATS) {
    test(`plays ${file}: the ring takes the ${kind} file as a one-shot, says what it is and is heard`, async ({ page }) => {
      const problems = await begin(page);
      const name = file.slice(0, file.lastIndexOf("."));
      const called = kind.replace(/[()]/g, "\\$&");
      await load(page, 3, file);

      // One sentence says which ring took what, and how it is played. (A packed file comes out a few thousandths of a second longer.)
      expect(await said(page)).toMatch(new RegExp(`^Drum: “${name}” \\(${called}, 0\\.(3[6-9]|4[0-2]) s\\) plays as a one-shot\\.$`));
      await expect(page.locator("#toast")).toContainText(`Drum: “${name}” (${kind}, `);
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      expect(await recording(page)).toBe("ready");
      // The silence before and after the pluck is left out, in whatever form the file holds it.
      const sample = (await sampleOf(page, 3))!;
      expect(sample).toMatchObject({ name, mode: ONE_SHOT, tune: 0, gain: 1, back: false, stretch: 1 });
      expect(sample.id).toMatch(/^[0-9a-f]{16}$/);
      expect(sample.from).toBeGreaterThan(0.05);
      expect(sample.to).toBeLessThan(0.95);
      await expect(page.locator("#sample-about")).toContainText(`“${name}”, a one-shot, 0.`);
      await expect(page.locator("#sample-about")).toContainText("from a file");
      await expect(page.locator("#sample-pick")).toHaveText(`Sample: ${name}`);
      // The list of what the browser keeps calls it by its name and by what it is.
      await expect(kept(page).locator(".kept-name")).toHaveText(name);
      await expect(kept(page).locator(".kept-length")).toHaveText(new RegExp(`^${called} · 0\\.[78]\\d s$`));

      // The ring by itself is heard, and what is heard is the pluck (220 Hz), not the ring's own drum, which lies far deeper.
      const heard = await alone(page, 3);
      expect(heard.loud).toBeGreaterThan(0.001);
      expect(heard.sharp).toBeGreaterThan(150);
      await clean(page, problems);
    });
  }

  test("turns down a file that is no sound in a plain sentence that names it, and nothing changes", async ({ page }) => {
    const problems = await begin(page);
    await turnOver(page, 3);
    const before = await state(page);
    await pick(page, fixture("not-a-sound.txt"));
    expect(await said(page)).toBe("“not-a-sound” could not be loaded. This file is not a sound the Kreisel can read. It takes WAV, AIFF, MP3, Ogg, Opus, FLAC and M4A.");
    await expect(page.locator("#toast")).toContainText("“not-a-sound” could not be loaded.");
    expect(await state(page)).toBe(before);
    expect(await sampleOf(page, 3)).toBeNull();
    expect(await recording(page)).toBe("none");
    await expect(page.locator("#sample-state")).toContainText(NO_RECORDING);
    await expect(page.locator("#sample-kept")).toHaveText("None yet.");
    // The sampler takes the next file as if nothing had been.
    await pick(page, fixture("hit.wav"));
    expect(await recording(page)).toBe("ready");
    await expect(kept(page)).toHaveCount(1);
    await clean(page, problems);
  });
});

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test.describe("a single sound", () => {
    test("trims a single sound and plays it as a one-shot: a drum takes it as it is, a ring that plays notes tunes it to the key", async ({ page }) => {
      const problems = await begin(page);
      // "Load a file …" opens the browser's own file dialog, which offers sound files and the Kreisel's own.
      await turnOver(page, 3);
      const dialog = page.waitForEvent("filechooser");
      await page.locator("#sample-load").click();
      const chooser = await dialog;
      expect(chooser.isMultiple()).toBe(false);
      const offered = (await chooser.element().getAttribute("accept"))?.split(",") ?? [];
      for (const kind of ["audio/*", ".wav", ".aiff", ".mp3", ".ogg", ".opus", ".flac", ".m4a", ".kreisel"]) expect(offered).toContain(kind);
      await chooser.setFiles(fixture("hit.wav"));
      await settled(page);
      expect(await said(page)).toBe("Drum: “hit” (WAV, 0.38 s) plays as a one-shot.");
      const drum = (await sampleOf(page, 3))!;
      expect(drum).toMatchObject({ name: "hit", mode: ONE_SHOT, fit: 0, tune: 0, back: false, turn: 0, gain: 1, stretch: 1 });
      // The file is 0.7 s long: 0.1 s of silence, the pluck, 0.25 s of silence. What plays begins just before the pluck and ends where it has died away.
      expect(drum.from).toBeGreaterThan(0.1);
      expect(drum.from).toBeLessThan(0.143);
      expect(drum.to).toBeGreaterThan(0.6);
      expect(drum.to).toBeLessThan(0.75);
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.38 s · from a file");
      await expect(page.locator("#sample-state")).toBeHidden();
      // The ring keeps its own hits, and the line under the wheel says what they play.
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      await expect(status(page)).toContainText("Drum: 3 hits on 4, 8, 11 of 12 · “hit”, a one-shot, 0.38 s");
      // The ring's own row shows the sample as the sound it plays.
      await expect(page.locator("#sample-pick")).toHaveText("Sample: hit");
      await expect(page.locator("#sample-pick")).toHaveAttribute("aria-pressed", "true");

      // The same file on the bass: the pluck is the note A, the Kreisel is in G, so it is tuned two semitones down.
      await load(page, 4, "hit.wav");
      expect(await said(page)).toBe("Bass: “hit” (WAV, 0.38 s) plays as a one-shot, tuned to G.");
      const bass = (await sampleOf(page, 4))!;
      expect(bass.id).toBe(drum.id);
      expect(bass.mode).toBe(ONE_SHOT);
      expect(bass.tune).toBeCloseTo(-2, 1);
      expect(bass.from).toBe(drum.from);
      expect(bass.to).toBe(drum.to);
      await expect(page.locator("#sample-about")).toHaveText(/^“hit”, a one-shot, 0\.38 s, −(2|1\.9\d|2\.0\d) semitones · from a file$/);
      await expect(page.locator("#sample-tune")).toHaveAttribute("aria-valuetext", /^−(2|1\.9\d|2\.0\d) semitones$/);
      // The drum's sample is as it was, and the same file is kept once.
      expect(await sampleOf(page, 3)).toEqual(drum);
      await expect(kept(page)).toHaveCount(1);
      expect((await alone(page, 4)).loud).toBeGreaterThan(0.001);
      await clean(page, problems);
    });

    test("shapes a one-shot with Tune, Stretch, Level, Backwards, To key and Trim, and each is heard or seen", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await begin(page);
      // Not pressed: what a slider does to the ring is then what is measured (and how hard the sum is pressed differs from browser to browser).
      await page.evaluate(() => window.kreisel.app.setGlobal({ pressure: 0 }));
      await load(page, 3, "hit.wav");
      const came = (await sampleOf(page, 3))!;
      const plain = await alone(page, 3);
      const tune = page.locator("#sample-tune");
      const stretch = page.locator("#sample-stretch");
      const level = page.locator("#sample-gain");
      const back = page.locator("#sample-back");
      const undo = page.locator("#toast").getByRole("button", { name: "Undo" });

      // An octave up it is sharper.
      await tune.fill("12");
      expect((await sampleOf(page, 3))?.tune).toBe(12);
      await expect(tune).toHaveAttribute("aria-valuetext", "+12 semitones");
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.38 s, +12 semitones · from a file");
      expect((await alone(page, 3)).sharp).toBeGreaterThan(plain.sharp * 1.3);
      // The right button puts a slider back.
      await tune.click({ button: "right" });
      expect((await sampleOf(page, 3))?.tune).toBe(0);
      await expect(tune).toHaveAttribute("aria-valuetext", "as it is");

      // Four times as long at its own pitch: more of every step is filled, and it is no sharper for it.
      await stretch.fill("400");
      expect((await sampleOf(page, 3))?.stretch).toBe(4);
      await expect(stretch).toHaveAttribute("aria-valuetext", "4 times as long");
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, stretched ×4, 0.38 s · from a file");
      const long = await alone(page, 3);
      expect(dB(long, plain)).toBeGreaterThan(3);
      expect(long.sharp).toBeLessThan(plain.sharp * 1.2);
      await stretch.click({ button: "right" });
      expect((await sampleOf(page, 3))?.stretch).toBe(1);
      await expect(stretch).toHaveAttribute("aria-valuetext", "as long as it is");

      // At half its level it is 6 dB quieter.
      await level.fill("50");
      expect((await sampleOf(page, 3))?.gain).toBe(0.5);
      await expect(level).toHaveAttribute("aria-valuetext", "50 %");
      const quiet = dB(await alone(page, 3), plain);
      expect(quiet).toBeGreaterThan(-7);
      expect(quiet).toBeLessThan(-5);
      await level.click({ button: "right" });
      expect((await sampleOf(page, 3))?.gain).toBe(1);

      // Backwards the pluck swells instead of dying away: the next hit cuts it off before it is loud.
      await expect(back).toHaveAttribute("aria-pressed", "false");
      await back.click();
      expect((await sampleOf(page, 3))?.back).toBe(true);
      await expect(back).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.38 s, backwards · from a file");
      await expect(page.locator("#sample-wave")).toHaveAttribute("aria-label", "The recording “hit”, 0.70 s long: the part from 0.10 s to 0.48 s plays, backwards.");
      expect(Math.abs(dB(await alone(page, 3), plain))).toBeGreaterThan(1);
      await back.click();
      expect(await sampleOf(page, 3)).toEqual(came);

      // "To key" finds the pluck's own pitch (A) and moves it onto the key's (G); the sentence offers the way back.
      await dismiss(page);
      await page.locator("#sample-key").click();
      expect((await sampleOf(page, 3))?.tune).toBeCloseTo(-2, 1);
      expect(await said(page)).toMatch(/^Tuned to G: (2\.0\d|1\.9\d) semitones down\.$/);
      await undo.click();
      // A sample is the same after a step back: to the last sample of where it begins and ends.
      expect(await sampleOf(page, 3)).toEqual(came);

      // Trimmed as it came, there is nothing left to trim, and "Trim" says so.
      await dismiss(page);
      await page.locator("#sample-trim").click();
      expect(await said(page)).toBe("There is no silence left to trim.");
      expect(await sampleOf(page, 3)).toEqual(came);
      // Start and end pulled out to all of the file, and "Trim" leaves the silence out again, says from where to where, and offers the way back.
      await page.locator("#sample-from").fill("0");
      await page.locator("#sample-to").fill("1000");
      expect(await sampleOf(page, 3)).toMatchObject({ from: 0, to: 1 });
      await expect(page.locator("#sample-from")).toHaveAttribute("aria-valuetext", "starts at 0.00 s");
      await expect(page.locator("#sample-to")).toHaveAttribute("aria-valuetext", "ends at 0.70 s");
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.70 s · from a file");
      await page.locator("#sample-trim").click();
      expect(await said(page)).toBe("Trimmed: it plays from 0.10 s to 0.48 s.");
      expect(await sampleOf(page, 3)).toEqual(came);
      await expect(page.locator("#sample-from")).toHaveAttribute("aria-valuetext", "starts at 0.10 s");
      await expect(page.locator("#sample-to")).toHaveAttribute("aria-valuetext", "ends at 0.48 s");
      await undo.click();
      expect(await sampleOf(page, 3)).toMatchObject({ from: 0, to: 1 });
      // "Listen" is there to hear the part by itself; pressing it changes nothing.
      const before = await state(page);
      await page.locator("#sample-hear").click();
      expect(await state(page)).toBe(before);
      await clean(page, problems);
    });

    test("takes the recording off a ring with Remove: the ring plays its first sound again, the browser keeps the recording, and Undo puts it back", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      await page.locator("#sample-tune").fill("4");
      const sample = (await sampleOf(page, 3))!;
      const remove = page.locator("#sample-remove");
      await expect(remove).toHaveAccessibleName("Remove");
      await expect(remove).toHaveAccessibleDescription("Take the recording off this ring: the ring plays its first sound again, and the browser keeps the recording");

      await dismiss(page);
      await remove.click();
      expect(await said(page)).toBe("“hit” is off Drum. The browser still keeps it.");
      expect(await sampleOf(page, 3)).toBeNull();
      expect(await soundOf(page, 3)).toBe(0);
      expect(await recording(page)).toBe("none");
      // The board is the one of a ring without a recording, with the recording still in its list; the focus is on the heading, not lost with the button.
      await expect(page.locator("#sample-state")).toContainText(NO_RECORDING);
      await expect(page.locator("#sample-wave")).toBeHidden();
      await expect(remove).toBeHidden();
      await expect(page.locator("#sample-title")).toBeFocused();
      await expect(kept(page)).toHaveCount(1);
      await expect(kept(page)).toHaveAttribute("aria-pressed", "false");
      await expect(status(page)).toContainText("Drum: 3 hits on 4, 8, 11 of 12");
      await expect(status(page)).not.toContainText("“hit”");
      // What is heard is the ring's own drum again, which lies far deeper than the pluck.
      expect((await alone(page, 3)).sharp).toBeLessThan(150);

      // "Undo" in the sentence puts it back as it was set.
      await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
      expect(await sampleOf(page, 3)).toEqual(sample);
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      expect(await recording(page)).toBe("ready");
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.38 s, +4 semitones · from a file");
      await clean(page, problems);
    });
  });

  test.describe("a loop in slices", () => {
    test("lays a loop around the ring in 32 slices with a hit on every step, says what became of the ring's own hits, and Undo gives the ring back as it was", async ({ page }) => {
      const problems = await begin(page);
      await turnOver(page, 3);
      const before = await state(page);
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      await pick(page, fixture("loop.wav"));

      // Two bars at the Kreisel's own tempo: the ring is made 32 steps long and every step drops the needle on its slice.
      expect(await said(page)).toBe("Drum: “loop” (WAV, 3.2 s) lies around the ring in 32 slices (2 bars); the ring's own hits gave way to a hit on every step.");
      expect(await sampleOf(page, 3)).toMatchObject({ name: "loop", mode: SLICES, fit: 0, from: 0, to: 1, tune: 0, turn: 0, back: false, gain: 1 });
      expect(await ringOf(page, 3)).toEqual({ len: 32, hits: everyStep(32) });
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      await expect(page.locator("#sample-about")).toHaveText("“loop”, 32 slices, 3.2 s · from a file");
      await expect(status(page)).toHaveText("Drum: a hit on every step of 32 · “loop”, 32 slices, 3.2 s");
      expect(await taken(page, "sample-modes")).toEqual({ checked: [SLICES], stops: [SLICES] });
      // What belongs to slices shows; what belongs to a one-shot does not (a loop's quiet belongs to its length: nothing to trim).
      await expect(page.locator("#sample-fits")).toBeVisible();
      await expect(page.locator("#sample-turn")).toBeVisible();
      await expect(page.locator("#sample-all")).toBeVisible();
      await expect(page.locator("#sample-stretch")).toBeHidden();
      await expect(page.locator("#sample-trim")).toBeHidden();
      await expect(page.locator("#sample-wave")).toHaveAttribute("aria-label", "The recording “loop”, 3.2 s long: the part from 0.00 s to 3.2 s plays.");
      expect((await alone(page, 3)).loud).toBeGreaterThan(0.001);

      // The sentence offers "Undo": the ring is as it was, with its own sound, its twelve steps and its three hits.
      await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
      expect(await sampleOf(page, 3)).toBeNull();
      expect(await soundOf(page, 3)).not.toBe(SAMPLE_SOUND);
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      expect(await state(page)).toBe(before);
      await expect(page.locator("#sample-state")).toContainText(NO_RECORDING);
      // The recording itself is still kept, and the step forward brings the sample back.
      await expect(kept(page)).toHaveCount(1);
      await page.keyboard.press("Control+Shift+z");
      expect((await sampleOf(page, 3))?.name).toBe("loop");
      expect((await ringOf(page, 3)).len).toBe(32);

      // A ring that had no hits has none to lose: the sentence is the short one.
      await load(page, 6, "loop.wav");
      expect(await said(page)).toBe("Melody: “loop” (WAV, 3.2 s) lies around the ring in 32 slices (2 bars).");
      expect(await ringOf(page, 6)).toEqual({ len: 32, hits: everyStep(32) });
      // In a Kreisel at another tempo the sentence says what the loop's own is.
      await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 128 }));
      await load(page, 1, "loop.mp3");
      expect(await said(page)).toBe("Snare: “loop” (MP3, 3.2 s) lies around the ring in 32 slices (2 bars; its own tempo is about 150); the ring's own hits gave way to a hit on every step.");
      expect((await ringOf(page, 1)).hits).toHaveLength(32);
      await clean(page, problems);
    });

    test("plays a loop through without a seam at another tempo: a hit on every step sounds like one hit that plays on", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await begin(page);
      await load(page, 3, "loop.wav");
      // The loop is at 150 BPM; at 128 every slice has to be made longer to fill its step.
      await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 128 }));
      for (const fit of ["Speed", "Stretch"]) {
        await choice(page, "sample-fits", fit).click();
        await lay(page, 3, "every step");
        const every = await alone(page, 3);
        await lay(page, 3, "the first step");
        const one = await alone(page, 3);
        // 32 drops of the needle, each where the one before it had got to: nothing is added and nothing is missing at the joins.
        expect(Math.abs(dB(every, one)), `${fit}: loudness`).toBeLessThan(0.1);
        expect(Math.abs(every.sharp / one.sharp - 1), `${fit}: sharpness`).toBeLessThan(0.01);
        expect(one.loud).toBeGreaterThan(0.001);
      }
      // Chopped, the recording keeps its own speed: every hit drops the needle anew, wherever the recording had got to. That is not the same.
      await choice(page, "sample-fits", "Chop").click();
      await lay(page, 3, "every step");
      const every = await alone(page, 3);
      await lay(page, 3, "the first step");
      const one = await alone(page, 3);
      expect(Math.abs(dB(every, one))).toBeGreaterThan(0.3);
      await clean(page, problems);
    });

    test("plays a record on the hi-hat's ring with one voice, as on any ring: one hit plays it through", async ({ page }) => {
      const problems = await begin(page);
      // The techno Kreisel's own hi-hat is cut short by every hit that follows; a recording on its ring is not chopped up by that.
      await load(page, 2, "loop.wav");
      expect(await said(page)).toBe("Hi-Hat: “loop” (WAV, 3.2 s) lies around the ring in 32 slices (2 bars); the ring's own hits gave way to a hit on every step.");
      const every = await alone(page, 2);
      await lay(page, 2, "the first step");
      const one = await alone(page, 2);
      expect(one.loud).toBeGreaterThan(0.001);
      expect(Math.abs(dB(every, one))).toBeLessThan(0.1);
      expect(Math.abs(every.sharp / one.sharp - 1)).toBeLessThan(0.01);
      await clean(page, problems);
    });

    test("fits a slice to its step by Chop, Speed or Stretch: in a slower Kreisel Speed plays the record lower, the others at its own pitch", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "loop.wav");
      await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 110 }));
      expect(await taken(page, "sample-fits")).toEqual({ checked: [0], stops: [0] });
      const chop = await alone(page, 3);

      await choice(page, "sample-fits", "Speed").click();
      expect((await sampleOf(page, 3))?.fit).toBe(1);
      expect(await taken(page, "sample-fits")).toEqual({ checked: [1], stops: [1] });
      await expect(page.locator("#sample-about")).toHaveText("“loop”, 32 slices, sped to the steps, 3.2 s · from a file");
      const speed = await alone(page, 3);
      // A record made for 150 played at 110: everything in it lies lower.
      expect(speed.sharp).toBeLessThan(chop.sharp * 0.75);

      await choice(page, "sample-fits", "Stretch").click();
      expect((await sampleOf(page, 3))?.fit).toBe(2);
      await expect(page.locator("#sample-about")).toHaveText("“loop”, 32 slices, stretched to the steps, 3.2 s · from a file");
      const stretch = await alone(page, 3);
      // Made longer at its own pitch: about as sharp as chopped, clearly sharper than sped.
      expect(stretch.sharp).toBeGreaterThan(speed.sharp * 1.25);
      for (const heard of [chop, speed, stretch]) expect(heard.loud).toBeGreaterThan(0.001);
      // The Kreisel carries the choice.
      expect((JSON.parse(await state(page)) as { t: (number | string)[][] }).t[3]?.[13]).toMatch(/^1\.2\.0\.1000000\./);
      await clean(page, problems);
    });

    test("turns the record under the ring, plays it backwards and lays a hit on every step again", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "loop.wav");
      const turn = page.locator("#sample-turn");
      // The loop's kick is on every beat: its slices are the loud ones.
      expect(await kickAt(page, 3)).toBe(0);

      // Turned by two steps, every step plays the slice two further on: the kick is heard two sixteenths before the beat.
      await expect(turn).toHaveAttribute("max", "31");
      await expect(turn).toHaveAttribute("aria-valuetext", "not turned");
      await turn.fill("2");
      expect((await sampleOf(page, 3))?.turn).toBe(2);
      await expect(turn).toHaveAttribute("aria-valuetext", "turned by 2 steps");
      expect(await kickAt(page, 3)).toBe(2);
      await turn.click({ button: "right" });
      expect((await sampleOf(page, 3))?.turn).toBe(0);
      expect(await kickAt(page, 3)).toBe(0);

      // Backwards the first slice is the recording's last: the kick comes on the last sixteenth of every beat.
      await page.locator("#sample-back").click();
      expect((await sampleOf(page, 3))?.back).toBe(true);
      await expect(page.locator("#sample-about")).toHaveText("“loop”, 32 slices, 3.2 s, backwards · from a file");
      expect(await kickAt(page, 3)).toBe(3);
      await page.locator("#sample-back").click();

      // A chopped ring gets its hit on every step back with one button, and the sentence offers the way back.
      await page.evaluate(() => window.kreisel.app.rings.clear(3));
      expect((await ringOf(page, 3)).hits).toEqual([]);
      await dismiss(page);
      await page.locator("#sample-all").click();
      expect(await ringOf(page, 3)).toEqual({ len: 32, hits: everyStep(32) });
      expect(await said(page)).toBe("A hit on every step: the recording plays through. Take hits away to chop it.");
      await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
      expect((await ringOf(page, 3)).hits).toEqual([]);
      await clean(page, problems);
    });
  });

  test.describe("the sampler's side of the panel", () => {
    test("turns a ring's panel over to its sampler by button, by key and by the ring's own row, and gives the focus back", async ({ page }) => {
      const problems = await begin(page);
      const opener = page.locator("#sample-open");
      const row = page.locator("#sample-pick");
      const board = page.locator("#sampler");
      const ringPanel = page.locator(".panel-ring");
      const title = page.locator("#sample-title");
      const wheel = page.locator("#kreisel");
      const isOpen = () => page.evaluate(() => window.kreisel.app.sample.open);
      /** The focus is on something that can be seen. */
      const focusInView = () => page.evaluate(() => {
        const focused = document.activeElement;
        return focused !== null && focused !== document.body && focused.getClientRects().length > 0;
      });
      await focus(page, 3);

      // A ring without a sample offers one in a row of its own, beside the button that turns the panel over.
      await expect(opener).toHaveAccessibleName("Sample");
      await expect(opener).toHaveAttribute("aria-controls", "sampler");
      await expect(opener).toHaveAttribute("aria-expanded", "false");
      await expect(row).toHaveText("Load a sample");
      await expect(row).toHaveAttribute("aria-pressed", "false");
      await expect(board).toBeHidden();

      // The button turns the panel over. The focus goes to the heading, not to a button: the space bar still starts and stops.
      await opener.click();
      await expect(board).toBeVisible();
      await expect(ringPanel).toBeHidden();
      await expect(wheel).toBeVisible();
      await expect(title).toHaveText("Drum: sample");
      await expect(title).toBeFocused();
      await expect(opener).toHaveAttribute("aria-expanded", "true");
      await expect(board).toHaveAttribute("role", "group");
      await expect(board).toHaveAccessibleName("Drum: sample");
      // Nothing is on the ring yet: the board says so, and the ways in are real buttons that say what they bring.
      await expect(page.locator("#sample-state")).toContainText(NO_RECORDING);
      for (const [id, text, name] of [
        ["sample-load", "Load a file …", "Load a file …"],
        ["sample-record", "Microphone", "Record the microphone"],
        ["sample-press-ring", "This ring", "Resample this ring"],
        ["sample-press-wheel", "The wheel", "Resample the wheel"],
      ] as const) {
        await expect(page.locator(`#${id}`)).toHaveText(text);
        await expect(page.locator(`#${id}`)).toHaveAccessibleName(name);
        await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "false");
        await expect(page.locator(`#${id}`)).toBeEnabled();
      }
      await expect(page.locator(".sample-sources")).toContainText("Resample");
      // What shapes a recording is not there yet, and its sliders have nothing to say; no recording is kept, and there is nothing to save.
      await expect(page.locator("#sample-wave")).toBeHidden();
      await expect(page.locator("#sample-modes")).toBeHidden();
      for (const id of ["sample-from", "sample-to", "sample-turn", "sample-stretch", "sample-tune", "sample-gain"]) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-valuetext", "no recording");
      await expect(page.locator("#sample-kept")).toHaveText("None yet.");
      await expect(page.locator("#sample-bundle")).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Space");
      await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Space");
      await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
      await expect(board).toBeVisible();

      // Escape turns it back, and the focus is on the button it came from.
      await page.keyboard.press("Escape");
      await expect(board).toBeHidden();
      await expect(ringPanel).toBeVisible();
      await expect(opener).toHaveAttribute("aria-expanded", "false");
      await expect(opener).toBeFocused();
      // So does the board's own button.
      await opener.click();
      await expect(title).toBeFocused();
      await expect(page.locator("#sample-done")).toHaveText("‹ Ring");
      await page.locator("#sample-done").click();
      await expect(board).toBeHidden();
      await expect(opener).toBeFocused();
      // The ring's own row opens it too while there is nothing to pick yet, and gets the focus back.
      await row.click();
      await expect(board).toBeVisible();
      await expect(title).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(board).toBeHidden();
      await expect(row).toBeFocused();

      // The key 0 does the same from the wheel, there and back, and the wheel has the focus again.
      await wheel.focus();
      await page.keyboard.press("Digit0");
      await expect(board).toBeVisible();
      await expect(title).toBeFocused();
      await page.keyboard.press("Digit0");
      await expect(board).toBeHidden();
      await expect(wheel).toBeFocused();
      await page.keyboard.press("Digit0");
      await expect(title).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(board).toBeHidden();
      await expect(wheel).toBeFocused();

      // The sampler stays while another ring is picked and shows that ring: every ring has one, the kick too.
      await page.keyboard.press("Digit0");
      for (const [key, name] of [["Digit5", "Bass"], ["Digit1", "Kick"], ["Digit7", "Melody"]] as const) {
        await page.keyboard.press(key);
        await expect(board).toBeVisible();
        await expect(title).toHaveText(`${name}: sample`);
      }
      // The piece and the weather have none: turning to them puts it away, and the focus is not left on something hidden.
      // From there the key 0 goes back to the ring that was in focus last, and to its sampler.
      for (const elsewhere of ["Digit8", "Digit9"]) {
        await page.keyboard.press(elsewhere);
        await expect(board).toBeHidden();
        expect(await isOpen()).toBe(false);
        expect(await focusInView()).toBe(true);
        await expect(wheel).toBeFocused();
        await page.keyboard.press("Digit0");
        await expect(board).toBeVisible();
        await expect(title).toHaveText("Melody: sample");
        await expect(title).toBeFocused();
        expect(await page.evaluate(() => window.kreisel.app.focus)).toBe("ring");
      }
      await page.keyboard.press("Escape");
      expect(await isOpen()).toBe(false);
      await expect(wheel).toBeFocused();

      // The pedals and the sampler are two sides of the same panel: one puts the other away.
      await page.keyboard.press("Digit5");
      await page.keyboard.press("Digit0");
      await expect(board).toBeVisible();
      await page.keyboard.press("KeyY");
      await expect(page.locator("#pedals")).toBeVisible();
      await expect(board).toBeHidden();
      await page.keyboard.press("Digit0");
      await expect(board).toBeVisible();
      await expect(page.locator("#pedals")).toBeHidden();
      await expect(title).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(board).toBeHidden();
      await expect(ringPanel).toBeVisible();
      expect(await focusInView()).toBe(true);
      await clean(page, problems);
    });

    test("picks a ring's sample as its sound from the ring's own row, and offers the sampler with the right button on the ring", async ({ page }) => {
      const problems = await begin(page);
      const menu = page.locator("#context");
      const offer = menu.getByRole("group", { name: "Sample" });
      await focus(page, 3);

      // The right button on the ring: a ring without a recording has none to use, and "Sampler …" leads to where one comes from.
      const spot = await where(page, 3, 0);
      await page.mouse.click(spot.x, spot.y, { button: "right" });
      await expect(menu.locator("header")).toHaveText("Drum · step 1");
      await expect(offer.getByRole("menuitemradio", { name: "No recording yet" })).toBeDisabled();
      await offer.getByRole("menuitem", { name: /^Give this ring a recording to play/ }).click();
      await expect(menu).toBeHidden();
      await expect(page.locator("#sampler")).toBeVisible();
      await expect(page.locator("#sample-title")).toHaveText("Drum: sample");

      await pick(page, fixture("hit.wav"));
      await page.keyboard.press("Escape");
      const row = page.locator("#sample-pick");
      await expect(row).toHaveText("Sample: hit");
      await expect(row).toHaveAttribute("aria-pressed", "true");
      // The ring goes back to one of its ready-made sounds: the sample stays with the ring, and its row brings it back with one click.
      await page.evaluate(() => window.kreisel.app.rings.setSound(3, 0));
      await expect(row).toHaveAttribute("aria-pressed", "false");
      await expect(row).toHaveText("Sample: hit");
      expect((await sampleOf(page, 3))?.name).toBe("hit");
      await expect(status(page)).toContainText("Drum: 3 hits on 4, 8, 11 of 12");
      await expect(status(page)).not.toContainText("“hit”");
      await row.click();
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      await expect(row).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#sampler")).toBeHidden();
      // One more click turns the panel over to the sampler.
      await row.click();
      await expect(page.locator("#sampler")).toBeVisible();
      await expect(page.locator("#sample-title")).toBeFocused();
      // The sound pad means something of its own for a recording.
      await page.keyboard.press("Escape");
      await expect(page.locator(".pad .axis.x")).toHaveText("Filter →");
      await expect(page.locator(".pad .axis.y")).toHaveText("Length ↑");

      // The right button offers the same: "Use" picks the ring's sample as its sound.
      await page.evaluate(() => window.kreisel.app.rings.setSound(3, 0));
      await page.mouse.click(spot.x, spot.y, { button: "right" });
      const use = offer.getByRole("menuitemradio", { name: "Use this ring's sample “hit”" });
      await expect(use).toHaveAttribute("aria-checked", "false");
      await use.click();
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      await expect(use).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await clean(page, problems);
    });

    test("has every choice as a group for the arrow keys with one stop for the Tab key, and every amount as a slider that says its value", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      const modes = page.locator("#sample-modes");
      const fits = page.locator("#sample-fits");
      const fit = async () => (await sampleOf(page, 3))?.fit;

      // One-shot or Slices: one group, one stop, and the arrow keys take the choice at once.
      await expect(modes).toHaveAttribute("role", "radiogroup");
      await expect(modes).toHaveAccessibleName("How the recording is played");
      await expect(modes.getByRole("radio")).toHaveText(["One-shot", "Slices"]);
      expect(await taken(page, "sample-modes")).toEqual({ checked: [ONE_SHOT], stops: [ONE_SHOT] });
      await expect(fits).toBeHidden();
      await expect(page.locator("#sample-stretch")).toBeVisible();
      await expect(page.locator("#sample-trim")).toBeVisible();
      await choice(page, "sample-modes", "One-shot").focus();
      await page.keyboard.press("ArrowRight");
      await expect(choice(page, "sample-modes", "Slices")).toBeFocused();
      expect((await sampleOf(page, 3))?.mode).toBe(SLICES);
      expect(await taken(page, "sample-modes")).toEqual({ checked: [SLICES], stops: [SLICES] });
      await expect(page.locator("#sample-about")).toHaveText("“hit”, 12 slices, 0.38 s · from a file");
      // In slices the second group shows: how a slice fits its step.
      await expect(fits).toBeVisible();
      await expect(fits).toHaveAttribute("role", "radiogroup");
      await expect(fits).toHaveAccessibleName("How a slice fits its step");
      await expect(fits.getByRole("radio")).toHaveText(["Chop", "Speed", "Stretch"]);
      expect(await taken(page, "sample-fits")).toEqual({ checked: [0], stops: [0] });
      await expect(page.locator("#sample-stretch")).toBeHidden();
      await expect(page.locator("#sample-trim")).toBeHidden();
      await choice(page, "sample-fits", "Chop").focus();
      await page.keyboard.press("ArrowRight");
      await expect(choice(page, "sample-fits", "Speed")).toBeFocused();
      expect(await fit()).toBe(1);
      await page.keyboard.press("ArrowDown");
      await expect(choice(page, "sample-fits", "Stretch")).toBeFocused();
      expect(await fit()).toBe(2);
      expect(await taken(page, "sample-fits")).toEqual({ checked: [2], stops: [2] });
      // Round the end, and backwards. The pointer on the wheel is not moved by any of them.
      await page.keyboard.press("ArrowRight");
      await expect(choice(page, "sample-fits", "Chop")).toBeFocused();
      expect(await fit()).toBe(0);
      await page.keyboard.press("ArrowLeft");
      expect(await fit()).toBe(2);
      await page.keyboard.press("ArrowUp");
      expect(await fit()).toBe(1);
      expect(await taken(page, "sample-fits")).toEqual({ checked: [1], stops: [1] });
      expect(await page.evaluate(() => window.kreisel.app.keyCursor)).toBeNull();
      // Each choice is one step back.
      await page.keyboard.press("Control+z");
      expect(await fit()).toBe(2);
      await page.keyboard.press("Control+Shift+z");
      expect(await fit()).toBe(1);
      // A click takes one as well.
      await choice(page, "sample-fits", "Chop").click();
      expect(await fit()).toBe(0);

      // The sliders say their value in seconds, steps and semitones, and the arrow keys move them.
      const says = (id: string) => page.locator(`#${id}`);
      await expect(says("sample-from")).toHaveAttribute("aria-valuetext", "starts at 0.10 s");
      await expect(says("sample-to")).toHaveAttribute("aria-valuetext", "ends at 0.48 s");
      await expect(says("sample-turn")).toHaveAttribute("aria-valuetext", "not turned");
      await expect(says("sample-tune")).toHaveAttribute("aria-valuetext", "as it is");
      await expect(says("sample-gain")).toHaveAttribute("aria-valuetext", "100 %");
      await says("sample-tune").focus();
      for (let key = 0; key < 3; key += 1) await page.keyboard.press("ArrowRight");
      await expect(says("sample-tune")).toHaveAttribute("aria-valuetext", "+3 semitones");
      expect((await sampleOf(page, 3))?.tune).toBe(3);
      for (let key = 0; key < 4; key += 1) await page.keyboard.press("ArrowLeft");
      await expect(says("sample-tune")).toHaveAttribute("aria-valuetext", "−1 semitone");
      await says("sample-turn").focus();
      await page.keyboard.press("ArrowRight");
      await expect(says("sample-turn")).toHaveAttribute("aria-valuetext", "turned by 1 step");
      await page.keyboard.press("ArrowRight");
      await expect(says("sample-turn")).toHaveAttribute("aria-valuetext", "turned by 2 steps");
      // The record can be turned by as many steps as the ring has, less one.
      await expect(says("sample-turn")).toHaveAttribute("max", "11");
      await says("sample-gain").fill("150");
      await expect(says("sample-gain")).toHaveAttribute("aria-valuetext", "150 %");
      await says("sample-from").fill("500");
      await expect(says("sample-from")).toHaveAttribute("aria-valuetext", "starts at 0.35 s");
      // As a one-shot again, the stretch is back in the turn's place.
      await choice(page, "sample-modes", "One-shot").click();
      expect((await sampleOf(page, 3))?.mode).toBe(ONE_SHOT);
      await expect(says("sample-turn")).toBeHidden();
      await expect(fits).toBeHidden();
      await expect(says("sample-stretch")).toHaveAttribute("aria-valuetext", "as long as it is");
      await says("sample-stretch").fill("200");
      await expect(says("sample-stretch")).toHaveAttribute("aria-valuetext", "2 times as long");
      await says("sample-stretch").fill("150");
      await expect(says("sample-stretch")).toHaveAttribute("aria-valuetext", "1.5 times as long");

      // The strip of the recording is drawn, and has a sentence for whoever does not see it.
      const wave = page.locator("#sample-wave");
      await expect(wave).toHaveAttribute("role", "img");
      await expect(wave).toHaveAccessibleName("The recording “hit”, 0.70 s long: the part from 0.35 s to 0.48 s plays.");
      expect(await wave.evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let drawn = 0;
        for (let index = 3; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 0) drawn += 1;
        return drawn;
      })).toBeGreaterThan(200);
      // The buttons say what they do, and what a tooltip says to a mouse a screen reader is told as well.
      for (const [id, name] of [["sample-hear", "Listen"], ["sample-trim", "Trim"], ["sample-remove", "Remove"], ["sample-key", "To key"], ["sample-back", "Backwards"], ["sample-bundle", "Save as a file with its recordings"]] as const) await expect(page.locator(`#${id}`)).toHaveAccessibleName(name);
      await expect(page.locator("#sample-trim")).toHaveAccessibleDescription("Leave out the silence before and after the sound");
      await expect(page.locator("#sample-key")).toHaveAccessibleDescription("Find the recording's own pitch and tune it to the key");
      await expect(says("sample-tune")).toHaveAccessibleDescription("Higher or lower, in semitones");
      await expect(choice(page, "sample-modes", "One-shot")).toHaveAccessibleDescription(MODES[0].hint);
      await expect(choice(page, "sample-modes", "Slices")).toHaveAccessibleDescription(MODES[1].hint);
      await choice(page, "sample-modes", "Slices").click();
      for (const [index, name] of ["Chop", "Speed", "Stretch"].entries()) await expect(choice(page, "sample-fits", name)).toHaveAccessibleDescription(FITS[index]!.hint);
      await clean(page, problems);
    });

    test("names every slider of the sampler by what it sets, and by nothing else", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      for (const [id, name] of [["sample-from", "Start"], ["sample-to", "End"], ["sample-stretch", "Stretch"], ["sample-tune", "Tune"], ["sample-gain", "Level"]] as const) await expect(page.locator(`#${id}`)).toHaveAccessibleName(name);
      await choice(page, "sample-modes", "Slices").click();
      await expect(page.locator("#sample-turn")).toHaveAccessibleName("Turn");
      await clean(page, problems);
    });

    test("holds the whole sampler on this screen: the panel does not scroll, empty, with a one-shot, in slices, or with six recordings kept", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await begin(page);
      const scrolling: string[] = [];
      const look = async (what: string): Promise<void> => {
        const over = await tooTall(page);
        if (over > 2) scrolling.push(`${what}: ${over} px too tall`);
      };
      // Empty, on every ring.
      await turnOver(page, 0);
      for (let ring = 0; ring < 7; ring += 1) {
        await page.evaluate((track) => window.kreisel.app.select(track), ring);
        await expect(page.locator("#sample-title")).toHaveText(`${NAMES[ring]}: sample`);
        await expect(page.locator("#sample-state")).toContainText(NO_RECORDING);
        await look(`${NAMES[ring]}, empty`);
      }
      // A one-shot, the same in slices, and a loop.
      await load(page, 3, "hit.wav");
      await expect(page.locator("#sample-stretch")).toBeVisible();
      await look("a one-shot");
      await choice(page, "sample-modes", "Slices").click();
      await expect(page.locator("#sample-fits")).toBeVisible();
      await look("a one-shot's recording in slices");
      await load(page, 3, "loop.wav");
      await look("a loop in slices, two recordings kept");
      // Six recordings kept: as a one-shot and in slices.
      for (const file of ["hit-24bit.wav", "hit.aiff", "hit.flac", "hit.ogg"]) await load(page, 3, file);
      await expect(kept(page)).toHaveCount(6);
      await expect(page.locator("#sample-stretch")).toBeVisible();
      await look("a one-shot, six recordings kept");
      await press(page, kept(page, "“loop”"));
      await expect(page.locator("#sample-fits")).toBeVisible();
      await look("a loop in slices, six recordings kept");
      // With a sentence at its foot, the page itself does not scroll either.
      await expect(page.locator("#toast")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(scrolling).toEqual([]);
      await clean(page, problems);
    });

    test("holds a ring's own panel on this screen with the sample's row in it: it does not scroll, for any ring", async ({ page }) => {
      const problems = await open(page);
      const scrolling: string[] = [];
      // On the factory Kreisel, and on the techno one, whose hi-hat has so many hits that the line telling of them takes two rows.
      for (const kreisel of ["factory", "techno"]) {
        if (kreisel === "techno") await page.evaluate(() => window.kreisel.app.newProject(false, "techno"));
        for (let ring = 0; ring < 7; ring += 1) {
          await focus(page, ring);
          await expect(page.locator(".panel-ring h2")).toHaveText(NAMES[ring]!);
          await expect(page.locator("#sample-pick")).toBeVisible();
          const over = await tooTall(page);
          if (over > 2) scrolling.push(`${kreisel} Kreisel, ${NAMES[ring]}: ${over} px too tall`);
        }
      }
      // And with a recording on the ring, whose row then shows it.
      await load(page, 2, "hit.wav");
      await page.keyboard.press("Escape");
      await expect(page.locator("#sample-pick")).toHaveText("Sample: hit");
      const over = await tooTall(page);
      if (over > 2) scrolling.push(`techno Kreisel, Hi-Hat with a sample: ${over} px too tall`);
      expect(scrolling).toEqual([]);
      await clean(page, problems);
    });
  });

  test.describe("what the browser keeps", () => {
    test("keeps a ring's recording over a restart: it is ready again, is heard, and is in the list of what is kept", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      await page.locator("#sample-tune").fill("5");
      const sample = (await sampleOf(page, 3))!;
      await page.evaluate(() => window.kreisel.app.store.save());
      await page.reload();
      await expect(status(page)).toContainText("Melody");

      // The Kreisel names the recording, the browser has it: nothing has to be loaded again, and nothing is said about it.
      await focus(page, 3);
      await expect.poll(() => recording(page)).toBe("ready");
      expect(await sampleOf(page, 3)).toEqual(sample);
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      await expect(status(page)).toContainText("“hit”, a one-shot, 0.38 s, +5 semitones");
      await expect(status(page)).not.toContainText("not in this browser");
      const heard = await alone(page, 3);
      expect(heard.loud).toBeGreaterThan(0.001);
      expect(heard.sharp).toBeGreaterThan(150);
      expect(await said(page)).toBe("");

      // The sampler lists it: its name, what it is and how long, where it came from, and that this ring plays it.
      await page.locator("#sample-open").click();
      await expect(page.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.38 s, +5 semitones · from a file");
      await expect(page.locator("#sample-kept")).toHaveAccessibleName("Recordings in this browser");
      await expect(kept(page)).toHaveCount(1);
      await expect(kept(page).locator(".kept-name")).toHaveText("hit");
      await expect(kept(page).locator(".kept-length")).toHaveText("WAV · 0.70 s");
      await expect(kept(page)).toHaveAttribute("title", "Give “hit” to this ring (WAV, 0.70 s, from a file)");
      await expect(kept(page)).toHaveAttribute("aria-pressed", "true");
      await expect(forget(page, "Forget hit, WAV, 0.70 s")).toBeVisible();
      await clean(page, problems);
    });

    test("gives a kept recording to another ring with one click, forgets it, and takes the forgetting back", async ({ page }) => {
      test.setTimeout(60_000);
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      const drum = (await sampleOf(page, 3))!;

      // The sampler stays while the snare is picked: the recording is in its list, and no ring but the drum plays it yet.
      await focus(page, 1);
      await expect(page.locator("#sample-title")).toHaveText("Snare: sample");
      await expect(kept(page)).toHaveAttribute("aria-pressed", "false");
      await press(page, kept(page));
      expect(await said(page)).toBe("Snare: “hit” (WAV, 0.38 s) plays as a one-shot.");
      expect(await sampleOf(page, 1)).toEqual(drum);
      expect(await soundOf(page, 1)).toBe(SAMPLE_SOUND);
      expect(await recording(page)).toBe("ready");
      await expect(kept(page)).toHaveAttribute("aria-pressed", "true");
      await expect(kept(page)).toHaveCount(1);

      // Forgotten (here by keyboard: Tab to the "×" of its row, Enter), the rings that played it are silent, and the page says so everywhere it speaks of them.
      await forget(page, "Forget hit, WAV, 0.70 s").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#toast")).toContainText("“hit” is forgotten.");
      await expect(page.locator("#toast")).toContainText("silent now");
      await expect.poll(() => recording(page)).toBe("missing");
      await expect(page.locator("#sample-kept")).toHaveText("None yet.");
      await expect(page.locator("#sample-state")).toHaveText(NOT_HERE);
      await expect(page.locator("#sample-state")).toHaveClass(/missing/);
      await expect(page.locator("#sample-wave")).toBeHidden();
      await expect(status(page)).toContainText("(not in this browser: silent)");
      // The button that was pressed is gone with its row: the focus is on the board's heading, not lost to the page.
      // (A button clicked with the mouse never keeps the focus on this page: there the space bar stays with start and stop.)
      await expect(page.locator("#sample-title")).toBeFocused();
      // The ring keeps its sample: only the sound is gone.
      expect(await sampleOf(page, 1)).toEqual(drum);
      expect((await alone(page, 1)).loud).toBeLessThan(0.0001);

      // "Undo" in the sentence brings the recording back, for both rings.
      await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => recording(page)).toBe("ready");
      await expect(kept(page)).toHaveCount(1);
      await expect(page.locator("#sample-state")).toBeHidden();
      await expect(page.locator("#sample-wave")).toBeVisible();
      expect((await alone(page, 1)).loud).toBeGreaterThan(0.001);
      await focus(page, 3);
      expect(await recording(page)).toBe("ready");
      expect((await alone(page, 3)).loud).toBeGreaterThan(0.001);
      await clean(page, problems);
    });

    test("goes through the list of kept recordings with the arrow keys, and leaves a ring alone that already plays the one that is clicked", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      await load(page, 3, "hit.flac");
      await page.locator("#sample-tune").fill("3");
      const sample = (await sampleOf(page, 3))!;
      // Two recordings of one name: what each is stands beside it, the newest first.
      await expect(kept(page).locator(".kept-name")).toHaveText(["hit", "hit"]);
      await expect(kept(page).locator(".kept-length")).toHaveText(["FLAC · 0.70 s", "WAV · 0.70 s"]);
      await expect(kept(page, "FLAC")).toHaveAttribute("aria-pressed", "true");
      await expect(kept(page, "WAV")).toHaveAttribute("aria-pressed", "false");

      // Up and down go from row to row here, in the column they are in, and stop at the ends. The ring in focus stays the one the rows are given to.
      await kept(page, "FLAC").focus();
      await page.keyboard.press("ArrowDown");
      await expect(kept(page, "WAV")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(kept(page, "WAV")).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(kept(page, "FLAC")).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(kept(page, "FLAC")).toBeFocused();
      await forget(page, "Forget hit, FLAC, 0.70 s").focus();
      await page.keyboard.press("ArrowDown");
      await expect(forget(page, "Forget hit, WAV, 0.70 s")).toBeFocused();
      expect(await page.evaluate(() => window.kreisel.app.selected)).toBe(3);
      expect(await page.evaluate(() => window.kreisel.app.keyCursor)).toBeNull();

      // A click on the recording the ring plays already gives nothing anew: how the ring's sample is set is not lost.
      const before = await state(page);
      await dismiss(page);
      await kept(page, "FLAC").click();
      await expect(page.locator("#toast")).toContainText("Drum plays “hit” already.");
      expect(await sampleOf(page, 3)).toEqual(sample);
      expect(await state(page)).toBe(before);
      // The other one is given: the ring plays the WAV now, as it comes.
      await press(page, kept(page, "WAV"));
      expect(await said(page)).toBe("Drum: “hit” (WAV, 0.38 s) plays as a one-shot.");
      expect((await sampleOf(page, 3))?.tune).toBe(0);
      await expect(kept(page, "WAV")).toHaveAttribute("aria-pressed", "true");
      await expect(kept(page, "FLAC")).toHaveAttribute("aria-pressed", "false");
      await clean(page, problems);
    });
  });

  test.describe("what travels with the Kreisel", () => {
    test("carries a sample with the Kreisel as which recording it is and how it is played, never as sound", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      await page.locator("#sample-tune").fill("5");
      await page.locator("#sample-gain").fill("80");
      await page.locator("#sample-back").click();
      await choice(page, "sample-modes", "Slices").click();
      await choice(page, "sample-fits", "Speed").click();
      await page.locator("#sample-turn").fill("3");
      const sample = (await sampleOf(page, 3))!;
      expect(sample).toMatchObject({ name: "hit", mode: SLICES, fit: 1, tune: 5, gain: 0.8, back: true, turn: 3, stretch: 1 });

      // After everything else a ring has: nine numbers, the name of the recording (the hash of its sound) and its own name, parted by dots.
      // Where the part that plays begins and ends is told in millionths of the recording: to a sample, however long it is.
      const packed = JSON.parse(await state(page)) as { t: (number | string)[][] };
      const carried = String(packed.t[3]?.[13]);
      expect(carried.split(".")).toHaveLength(11);
      expect(carried).toBe(`1.1.${Math.round(sample.from * 1_000_000)}.${Math.round(sample.to * 1_000_000)}.2900.1.80.3.100.${sample.id}.hit`);
      expect(carried).toBe(packSample(sample));
      // A file's recording has no recipe, and a ring without a sample ends before.
      expect(packed.t[3]?.[14]).toBeUndefined();
      expect(packed.t[4]?.[13]).toBeUndefined();
      // The link stays a link: the 60 kB of the file are not in it.
      const link = await linkOf(page);
      expect(link.length).toBeLessThan(4000);
      // And the Kreisel comes back from it with the sample exactly as it was set.
      expect(deserialize(await state(page)).tracks[3]?.sample).toEqual(sample);
      await clean(page, problems);
    });

    test("opens a Kreisel whose recording is not in this browser: says so, leaves that ring silent, and takes the same file back as the ring was set", async ({ page, browser, baseURL }) => {
      test.setTimeout(60_000);
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      await page.locator("#sample-tune").fill("5");
      await page.locator("#sample-gain").fill("80");
      await page.locator("#sample-back").click();
      const sample = (await sampleOf(page, 3))!;
      const link = await linkOf(page);

      // A browser that has never been here.
      const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
      const guest = await elsewhere.newPage();
      const guestProblems = await open(guest);
      await guest.goto(link);
      await expect(guest.locator("#toast")).toContainText("A shared Kreisel");
      // A moment later the page says which recording it does not have, and what helps.
      await expect(guest.locator("#toast")).toContainText("This Kreisel plays a recording this browser does not have (“hit”): that ring is silent. Load the sound again in the ring's sampler, or open the Kreisel's own file.");
      await focus(guest, 3);
      expect(await recording(guest)).toBe("missing");
      expect(await sampleOf(guest, 3)).toEqual(sample);
      expect(await soundOf(guest, 3)).toBe(SAMPLE_SOUND);
      await expect(status(guest)).toContainText("(not in this browser: silent)");
      expect((await alone(guest, 3)).loud).toBeLessThan(0.0001);
      // The ring's row leads to the sampler, which says the same and shows nothing it does not have.
      await guest.locator("#sample-pick").click();
      await expect(guest.locator("#sample-title")).toHaveText("Drum: sample");
      await expect(guest.locator("#sample-state")).toHaveText(NOT_HERE);
      await expect(guest.locator("#sample-state")).toHaveClass(/missing/);
      await expect(guest.locator("#sample-wave")).toBeHidden();
      await expect(guest.locator("#sample-kept")).toHaveText("None yet.");

      // The same file, loaded again, is found to be the same: the ring plays it as it was set.
      await pick(guest, fixture("hit.wav"));
      expect(await said(guest)).toBe("“hit” is back: Drum plays it again as it was set.");
      expect(await recording(guest)).toBe("ready");
      expect(await sampleOf(guest, 3)).toEqual(sample);
      await expect(guest.locator("#sample-state")).toBeHidden();
      await expect(guest.locator("#sample-about")).toHaveText("“hit”, a one-shot, 0.38 s, +5 semitones, backwards · from a file");
      await expect(status(guest)).not.toContainText("not in this browser");
      await expect(kept(guest)).toHaveCount(1);
      expect((await alone(guest, 3)).loud).toBeGreaterThan(0.001);
      await clean(guest, guestProblems);
      await elsewhere.close();
      await clean(page, problems);
    });

    test("sends a resampled recording along with the Kreisel: where it is not kept it is made again from its recipe, without any file", async ({ page, browser, baseURL }) => {
      test.setTimeout(90_000);
      const problems = await begin(page);
      await turnOver(page, 4);
      await press(page, page.locator("#sample-press-ring"));
      const sample = (await sampleOf(page, 4))!;
      expect(sample.name).toBe("resample 1");
      expect(sample.recipe).toBeDefined();
      const here = await alone(page, 4);
      // The recipe is the Kreisel the recording was made of, and lies after the sample in what the Kreisel carries.
      const packed = JSON.parse(await state(page)) as { t: (number | string)[][] };
      expect(packed.t[4]?.[13]).toBe(packSample(sample));
      expect(packed.t[4]?.[14]).toBe(sample.recipe);
      const link = await linkOf(page);
      expect(link.length).toBeLessThan(6000);

      const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
      const guest = await elsewhere.newPage();
      const guestProblems = await open(guest);
      await guest.goto(link);
      await expect(guest.locator("#toast")).toContainText("A shared Kreisel");
      await focus(guest, 4);
      // It takes a moment: the Kreisel in the recipe is played once more.
      await expect.poll(() => recording(guest), { timeout: 30_000 }).toBe("ready");
      expect(await sampleOf(guest, 4)).toEqual(sample);
      const there = await alone(guest, 4);
      expect(there.loud).toBeGreaterThan(0.001);
      // It is the same recording: as loud there as here.
      expect(Math.abs(dB(there, here))).toBeLessThan(0.5);
      // Nothing is said to be missing, and the recording is kept there now, so that it is not made again at every visit.
      await guest.waitForTimeout(1800);
      expect(await said(guest)).not.toContain("does not have");
      await expect(status(guest)).not.toContainText("not in this browser");
      await guest.locator("#sample-pick").click();
      await expect(kept(guest)).toHaveCount(1);
      await expect(kept(guest).locator(".kept-name")).toHaveText("resample 1");
      await expect(kept(guest)).toHaveAttribute("title", /^Give “resample 1” to this ring \(.+, 1\.6 s, from the Kreisel\)$/);
      await expect(guest.locator("#sample-about")).toHaveText("“resample 1”, 16 slices, 1.6 s · from the Kreisel");
      await clean(guest, guestProblems);
      await elsewhere.close();
      await clean(page, problems);
    });

    test("says that a resample cannot travel when a file's sound is in it: this browser keeps it, and another one is told what it lacks", async ({ page, browser, baseURL }) => {
      test.setTimeout(60_000);
      const problems = await begin(page);
      // The drum plays a file's recording, and is resampled as it sounds: no browser could make that again without the file.
      await load(page, 3, "hit.wav");
      await press(page, page.locator("#sample-press-ring"));
      expect(await said(page)).toBe("Drum: “resample 1” (this ring, resampled, 1.2 s) lies around the ring in 12 slices; the ring's hits drop the needle where they lie. A link cannot carry this one (a file's sound is in it, or it goes too deep): this browser keeps it.");
      const sample = (await sampleOf(page, 3))!;
      expect(sample).toMatchObject({ name: "resample 1", mode: SLICES, from: 0, to: 1 });
      // It has no recipe: the Kreisel names it like a file's recording, by the hash of its sound.
      expect(sample.recipe).toBeUndefined();
      const packed = JSON.parse(await state(page)) as { t: (number | string)[][] };
      expect(packed.t[3]?.[13]).toBe(packSample(sample));
      expect(packed.t[3]?.[14]).toBeUndefined();
      expect(await recording(page)).toBe("ready");
      expect((await alone(page, 3)).loud).toBeGreaterThan(0.001);
      // This browser keeps both: the file and what was made of it.
      await expect(kept(page).locator(".kept-name")).toHaveText(["resample 1", "hit"]);
      await expect(page.locator("#sample-about")).toHaveText("“resample 1”, 12 slices, 1.2 s · from the Kreisel");

      // A browser that has never been here gets the Kreisel from its link, and is told which recording it does not have.
      const link = await linkOf(page);
      const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
      const guest = await elsewhere.newPage();
      const guestProblems = await open(guest);
      await guest.goto(link);
      await expect(guest.locator("#toast")).toContainText("This Kreisel plays a recording this browser does not have (“resample 1”): that ring is silent.");
      await focus(guest, 3);
      expect(await recording(guest)).toBe("missing");
      expect(await sampleOf(guest, 3)).toEqual(sample);
      await clean(guest, guestProblems);
      await elsewhere.close();
      await clean(page, problems);
    });
  });

  test.describe("resampling the Kreisel onto a ring", () => {
    test("resamples a ring onto itself: one turn of it, its hits stay on their steps as plain hits, it starts clean, and it stays about as loud as it was", async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await beginWorn(page);
      const busyButtons = ["sample-load", "sample-press-ring", "sample-press-wheel", "sample-record", "sample-bundle"];
      const weatherOn = (ring: number) => page.evaluate((index) => {
        const project = window.kreisel.app.project;
        return project.scenes[project.scene]!.weather.reduce((sum, kind) => sum + (kind[index] ?? []).filter((share) => share > 0).length, 0);
      }, ring);
      // The techno Kreisel's bass is driven through a distortion pedal and has an echo; its hits lie at more than one height.
      const worn = await trackOf(page, 4);
      expect(worn.drive).toBeGreaterThan(0);
      expect(worn.echo).toBeGreaterThan(0);
      expect(worn.pedals).toMatchObject({ tone: 1 });
      const was = await alone(page, 4);
      const ring = await ringOf(page, 4);
      expect(ring.len).toBe(16);
      expect(ring.hits.length).toBeGreaterThan(4);
      expect((await hitsOf(page, 4)).some((hit) => hit.pitch !== 0)).toBe(true);
      await turnOver(page, 4);
      const before = await state(page);

      // By keyboard: the button is pressed with Enter.
      await dismiss(page);
      await page.locator("#sample-press-ring").focus();
      await page.keyboard.press("Enter");
      // While it is made the board says so; the buttons stay where they are (the one that was pressed keeps the focus) and do nothing.
      await expect(page.locator("#sample-state")).toHaveText("Resampling …");
      for (const id of busyButtons) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "true");
      await expect(page.locator("#sample-press-ring")).toBeFocused();
      // (Playwright would wait with its click until the button can be used again: the click is made at once.)
      await page.locator("#sample-press-wheel").click({ force: true });
      expect(await page.evaluate(() => window.kreisel.app.sample.busy)).toBe("Resampling …");
      await settled(page);
      expect(await said(page)).toBe("Bass: “resample 1” (this ring, resampled, 1.6 s) lies around the ring in 16 slices; the ring's hits drop the needle where they lie.");
      for (const id of busyButtons) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "false");

      // The recording is one turn of the ring, all of it, with the recipe it was made from.
      const sample = (await sampleOf(page, 4))!;
      expect(sample).toMatchObject({ name: "resample 1", mode: SLICES, fit: 0, from: 0, to: 1, tune: 0, turn: 0, back: false });
      expect(sample.recipe?.length).toBeGreaterThan(100);
      // The ring keeps its length and its hits on their steps: each drops the needle where the ring played. How loud, how often
      // and how high each was is in the recording now (in slices a hit's height would pick another slice): they are plain hits.
      expect(await ringOf(page, 4)).toEqual(ring);
      for (const hit of await hitsOf(page, 4)) expect(hit).toEqual(PLAIN_HIT);
      // What was on the ring is in the recording as well: the ring starts clean.
      const clear = await trackOf(page, 4);
      expect(clear).toMatchObject({ sound: SAMPLE_SOUND, drive: 0, hall: 0, echo: 0 });
      expect(clear.pedals).toBeUndefined();
      expect(await weatherOn(4)).toBe(0);
      await expect(page.locator("#sample-about")).toHaveText("“resample 1”, 16 slices, 1.6 s · from the Kreisel");
      await expect(kept(page).locator(".kept-name")).toHaveText("resample 1");
      // And it stays where it was in the mix.
      const now = await alone(page, 4);
      expect(now.loud).toBeGreaterThan(0.001);
      expect(Math.abs(dB(now, was))).toBeLessThan(3);

      // All of that is one step back.
      await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
      expect(await state(page)).toBe(before);
      expect((await trackOf(page, 4)).pedals).toMatchObject({ tone: 1 });
      expect((await hitsOf(page, 4)).some((hit) => hit.pitch !== 0)).toBe(true);

      // A ring of twelve steps is resampled as twelve steps: the recording is as long as the ring, and the ring stays as long as it is.
      await focus(page, 3);
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      await press(page, page.locator("#sample-press-ring"));
      expect(await said(page)).toBe("Drum: “resample 2” (this ring, resampled, 1.2 s) lies around the ring in 12 slices; the ring's hits drop the needle where they lie.");
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      expect(await sampleOf(page, 3)).toMatchObject({ name: "resample 2", mode: SLICES, from: 0, to: 1 });
      await expect(page.locator("#sample-about")).toHaveText("“resample 2”, 12 slices, 1.2 s · from the Kreisel");
      expect((await alone(page, 3)).loud).toBeGreaterThan(0.001);
      await clean(page, problems);
    });

    test("bounces the kick with its hardness and its Nachbeben into one recording", async ({ page }) => {
      test.setTimeout(90_000);
      const problems = await beginWorn(page);
      const rumbling = () => page.evaluate(() => {
        const project = window.kreisel.app.project;
        return { hard: project.hard, rumble: project.scenes[project.scene]!.rumble.filter((share) => share > 0).length };
      });
      const before = await rumbling();
      expect(before.hard).toBeGreaterThan(0);
      expect(before.rumble).toBeGreaterThan(0);
      const was = await alone(page, 0);
      const ring = await ringOf(page, 0);
      await turnOver(page, 0);
      await press(page, page.locator("#sample-press-ring"));
      expect(await said(page)).toBe("Kick: “resample 1” (this ring, resampled, 1.6 s) lies around the ring in 16 slices; the ring's hits drop the needle where they lie.");
      // The hardness and the Nachbeben are in the recording: the Kreisel has neither any more, or they would be there twice.
      expect(await rumbling()).toEqual({ hard: 0, rumble: 0 });
      expect(await ringOf(page, 0)).toEqual(ring);
      expect(await soundOf(page, 0)).toBe(SAMPLE_SOUND);
      const now = await alone(page, 0);
      expect(Math.abs(dB(now, was))).toBeLessThan(3);
      // What lies deep down in the kick (its Nachbeben) is still there.
      expect(now.deep).toBeGreaterThan(was.deep * 0.5);
      // One step back, and the kick is hard and rumbles again.
      await page.keyboard.press("Control+z");
      expect(await rumbling()).toEqual(before);
      expect(await sampleOf(page, 0)).toBeNull();
      await clean(page, problems);
    });

    test("resamples what the whole wheel plays onto a ring, a bar or two of it, with a hit on every step", async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await begin(page);
      await turnOver(page, 3);
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      const before = await state(page);
      await press(page, page.locator("#sample-press-wheel"));
      // One chord and no ring longer than a bar: one bar. The ring is made as long, and every step drops the needle.
      expect(await said(page)).toBe("Drum: “resample 1” (the wheel, resampled, 1.6 s) lies around the ring in 16 slices; the ring's own hits gave way to a hit on every step.");
      expect(await ringOf(page, 3)).toEqual({ len: 16, hits: everyStep(16) });
      const sample = (await sampleOf(page, 3))!;
      expect(sample).toMatchObject({ name: "resample 1", mode: SLICES, from: 0, to: 1 });
      expect(sample.recipe).toBeDefined();
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      // The ring alone now plays what all of them played: the kick's lows are in it.
      const heard = await alone(page, 3);
      expect(heard.loud).toBeGreaterThan(0.01);
      expect(heard.deep).toBeGreaterThan(0.02);

      // A kept resample given to another ring from the list lies on it like any recording: that ring's own drive, reverb and echo stay.
      await focus(page, 5);
      const chords = await trackOf(page, 5);
      expect(chords.drive + chords.hall + chords.echo).toBeGreaterThan(0);
      await press(page, kept(page));
      expect(await said(page)).toBe("Chords: “resample 1” (resampled from the Kreisel, 1.6 s) lies around the ring in 16 slices; the ring's own hits gave way to a hit on every step.");
      expect(await trackOf(page, 5)).toMatchObject({ sound: SAMPLE_SOUND, drive: chords.drive, hall: chords.hall, echo: chords.echo });
      expect(await sampleOf(page, 5)).toMatchObject({ id: sample.id, recipe: sample.recipe, mode: SLICES });
      await page.keyboard.press("Control+z");
      expect(await sampleOf(page, 5)).toBeNull();

      // One more step back gives the drum back completely.
      await page.keyboard.press("Control+z");
      expect(await sampleOf(page, 3)).toBeNull();
      expect(await ringOf(page, 3)).toEqual({ len: 12, hits: [3, 7, 10] });
      expect(await state(page)).toBe(before);

      // A scene of two chords is two bars long: so is the recording, and the ring that takes it. A ring without hits has none to lose.
      await page.evaluate(() => window.kreisel.app.chords.setBars(2));
      await focus(page, 6);
      await press(page, page.locator("#sample-press-wheel"));
      expect(await said(page)).toBe("Melody: “resample 2” (the wheel, resampled, 3.2 s) lies around the ring in 32 slices.");
      expect(await ringOf(page, 6)).toEqual({ len: 32, hits: everyStep(32) });
      await expect(page.locator("#sample-about")).toHaveText("“resample 2”, 32 slices, 3.2 s · from the Kreisel");
      await expect(kept(page)).toHaveCount(2);
      await clean(page, problems);
    });

    test("calls a resampled recording “resampled” in the list of what the browser keeps", async ({ page }) => {
      const problems = await begin(page);
      await turnOver(page, 4);
      await press(page, page.locator("#sample-press-ring"));
      await expect(kept(page).locator(".kept-name")).toHaveText("resample 1");
      await expect(kept(page).locator(".kept-length")).toHaveText("resampled · 1.6 s");
      await expect(kept(page)).toHaveAttribute("title", "Give “resample 1” to this ring (resampled, 1.6 s, from the Kreisel)");
      await expect(forget(page, "Forget resample 1, resampled, 1.6 s")).toBeVisible();
      await clean(page, problems);
    });
  });

  test.describe("the Kreisel's own file", () => {
    test("saves the Kreisel as one file with its recordings, and a browser that has none of them opens it with its sound", async ({ page, browser, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const problems = await begin(page);
      await load(page, 3, "hit.wav");
      await page.locator("#sample-tune").fill("7");
      await load(page, 1, "loop.mp3");
      await focus(page, 2);
      await press(page, page.locator("#sample-press-ring"));
      const shared = await state(page);
      const bundle = page.locator("#sample-bundle");
      await expect(bundle).toHaveText("Save as a file with its recordings");
      await expect(bundle).toHaveAttribute("aria-disabled", "false");
      await dismiss(page);
      const saved = page.waitForEvent("download");
      await bundle.click();
      const file = await saved;
      expect(file.suggestedFilename()).toBe("kreisel.kreisel");
      await settled(page);
      expect(await said(page)).toBe("Saved as a file with 3 recordings. Whoever opens it gets the Kreisel and its sound.");
      const path = testInfo.outputPath("kreisel.kreisel");
      await file.saveAs(path);
      // The file says what it is in its first bytes, and holds the sound files as they came (an MP3 stays an MP3).
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 9).toString("latin1")).toBe("KREISEL1\n");
      expect(bytes.includes(readFileSync(fixture("loop.mp3")))).toBe(true);
      expect(bytes.includes(readFileSync(fixture("hit.wav")))).toBe(true);

      // In a browser that has never been here, the file is loaded where a sound file is.
      const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
      const guest = await elsewhere.newPage();
      const guestProblems = await open(guest);
      const mine = await state(guest);
      await turnOver(guest, 6);
      await pick(guest, path);
      await expect(guest.locator("#toast")).toContainText("A shared Kreisel. Yours is not gone.");
      expect(await state(guest)).toBe(shared);
      // The two files' recordings are there at once: ready, heard, and in the list of what this browser keeps.
      await focus(guest, 3);
      await expect.poll(() => recording(guest)).toBe("ready");
      expect((await sampleOf(guest, 3))?.tune).toBe(7);
      const drum = await alone(guest, 3);
      expect(drum.loud).toBeGreaterThan(0.001);
      expect(drum.sharp).toBeGreaterThan(150);
      await focus(guest, 1);
      await expect.poll(() => recording(guest)).toBe("ready");
      expect((await alone(guest, 1)).loud).toBeGreaterThan(0.001);
      // What was resampled is not taken from the file on trust: it is made again from its recipe, which takes a moment.
      await focus(guest, 2);
      await expect.poll(() => recording(guest), { timeout: 30_000 }).toBe("ready");
      expect((await alone(guest, 2)).loud).toBeGreaterThan(0.001);
      await expect.poll(async () => {
        await guest.evaluate(() => window.kreisel.app.sample.list());
        return kept(guest).count();
      }).toBe(3);
      await expect(kept(guest, "MP3").locator(".kept-length")).toHaveText("MP3 · 3.2 s");
      await expect(kept(guest, "WAV").locator(".kept-length")).toHaveText("WAV · 0.70 s");
      await expect(kept(guest, "from the Kreisel").locator(".kept-name")).toHaveText("resample 1");
      // Nothing is said to be missing, and the Kreisel that was on the table can be had back.
      await guest.waitForTimeout(1800);
      expect(await said(guest)).not.toContain("does not have");
      await expect(status(guest)).not.toContainText("not in this browser");
      await guest.evaluate(() => window.kreisel.app.undo());
      expect(await state(guest)).toBe(mine);
      await clean(guest, guestProblems);
      await elsewhere.close();
      await clean(page, problems);
    });

    test("offers the file with the recordings under Share once a ring plays a recording, and not before", async ({ page }) => {
      const problems = await begin(page);
      const menu = page.locator("#context");
      const row = menu.getByRole("menuitem", { name: /Save as a file with its recordings/ });
      await page.locator("#share").click();
      await expect(menu.getByRole("menuitem", { name: /Copy link/ })).toBeVisible();
      await expect(row).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      await load(page, 3, "hit.wav");
      await page.locator("#share").click();
      await expect(row).toBeVisible();
      await expect(row).toContainText("A link cannot carry sound.");
      await page.keyboard.press("Escape");
      await dismiss(page);
      const saved = page.waitForEvent("download");
      await fromBar(page, "share", /Save as a file with its recordings/);
      expect((await saved).suggestedFilename()).toBe("kreisel.kreisel");
      await settled(page);
      expect(await said(page)).toBe("Saved as a file with 1 recording. Whoever opens it gets the Kreisel and its sound.");
      await clean(page, problems);
    });
  });

  test.describe("dropping and pasting", () => {
    test("takes a sound file dropped anywhere on the page: the ring in focus plays it, and its panel turns over to the sampler", async ({ page }) => {
      const problems = await begin(page);
      await focus(page, 3);
      await expect(page.locator("#sampler")).toBeHidden();
      // While the file hangs over the page, the page shows that it would take it and names the ring it goes to; dropped, the mark is gone.
      expect(await hand(page, "drop", ["hit.wav", "audio/wav"])).toEqual(["true", "true", null, "Drop the sound: it goes to Drum", null]);
      await settled(page);
      expect(await said(page)).toBe("Drum: “hit” (WAV, 0.38 s) plays as a one-shot.");
      expect(await sampleOf(page, 3)).toMatchObject({ name: "hit", mode: ONE_SHOT });
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      expect(await recording(page)).toBe("ready");
      await expect(page.locator("#sampler")).toBeVisible();
      await expect(page.locator("#sample-title")).toHaveText("Drum: sample");

      // A file that comes without a type is known by its ending, and what it is by its first bytes.
      await focus(page, 4);
      await dismiss(page);
      await hand(page, "drop", ["hit.flac", ""]);
      await settled(page);
      expect(await said(page)).toBe("Bass: “hit” (FLAC, 0.38 s) plays as a one-shot, tuned to G.");

      // A ring takes one recording: of several files the first sound is taken, and the sentence says so.
      await focus(page, 1);
      await dismiss(page);
      await hand(page, "drop", ["not-a-sound.txt", "text/plain"], ["hit.mp3", "audio/mpeg"], ["loop.wav", "audio/wav"]);
      await settled(page);
      expect(await said(page)).toBe("Snare: “hit” (MP3, the first of 2 files, 0.38 s) plays as a one-shot.");

      // While the piece's ring is in focus, the file goes to the ring that was in focus last.
      await page.evaluate(() => window.kreisel.app.piece.focus());
      await expect(page.locator("#sampler")).toBeHidden();
      await dismiss(page);
      await hand(page, "drop", ["loop.wav", "audio/wav"]);
      await settled(page);
      expect(await said(page)).toBe("Snare: “loop” (WAV, 3.2 s) lies around the ring in 32 slices (2 bars); the ring's own hits gave way to a hit on every step.");
      expect(await page.evaluate(() => window.kreisel.app.focus)).toBe("ring");
      await expect(page.locator("#sampler")).toBeVisible();
      await expect(page.locator("#sample-title")).toHaveText("Snare: sample");

      // What is no sound is turned down by its name, and changes nothing.
      const before = await state(page);
      await dismiss(page);
      expect((await hand(page, "drop", ["not-a-sound.txt", "text/plain"])).slice(0, 3)).toEqual(["true", "true", null]);
      await settled(page);
      expect(await said(page)).toBe("“not-a-sound.txt” is not a sound file. The sampler takes WAV, AIFF, MP3, Ogg, Opus, FLAC and M4A.");
      expect(await state(page)).toBe(before);
      await clean(page, problems);
    });

    test("takes a pasted sound file the same way", async ({ page, browserName }) => {
      test.skip(browserName === "firefox", "Firefox hands a paste event that a script made an empty clipboard: no file can be put into it");
      const problems = await begin(page);
      await focus(page, 1);
      await hand(page, "paste", ["hit.wav", "audio/wav"]);
      await settled(page);
      expect(await said(page)).toBe("Snare: “hit” (WAV, 0.38 s) plays as a one-shot.");
      expect(await sampleOf(page, 1)).toMatchObject({ name: "hit", mode: ONE_SHOT });
      expect(await soundOf(page, 1)).toBe(SAMPLE_SOUND);
      await expect(page.locator("#sampler")).toBeVisible();
      await expect(page.locator("#sample-title")).toHaveText("Snare: sample");
      // Pasted text is left to whoever wants it: nothing happens.
      const before = await state(page);
      await dismiss(page);
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData("text/plain", "not a file");
        document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      });
      expect(await said(page)).toBe("");
      expect(await state(page)).toBe(before);
      await clean(page, problems);
    });
  });

  test.describe("at the microphone", () => {
    test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "only Chromium on the laptop has a stand-in microphone that plays a file");

    test("records a take at the microphone and gives it to the ring; a take that is left without Stop is not kept", async ({ page }) => {
      const problems = await begin(page);
      await turnOver(page, 3);
      const mic = page.locator("#sample-record");
      const others = ["sample-load", "sample-press-ring", "sample-press-wheel"];
      // The button says what a press does now: it is not a switch that is on or off.
      await expect(mic).toHaveText("Microphone");
      await expect(mic).toHaveAccessibleName("Record the microphone");
      await expect(mic).toHaveAttribute("aria-disabled", "false");
      expect(await mic.getAttribute("aria-pressed")).toBeNull();

      await mic.click();
      await expect(mic).toHaveText("Stop");
      await expect(mic).toHaveAccessibleName("Stop recording");
      await expect(mic).toHaveClass(/recording/);
      expect(await mic.getAttribute("aria-pressed")).toBeNull();
      await expect(page.locator("#toast")).toContainText("Recording. Make your sound, then press “Stop”.");
      await expect(page.locator("#sample-state")).toHaveText("Recording … make your sound, then press “Stop”.");
      // While it records, nothing else can be brought in.
      for (const id of others) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "true");
      // Putting the sampler away ends the take without keeping it, and the page says so.
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
      await expect(page.locator("#sampler")).toBeHidden();
      await expect(page.locator("#toast")).toContainText("The take was not kept.");
      expect(await sampleOf(page, 3)).toBeNull();
      expect(await page.evaluate(() => window.kreisel.app.sample.take === null)).toBe(true);
      await page.locator("#sample-open").click();
      await expect(mic).toHaveText("Microphone");
      await expect(mic).not.toHaveClass(/recording/);
      for (const id of others) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "false");
      await expect(page.locator("#sample-kept")).toHaveText("None yet.");

      // A take: the stand-in microphone plays a falling "bumm" over and over.
      await mic.click();
      await expect(mic).toHaveText("Stop");
      await page.waitForTimeout(1100);
      await dismiss(page);
      await mic.click();
      await settled(page);
      await expect(mic).toHaveText("Microphone");
      await expect(mic).toHaveAccessibleName("Record the microphone");
      expect(await said(page)).toMatch(/^Drum: “take 1” \(a take, \d(\.\d+)? s\) (plays as a one-shot|lies around the ring in \d+ slices \(.*\).*)\.$/);
      expect((await sampleOf(page, 3))?.name).toBe("take 1");
      expect(await soundOf(page, 3)).toBe(SAMPLE_SOUND);
      expect(await recording(page)).toBe("ready");
      await expect(page.locator("#sample-about")).toContainText("“take 1”");
      await expect(page.locator("#sample-about")).toContainText("from the microphone");
      await expect(kept(page)).toHaveCount(1);
      await expect(kept(page).locator(".kept-name")).toHaveText("take 1");
      await expect(kept(page).locator(".kept-length")).toHaveText(/^a take · \d(\.\d+)? s$/);
      await expect(kept(page)).toHaveAttribute("title", /^Give “take 1” to this ring \(a take, \d(\.\d+)? s, from the microphone\)$/);
      expect((await alone(page, 3)).loud).toBeGreaterThan(0.001);
      await clean(page, problems);
    });
  });

  test.describe("by hand", () => {
    test("drops the needle by hand on the home row, and “Play in” writes the hit down with the slice it played", async ({ page }) => {
      const problems = await begin(page);
      await load(page, 3, "loop.wav");
      await page.evaluate(() => window.kreisel.app.rings.clear(3));
      // Standing still, a key only plays: nothing is written.
      await page.locator("#kreisel").focus();
      await page.keyboard.press("KeyG");
      expect(await page.evaluate(() => {
        window.kreisel.app.rings.playKey(4);
        return true;
      })).toBe(true);
      expect((await ringOf(page, 3)).hits).toEqual([]);

      // With "Play in" on and the Kreisel running, the fifth key (G) drops the needle halfway round the record, on slice 17 of 32.
      await page.keyboard.press("KeyL");
      expect(await said(page)).toContain("Play in on");
      await page.keyboard.press("Space");
      await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => {
        await page.keyboard.press("KeyG");
        return (await ringOf(page, 3)).hits.length;
      }).toBeGreaterThan(0);
      await page.keyboard.press("Space");
      await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
      // The hit lies where the wheel was, and is pulled out or in as far as it takes to play that slice from there.
      const written = await page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[3]!.steps.flatMap((step, at) => (step.on ? [{ at, pitch: step.pitch }] : [])));
      expect(written.length).toBeGreaterThan(0);
      for (const hit of written) expect(hit.pitch).toBe(sliceOffset(hit.at, 16, 32, 0));
      await clean(page, problems);
    });
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("has the sampler in the ring's panel on a phone: a tap opens it, a file loads, and One-shot or Slices is a tap", async ({ page }) => {
    const problems = await begin(page);
    await page.evaluate(() => window.kreisel.app.select(3));
    const opener = page.locator("#sample-open");
    const board = page.locator("#sampler");
    const tap = (group: string, name: string) => choice(page, group, name).tap();

    // The button is in the ring's panel, further down the page; a tap turns the panel over where it is.
    await opener.scrollIntoViewIfNeeded();
    await opener.tap();
    await expect(board).toBeVisible();
    await expect(page.locator(".panel-ring")).toBeHidden();
    await expect(page.locator("#sample-title")).toHaveText("Drum: sample");
    await expect(page.locator("#sample-state")).toContainText(NO_RECORDING);
    await expect(page.locator("#sample-kept")).toHaveText("None yet.");

    // "Load a file …" opens the phone's own file dialog; the file goes to the ring.
    const dialog = page.waitForEvent("filechooser");
    await page.locator("#sample-load").tap();
    await (await dialog).setFiles(fixture("loop.wav"));
    await settled(page);
    expect(await said(page)).toBe("Drum: “loop” (WAV, 3.2 s) lies around the ring in 32 slices (2 bars); the ring's own hits gave way to a hit on every step.");
    expect(await recording(page)).toBe("ready");
    expect((await ringOf(page, 3)).hits).toHaveLength(32);

    // Every control works by a tap.
    await tap("sample-modes", "One-shot");
    expect((await sampleOf(page, 3))?.mode).toBe(ONE_SHOT);
    await expect(page.locator("#sample-stretch")).toBeVisible();
    await expect(page.locator("#sample-trim")).toBeVisible();
    await expect(page.locator("#sample-fits")).toBeHidden();
    await tap("sample-modes", "Slices");
    expect((await sampleOf(page, 3))?.mode).toBe(SLICES);
    await expect(page.locator("#sample-fits")).toBeVisible();
    await tap("sample-fits", "Speed");
    await page.locator("#sample-turn").fill("4");
    await page.locator("#sample-tune").fill("-3");
    await page.locator("#sample-back").tap();
    expect(await sampleOf(page, 3)).toMatchObject({ mode: SLICES, fit: 1, turn: 4, tune: -3, back: true });
    await expect(page.locator("#sample-about")).toHaveText("“loop”, 32 slices, sped to the steps, 3.2 s, −3 semitones, backwards · from a file");
    // With everything showing, nothing on the board is wider than the window or too small for a finger.
    expect(await page.evaluate(() => [...document.querySelectorAll("#sampler button, #sampler input, #sampler canvas")].filter((node) => node.getClientRects().length > 0).flatMap((node) => {
      const box = node.getBoundingClientRect();
      const fits = box.left >= 0 && box.right <= window.innerWidth && (!(node instanceof HTMLButtonElement) || (box.width >= 24 && box.height >= 24));
      return fits ? [] : [`${node.id || node.textContent}: ${Math.round(box.left)} to ${Math.round(box.right)}, ${Math.round(box.width)} × ${Math.round(box.height)}`];
    }))).toEqual([]);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await alone(page, 3)).loud).toBeGreaterThan(0.001);

    // The list of what is kept, and back to the ring, whose row shows the sample.
    await expect(kept(page)).toHaveCount(1);
    await expect(kept(page)).toHaveAttribute("aria-pressed", "true");
    await page.locator("#sample-done").tap();
    await expect(board).toBeHidden();
    await expect(page.locator(".panel-ring")).toBeVisible();
    await expect(page.locator("#sample-pick")).toHaveText("Sample: loop");
    await expect(page.locator("#sample-pick")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await clean(page, problems);
  });
});
