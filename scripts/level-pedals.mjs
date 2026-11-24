/*
 * Measures what a ring's pedals do to its loudness, so that their trims can be set (src/pedals.ts: TONE_TRIM,
 * CRUSH_TRIM, PUSH): a pedal should change how a ring sounds, not how loud it is.
 *
 * Builds the app, puts the plain techno Kreisel on the table (no weather, no piece), and renders it with one ring
 * heard at a time: clean, then with each character of the drive along its control, with the crusher, with each
 * modulation, and with the reverb and the echo in front of the drive. Prints the difference to the clean ring in dB.
 *
 *   node scripts/level-pedals.mjs            the whole table
 *   node scripts/level-pedals.mjs null       only the numbers of a Kreisel without pedals, to hold against another build
 *
 * KREISEL_URL=<page> measures that page instead of building this one.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number.parseInt(process.env.KREISEL_LEVEL_PORT ?? "4319", 10);
const nullOnly = process.argv[2] === "null";
/** Which part of the table: "tones", "crush", "mods", "order", or all of it. */
const part = nullOnly ? "" : (process.argv[2] ?? "all");
const wanted = (name) => part === "all" || part === name;
const given = process.env.KREISEL_URL;
const RINGS = ["Snare", "Hi-Hat", "Drum", "Bass", "Chords", "Melody"];
const TONES = ["Warm", "Distortion", "Fuzz", "Clip", "Scream"];
const dB = (value, base) => 20 * Math.log10(value / base);
const show = (value) => (value >= 0 ? "+" : "") + value.toFixed(1);

let server = null;
if (!given) {
  const built = spawnSync("npm", ["run", "build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  if (built.status !== 0) throw new Error("the build failed");
  server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
}
const url = given ?? `http://127.0.0.1:${port}/Kreisel/`;
try {
  for (let tries = 0; tries < 80; tries += 1) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("kreisel.hinweis", "1"));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.kreisel?.whole === "function");

  /** Renders the plain techno Kreisel with only `ring` heard, after `change` (a function body over `track` and `project`) was applied to it. */
  const hear = (ring, change = "") => page.evaluate(async ([index, code]) => {
    const app = window.kreisel.app;
    app.newProject(false, "techno");
    app.store.touch((project) => {
      project.piece.on = false;
      project.pressure = 0;
      for (const scene of project.scenes) {
        if (!scene) continue;
        scene.weather = scene.weather.map((rings) => rings.map((line) => line.map(() => 0)));
        delete scene.tide;
      }
      project.tracks.forEach((track, at) => {
        track.mute = index >= 0 && at !== index;
      });
      if (index >= 0) {
        const track = project.tracks[index];
        track.drive = 0;
        // A ring that is silent in this scene gets a few hits, so that there is something to measure.
        for (const scene of project.scenes) {
          const pattern = scene?.patterns[index];
          if (pattern && !pattern.steps.slice(0, pattern.len).some((step) => step.on)) {
            for (const at of [0, 3, 6, 10, 12]) Object.assign(pattern.steps[at], { on: true, vel: 1, pitch: at % 5, len: 1 });
          }
        }
        new Function("track", "project", code)(track, project);
      }
    });
    return window.kreisel.whole();
  }, [ring, change]);

  if (nullOnly) {
    const all = await hear(-1);
    console.log("whole", JSON.stringify(all));
    for (let ring = 0; ring < 7; ring += 1) console.log("ring", ring, JSON.stringify(await page.evaluate(async (index) => {
      const app = window.kreisel.app;
      app.newProject(false, "techno");
      app.store.touch((project) => { project.tracks.forEach((track, at) => { track.mute = at !== index; }); });
      return window.kreisel.whole();
    }, ring)));
  } else {
    const pedals = (change) => `track.pedals = { tone: 0, crush: 0, mod: 0, depth: 0.4, crest: 0, span: 2, first: 0, ...${JSON.stringify(change)} };`;
    const clean = [];
    for (let ring = 1; ring <= 6; ring += 1) clean.push(await hear(ring));
    const row = async (label, change) => {
      const loud = [];
      const peak = [];
      for (let ring = 1; ring <= 6; ring += 1) {
        const heard = await hear(ring, change);
        loud.push(dB(heard.loud, clean[ring - 1].loud));
        peak.push(dB(heard.peak, clean[ring - 1].peak));
      }
      const mean = loud.reduce((sum, value) => sum + value, 0) / loud.length;
      console.log(`${label.padEnd(26)} ${loud.map((value) => show(value).padStart(6)).join("")}   mean ${show(mean).padStart(5)}   peak ${peak.map((value) => show(value).padStart(6)).join("")}`);
      return mean;
    };
    console.log(`${"loudness against clean, dB".padEnd(26)} ${RINGS.map((name) => name.padStart(6)).join("")}`);
    for (let tone = 0; wanted("tones") && tone < TONES.length; tone += 1) {
      for (const drive of [0.25, 0.5, 0.75, 1]) await row(`${TONES[tone]} ${drive}`, `track.drive = ${drive}; ${pedals({ tone })}`);
    }
    for (const crush of wanted("crush") ? [0.1, 0.25, 0.5, 0.75, 1] : []) await row(`Crush ${crush}`, pedals({ crush }));
    for (const [mod, name] of wanted("mods") ? [[1, "Phaser"], [2, "Flanger"], [3, "Chorus"]] : []) {
      for (const depth of [0.3, 0.6, 1]) await row(`${name} ${depth}`, pedals({ mod, depth }));
    }
    // The order: the same reverb and echo, after the drive and before it.
    for (const [drive, tone] of wanted("order") ? [[0.5, 0], [0.5, 1], [0.5, 3]] : []) {
      await row(`${TONES[tone]} .5, reverb .35 after`, `track.drive = ${drive}; track.hall = 0.35; track.echo = 0; ${pedals({ tone })}`);
      await row(`${TONES[tone]} .5, reverb .35 first`, `track.drive = ${drive}; track.hall = 0.35; track.echo = 0; ${pedals({ tone, first: 1 })}`);
      await row(`${TONES[tone]} .5, echo .35 after`, `track.drive = ${drive}; track.hall = 0; track.echo = 0.35; ${pedals({ tone })}`);
      await row(`${TONES[tone]} .5, echo .35 first`, `track.drive = ${drive}; track.hall = 0; track.echo = 0.35; ${pedals({ tone, first: 2 })}`);
    }
  }
  await browser.close();
} finally {
  server?.kill();
}
