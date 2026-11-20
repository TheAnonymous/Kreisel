import { bp, hold, strike, type Palette, type Tone } from "./shapes";

/*
 * The chords' palette: wide surfaces, short stabs, keys, organs, and strings
 * with their neighbours. Every recipe is one note; the ring plays three.
 */

export const CHORD: Palette<Tone> = [
  {
    name: "Fläche",
    sounds: [
      { name: "Fläche", classic: 0 },
      { name: "Warm", oscs: [["triangle", 1, -6], ["triangle", 1, 6], ["sawtooth", 0.3]], filter: { from: 300, to: 3000, q: 0.8 }, amp: hold(0.12, 0.85, 0.5, 0.2, 1.6), level: 0.3 },
      { name: "Glas", oscs: [["sine"], ["sine", [0.1, 0.5], 0, 2], ["sine", [0, 0.3], 0, 3]], amp: hold(0.08, 0.9, 0.4, 0.2, 1.8), level: 0.26 },
      { name: "Breit", oscs: [["sawtooth", 0.5, -18], ["sawtooth", 0.5, -6], ["sawtooth", 0.5, 6], ["sawtooth", 0.5, 18]], filter: { from: 500, to: 7000, q: 0.8 }, amp: hold(0.05, 0.85, 0.5, 0.15, 1.5), level: 0.2 },
      { name: "Dunst", oscs: [["sawtooth", 1, -5], ["sawtooth", 1, 5]], filter: { from: 200, to: 1500, q: 0.5 }, amp: hold(0.3, 0.9, 0.6, 0.3, 2.2), level: 0.26 },
      { name: "Hohl", oscs: [["square", 1, -7], ["square", 1, 7]], filter: { from: 300, to: 4000, q: 1 }, amp: hold(0.1, 0.85, 0.5, 0.2, 1.6), level: 0.16 },
      { name: "Schweif", oscs: [["sawtooth", 1, -10], ["sawtooth", 1, 10]], filter: { from: 250, to: 4000, q: 3, env: [0.25, 0.8] }, amp: hold(0.05, 0.9, 0.5, 0.2, 1.6), level: 0.2 },
      { name: "Hauch", oscs: [["sawtooth", 1, -5], ["sawtooth", 1, 5]], filter: { type: "bandpass", from: 600, to: 1800, q: 2 }, amp: hold(0.15, 0.9, 0.5, 0.2, 1.5), vibrato: [6, 0.3, 0.3], level: 0.5 },
      { name: "Kristall", oscs: [["sine"], ["sine", 0.5, 3, 2], ["sine", 0.25, 5, 4]], amp: hold(0.02, 0.7, 0.6, 0.3, 2.2), level: 0.26 },
      { name: "Samt", oscs: [["triangle", 1, -4], ["triangle", 1, 4]], filter: { from: 400, to: 2500 }, amp: hold(0.2, 0.9, 0.5, 0.25, 1.8), level: 0.34 },
    ],
  },
  {
    name: "Stab",
    sounds: [
      { name: "Stab", classic: 1 },
      { name: "House", oscs: [["sawtooth", 1, -12], ["sawtooth"], ["sawtooth", 1, 12]], filter: { from: 500, to: 5000, q: 2, env: [3, 0.08] }, amp: strike(0.12, 0.9), level: 0.3 },
      { name: "Zupf", oscs: [["triangle"], ["sawtooth", 0.3]], filter: { from: 600, to: 6000, q: 1, env: [5, 0.06] }, amp: strike(0.1, 0.7), level: 0.6 },
      { name: "Rave", oscs: [["sawtooth"], ["sawtooth", 0.6, 0, 1.498], ["sawtooth", 0.4, 0, 2]], filter: { from: 600, to: 7000, q: 1 }, amp: strike(0.15, 0.8), level: 0.28 },
      { name: "Hupe", oscs: [["square"]], filter: { from: 500, to: 3500, q: 4, env: [3, 0.15] }, amp: hold(0.005, 0.8, 0.2, 0.05, 0.3), level: 0.2 },
      { name: "Bläser", oscs: [["sawtooth"]], filter: { from: 300, to: 3500, q: 1.5, env: [0.4, 0.08] }, amp: hold(0.02, 0.7, 0.3, 0.08, 0.5), level: 0.26 },
      { name: "Kurz", oscs: [["sawtooth"]], filter: { from: 800, to: 8000, q: 1 }, amp: strike(0.05, 0.3), level: 0.4 },
      { name: "Dub", oscs: [["sawtooth"], ["square", 0.5, 6]], filter: { from: 250, to: 1800, q: 5, env: [4, 0.2] }, amp: strike(0.2, 1), level: 0.4 },
      { name: "Knack", oscs: [["square", 1, -5], ["square", 1, 5]], filter: { type: "bandpass", from: 800, to: 4000, q: 3 }, amp: strike(0.08, 0.4), level: 0.5 },
      { name: "Spinett", oscs: [["sawtooth"], ["sawtooth", 0.5, 0, 2]], filter: { from: 2000, to: 9000, q: 1 }, amp: strike(0.2, 0.9), noise: [bp(4000, 2), 0.1, 0.006], level: 0.28 },
    ],
  },
  {
    name: "E-Piano",
    sounds: [
      { name: "E-Piano", classic: 2 },
      { name: "Samtpiano", oscs: [["sine"]], fm: { times: 1, index: [0.2, 1.5], settle: 0.25, seconds: 0.3 }, amp: hold(0.003, 0.45, 0.8, 0.2, 0.6), level: 0.32 },
      { name: "Röhrenpiano", oscs: [["sine"]], fm: { times: 1, index: [1, 5], settle: 0.2, seconds: 0.15 }, amp: hold(0.003, 0.4, 0.6, 0.15, 0.5), level: 0.3, drive: 0.3 },
      { name: "Zinken", oscs: [["sine"], ["sine", 0.1, 0, 4]], fm: { times: 1, index: [0.5, 3], settle: 0.15, seconds: 0.2 }, amp: hold(0.003, 0.4, 0.9, 0.2, 0.7), level: 0.3 },
      { name: "Klavier", oscs: [["sawtooth", 0.3], ["triangle"]], filter: { from: 800, to: 6000, q: 0.8, env: [3, 0.3] }, amp: strike(0.4, 2), level: 0.5 },
      { name: "Clavi", oscs: [["square"]], filter: { type: "bandpass", from: 500, to: 4000, q: 2.5, env: [4, 0.08] }, amp: strike(0.15, 0.6), level: 1.6 },
      { name: "Vibraphon", oscs: [["sine"]], fm: { times: 4, index: [0.3, 2], seconds: 0.1 }, amp: strike(0.5, 2.5), level: 0.4 },
      { name: "Celesta", oscs: [["sine", 1, 0, 2]], fm: { times: 5, index: [0.5, 3], seconds: 0.1 }, amp: strike(0.3, 1.5), level: 0.36 },
      { name: "Spieluhr", oscs: [["sine", 1, 0, 2]], fm: { times: 7, index: [1, 4], seconds: 0.15 }, amp: strike(0.3, 1.2), level: 0.34 },
      { name: "Marimba", oscs: [["sine"]], fm: { times: 4, index: [0.5, 2.5], seconds: 0.03 }, amp: strike(0.15, 0.6), level: 0.5 },
    ],
  },
  {
    name: "Orgel",
    sounds: [
      { name: "Orgel", classic: 3 },
      { name: "Kirche", oscs: [["sine", 0.6], ["sine", 0.5, 0, 2], ["sine", [0.1, 0.4], 0, 4], ["triangle", 0.3, 0, 0.5]], amp: hold(0.03, 1, 0.1, 0.1, 0.8), level: 0.24 },
      { name: "Zugriegel", oscs: [["sine"], ["sine", 0.6, 0, 2], ["sine", [0.1, 0.5], 0, 3]], amp: hold(0.004, 1, 0.1, 0.03, 0.2), noise: [bp(2500, 2), 0.06, 0.008], level: 0.24 },
      { name: "Jahrmarkt", oscs: [["square"], ["square", 0.4, 0, 2]], filter: { from: 1500, to: 6000 }, amp: hold(0.01, 1, 0.1, 0.04, 0.3), vibrato: [12, 0.05, 0.1, 6.5], level: 0.14 },
      { name: "Harmonium", oscs: [["sawtooth", 1, -4], ["sawtooth", 1, 4]], filter: { from: 500, to: 2500, q: 1 }, amp: hold(0.05, 0.95, 0.2, 0.08, 0.5), vibrato: [5, 0.3, 0.3, 4.5], level: 0.2 },
      { name: "Flötenwerk", oscs: [["sine"], ["triangle", [0, 0.4], 0, 2]], amp: hold(0.04, 0.95, 0.2, 0.06, 0.5), noise: [bp(2000, 1), 0.04, 0.1, 0.03], level: 0.3 },
      { name: "Rock", oscs: [["sine"], ["sine", 0.7, 0, 2], ["sine", 0.5, 0, 3]], amp: hold(0.004, 1, 0.1, 0.03, 0.25), level: 0.2, drive: 0.5 },
      { name: "Zunge", oscs: [["square", 0.5], ["sawtooth", 0.3]], filter: { from: 600, to: 3000, q: 2 }, amp: hold(0.02, 0.95, 0.2, 0.05, 0.4), level: 0.28 },
      { name: "Akkordeon", oscs: [["sawtooth", 1, -14], ["sawtooth", 1, 14], ["square", 0.5]], filter: { from: 800, to: 4000, q: 1 }, amp: hold(0.03, 0.95, 0.2, 0.06, 0.4), level: 0.16 },
      { name: "Glasorgel", oscs: [["sine"], ["sine", [0.05, 0.3], 0, 3]], amp: hold(0.08, 0.95, 0.3, 0.2, 1.5), vibrato: [5, 0.3, 0.3], level: 0.3 },
    ],
  },
  {
    name: "Saiten",
    sounds: [
      { name: "Streicher", oscs: [["sawtooth", 1, -10], ["sawtooth", 1, 10]], filter: { from: 500, to: 4500, q: 0.8 }, amp: hold(0.12, 0.9, 0.4, 0.3, 1.5), vibrato: [7, 0.25, 0.3], level: 0.2 },
      { name: "Pizzicato", oscs: [["sawtooth"], ["triangle", 0.6]], filter: { from: 500, to: 4000, q: 1, env: [3, 0.05] }, amp: strike(0.08, 0.35), level: 0.5 },
      { name: "Gitarre", oscs: [["sawtooth", 0.4], ["triangle"]], filter: { from: 600, to: 5000, q: 1, env: [4, 0.1] }, amp: strike(0.3, 1.4), noise: [bp(3000, 1.5), 0.08, 0.008], level: 0.5 },
      { name: "Nylon", oscs: [["triangle"], ["sine", 0.4, 0, 2]], filter: { from: 400, to: 3000, q: 1, env: [3, 0.08] }, amp: strike(0.25, 1.1), level: 0.6 },
      { name: "Harfe", oscs: [["sine"], ["sine", 0.3, 0, 2], ["sine", 0.1, 0, 3]], amp: strike(0.4, 2), level: 0.5 },
      { name: "Bläsersatz", oscs: [["sawtooth", 1, -5], ["sawtooth", 1, 5]], filter: { from: 300, to: 3000, q: 1, env: [0.4, 0.1] }, amp: hold(0.04, 0.8, 0.3, 0.1, 0.6), level: 0.2 },
      { name: "Chor", oscs: [["sawtooth", 1, -6], ["sawtooth", 1, 6]], filter: { type: "bandpass", from: 500, to: 1400, q: 3 }, amp: hold(0.1, 0.9, 0.4, 0.2, 1.2), vibrato: [8, 0.25, 0.3], level: 0.6 },
      { name: "Banjo", oscs: [["sawtooth"]], filter: { type: "bandpass", from: 900, to: 3500, q: 2 }, amp: strike(0.08, 0.5), noise: [bp(3500, 2), 0.1, 0.006], level: 1.6 },
      { name: "Hackbrett", oscs: [["sawtooth"], ["sawtooth", 0.5, 4, 2]], filter: { from: 1500, to: 9000, q: 1 }, amp: strike(0.3, 1.5), level: 0.3 },
      { name: "Kammer", oscs: [["triangle", 1, -5], ["triangle", 1, 5], ["sawtooth", 0.2]], filter: { from: 400, to: 3000, q: 0.8 }, amp: hold(0.08, 0.9, 0.4, 0.2, 1.2), vibrato: [5, 0.3, 0.3], level: 0.3 },
    ],
  },
];
