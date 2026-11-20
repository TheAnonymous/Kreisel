/*
 * Brings every ring's palette of sounds to an even loudness.
 *
 * Builds the app, plays each ready-made sound once by itself (faster than it
 * sounds, in a headless browser), measures it, and writes src/sounds/trims.ts.
 * A ring's four classics stay as they are and set the level: every other
 * sound is turned up or down until its loudest twentieth of a second is as
 * loud as theirs on average, unless its peak would then stand out.
 *
 * Run it after adding or changing a sound:  npm run level
 * With "check" it writes nothing and only says how even the palettes are.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = `${root}src/sounds/trims.ts`;
const checkOnly = process.argv[2] === "check";
const port = Number.parseInt(process.env.KREISEL_LEVEL_PORT ?? "4318", 10);
const RINGS = ["Kick", "Snare", "Hi-Hat", "Trommel", "Bass", "Akkorde", "Melodie"];
/** Where a ring's four classics stand in its palette. */
const CLASSICS = [0, 10, 20, 30];
/** A sound's peak may be this much above the highest classic's. */
const HEADROOM = 1.3;
const LIMITS = [0.1, 8];

const source = readFileSync(file, "utf8");
const current = [...source.matchAll(/^  \[([\d., ]+)\],$/gm)].map((row) => row[1].split(",").map(Number));
if (current.length !== RINGS.length || current.some((row) => row.length !== 50)) throw new Error("src/sounds/trims.ts does not hold seven rows of fifty numbers");

const built = spawnSync("npm", ["run", "build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
if (built.status !== 0) throw new Error("the build failed");

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
let measured;
try {
  const url = `http://127.0.0.1:${port}/Kreisel/`;
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
  await page.waitForFunction(() => typeof window.kreisel?.hear === "function");
  measured = await page.evaluate(async (rings) => {
    const all = [];
    for (let track = 0; track < rings; track += 1) {
      const row = [];
      for (const sound of window.kreisel.palette) row.push(await window.kreisel.hear(track, sound));
      all.push(row);
    }
    return all;
  }, RINGS.length);
  await browser.close();
} finally {
  server.kill();
}

const decibel = (ratio) => 20 * Math.log10(ratio);
const trims = measured.map((row, ring) => {
  // What each sound puts out before its present trim.
  const raw = row.map((heard, index) => ({ loud: heard.loud / current[ring][index], peak: heard.peak / current[ring][index] }));
  const level = CLASSICS.reduce((sum, index) => sum + raw[index].loud, 0) / CLASSICS.length;
  const ceiling = Math.max(...CLASSICS.map((index) => raw[index].peak)) * HEADROOM;
  const next = raw.map((one, index) => {
    if (CLASSICS.includes(index)) return 1;
    if (!(one.loud > 0)) throw new Error(`${RINGS[ring]}, sound ${index} of its palette is silent`);
    const even = Math.min(level / one.loud, ceiling / one.peak);
    return Math.round(Math.min(LIMITS[1], Math.max(LIMITS[0], even)) * 100) / 100;
  });
  const off = raw.map((one, index) => decibel((one.loud * current[ring][index]) / level));
  const others = off.filter((_, index) => !CLASSICS.includes(index));
  const atLimit = next.filter((trim) => trim === LIMITS[0] || trim === LIMITS[1]).length;
  console.log(`${RINGS[ring].padEnd(8)} as it is now: ${Math.min(...others).toFixed(1)} to ${Math.max(...others).toFixed(1)} dB around its classics; trims ${Math.min(...next)} to ${Math.max(...next)}${atLimit ? `, ${atLimit} at a limit` : ""}`);
  return next;
});

if (checkOnly) {
  console.log("Nothing written.");
} else {
  const rows = trims.map((row) => `  [${row.join(", ")}],`).join("\n");
  writeFileSync(file, source.replace(/(export const TRIMS[^\n]*\n)[\s\S]*?\n\];/, `$1${rows}\n];`));
  console.log("Wrote src/sounds/trims.ts. Build again for it to take effect.");
}
