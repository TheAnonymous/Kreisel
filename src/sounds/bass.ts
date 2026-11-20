import { bp, hold, strike, type Palette, type Tone } from "./shapes";

/*
 * The bass's palette: pure lows, saws, squelching filters, rubber, and
 * strings that are plucked or bowed.
 */

/** The squelching kind holds its note and lets go at once; its filter is what moves. */
const acid = hold(0.004, 0.75, 0.15, 0.06, 0.06);

export const BASS: Palette<Tone> = [
  {
    name: "Sub",
    sounds: [
      { name: "Sub", classic: 0 },
      { name: "Rein", oscs: [["sine"], ["sine", [0, 0.4], 0, 2]], amp: hold(0.006, 0.9, 0.2, 0.05, 0.5), level: 0.46, glide: true },
      { name: "Dreieck", oscs: [["triangle", 0.8], ["sine", 0.6, 0, 1, true]], filter: { from: 200, to: 2000 }, amp: hold(0.006, 0.9, 0.2, 0.05, 0.5), level: 0.4 },
      { name: "Boom", oscs: [["sine"], ["triangle", [0.05, 0.4]]], bend: [1.8, 0.05], amp: strike(0.3, 1.6, 0.004), level: 0.5 },
      { name: "Wumm", oscs: [["sine", 1, 0, 1, true], ["square", 0.2]], filter: { from: 120, to: 900, q: 1 }, amp: strike(0.2, 0.9), level: 0.48 },
      { name: "Orgelbass", oscs: [["sine"], ["sine", 0.5, 0, 2], ["sine", [0.05, 0.3], 0, 3]], amp: hold(0.01, 1, 0.1, 0.04, 0.4), level: 0.36 },
      { name: "Mulde", oscs: [["triangle"]], filter: { from: 150, to: 900 }, amp: hold(0.01, 0.9, 0.2, 0.08, 0.7), level: 0.5 },
      { name: "Dunkel", oscs: [["sawtooth", 0.7], ["sine", 0.8, 0, 1, true]], filter: { from: 80, to: 400, q: 1 }, amp: hold(0.008, 0.85, 0.2, 0.05, 0.4), level: 0.36 },
      { name: "Puls", oscs: [["square", 0.35], ["sine", 0.9, 0, 1, true]], filter: { from: 120, to: 700, q: 1.5 }, amp: hold(0.005, 0.85, 0.2, 0.05, 0.4), level: 0.4 },
      { name: "Stütze", oscs: [["sine"], ["triangle", [0.05, 0.5], 0, 2]], amp: hold(0.03, 0.95, 0.2, 0.08, 0.6), level: 0.42 },
    ],
  },
  {
    name: "Säge",
    sounds: [
      { name: "Säge", classic: 1 },
      { name: "Breit", oscs: [["sawtooth", 1, -14], ["sawtooth"], ["sawtooth", 1, 14], ["sine", 1.2, 0, 1, true]], filter: { from: 200, to: 3600, q: 1.5, env: [2.5, 0.2] }, amp: hold(0.005, 0.8, 0.25, 0.05, 0.45), level: 0.16 },
      { name: "Schwarm", oscs: [["sawtooth", 1, -22], ["sawtooth", 1, 22]], filter: { from: 150, to: 1800, q: 1.2 }, amp: hold(0.01, 0.9, 0.3, 0.06, 0.5), level: 0.26, glide: true },
      { name: "Knurr", oscs: [["sawtooth"], ["square", 0.6, 5]], filter: { from: 120, to: 1500, q: 5, env: [2, 0.3] }, amp: hold(0.005, 0.8, 0.25, 0.05, 0.4), level: 0.22, drive: 0.4 },
      { name: "Brett", oscs: [["sawtooth"], ["sawtooth", 0.4, 0, 2]], filter: { from: 300, to: 4000, q: 1, env: [2, 0.1] }, amp: strike(0.2, 0.9), level: 0.3 },
      { name: "Motor", oscs: [["sawtooth"], ["sawtooth", 0.35, 0, 1.5]], filter: { from: 200, to: 2500, q: 1.5 }, amp: hold(0.005, 0.85, 0.2, 0.05, 0.4), level: 0.24 },
      { name: "Kaskade", oscs: [["sawtooth"], ["triangle", 0.6, 0, 1, true]], filter: { from: 100, to: 2200, q: 4, env: [4, 0.25] }, amp: hold(0.004, 0.7, 0.3, 0.05, 0.4), level: 0.26 },
      { name: "Fuzz", oscs: [["sawtooth"]], filter: { from: 250, to: 3000, q: 1 }, amp: hold(0.005, 0.85, 0.2, 0.05, 0.4), level: 0.2, drive: 0.8 },
      { name: "Horn", oscs: [["sawtooth"]], filter: { from: 120, to: 1200, q: 1, env: [0.4, 0.12] }, amp: hold(0.05, 0.85, 0.3, 0.08, 0.5), level: 0.34 },
      { name: "Schwebung", oscs: [["sawtooth", 1, -30], ["sawtooth", 1, 30], ["sine", 0.8, 0, 1, true]], filter: { from: 180, to: 2800, q: 2, env: [3, 0.18] }, amp: hold(0.005, 0.8, 0.25, 0.05, 0.45), level: 0.2 },
    ],
  },
  {
    name: "Acid",
    sounds: [
      { name: "Acid", classic: 2 },
      { name: "Kantig", oscs: [["square"]], filter: { from: 110, to: 1500, q: 13, env: [5, 0.08, 0.5] }, amp: acid, level: 0.34, glide: true },
      { name: "Zwitscher", oscs: [["sawtooth"]], filter: { from: 150, to: 2000, q: 18, env: [8, 0.05, 0.2] }, amp: acid, level: 0.36, glide: true },
      { name: "Blubber", oscs: [["sawtooth"]], filter: { from: 90, to: 1200, q: 10, env: [4, 0.2, 0.7] }, amp: acid, level: 0.44, glide: true },
      { name: "Gift", oscs: [["sawtooth"]], filter: { from: 110, to: 1500, q: 12, env: [5, 0.08, 0.5] }, amp: acid, level: 0.3, glide: true, drive: 0.6 },
      { name: "Quak", oscs: [["square"]], filter: { type: "bandpass", from: 200, to: 2400, q: 6, env: [4, 0.08, 0.3] }, amp: acid, level: 2.4, glide: true },
      { name: "Schnapp", oscs: [["sawtooth"]], filter: { from: 130, to: 1800, q: 16, env: [12, 0.03, 0.1] }, amp: acid, level: 0.4, glide: true },
      { name: "Schnurr", oscs: [["sawtooth", 1, -12], ["sawtooth", 1, 12]], filter: { from: 110, to: 1400, q: 9, env: [3, 0.1, 0.4] }, amp: acid, level: 0.3, glide: true },
      { name: "Gurgel", oscs: [["square"]], filter: { from: 90, to: 900, q: 15, env: [6, 0.15, 0.6] }, amp: acid, level: 0.4, glide: true },
      { name: "Hohl", oscs: [["sawtooth"]], filter: { type: "bandpass", from: 300, to: 3000, q: 4 }, amp: hold(0.004, 0.8, 0.15, 0.06, 0.3), level: 2.4, glide: true },
    ],
  },
  {
    name: "Gummi",
    sounds: [
      { name: "Gummi", classic: 3 },
      { name: "Flummi", oscs: [["triangle"], ["sine", 0.8, 0, 1, true]], filter: { from: 150, to: 1500, q: 3, env: [8, 0.05] }, amp: strike(0.12, 0.7), level: 0.7 },
      { name: "Knete", oscs: [["sine"]], fm: { times: 1, index: [0.5, 4], seconds: 0.12 }, amp: strike(0.15, 0.8), level: 0.6 },
      { name: "Knopf", oscs: [["sine"]], fm: { times: 2, index: [1, 6], seconds: 0.08 }, amp: strike(0.15, 0.8), level: 0.55 },
      { name: "Daumen", oscs: [["sawtooth"]], filter: { from: 300, to: 5000, q: 2, env: [7, 0.04] }, amp: strike(0.1, 0.5), noise: [bp(2500, 1), 0.15, 0.01], level: 0.5 },
      { name: "Korken", oscs: [["sine"]], fm: { times: 3, index: [0.3, 2], seconds: 0.04 }, amp: strike(0.1, 0.5), level: 0.7 },
      { name: "Zupfbass", oscs: [["triangle"], ["sawtooth", 0.3]], filter: { from: 200, to: 3000, q: 1.5, env: [5, 0.1] }, amp: strike(0.2, 0.9), level: 0.6 },
      { name: "Blase", oscs: [["sine"]], fm: { times: 1, index: [0.2, 1.5], settle: 0.5, seconds: 0.3 }, amp: hold(0.03, 0.85, 0.3, 0.08, 0.5), level: 0.5 },
      { name: "Gluck", oscs: [["square", 0.6], ["sine", 0.8, 0, 1, true]], filter: { from: 200, to: 2000, q: 8, env: [10, 0.03] }, amp: strike(0.08, 0.4), level: 0.6 },
      { name: "Federbass", oscs: [["sine"]], fm: { times: 3.5, index: [0.5, 3], seconds: 0.2 }, amp: strike(0.2, 1), level: 0.55 },
    ],
  },
  {
    name: "Saite",
    sounds: [
      { name: "Kontrabass", oscs: [["triangle"], ["sine", 0.8, 0, 1, true]], filter: { from: 250, to: 1800, q: 1, env: [3, 0.06] }, amp: strike(0.25, 1), noise: [bp(1200, 1), 0.1, 0.012], level: 0.6 },
      { name: "E-Bass", oscs: [["sawtooth", 0.5], ["triangle"]], filter: { from: 300, to: 2600, q: 1.2, env: [3, 0.12] }, amp: strike(0.3, 1.2), level: 0.5 },
      { name: "Plektrum", oscs: [["sawtooth"], ["square", 0.3]], filter: { from: 500, to: 5000, q: 1.5, env: [5, 0.05] }, amp: strike(0.2, 0.8), noise: [bp(3500, 1.5), 0.12, 0.008], level: 0.4 },
      { name: "Bundlos", oscs: [["sine"], ["triangle", 0.5]], filter: { from: 300, to: 1500 }, amp: hold(0.02, 0.85, 0.3, 0.08, 0.5), vibrato: [10, 0.15, 0.2], glide: true, level: 0.5 },
      { name: "Klavierbass", oscs: [["sine"]], fm: { times: 1, index: [1, 5], settle: 0.2, seconds: 0.25 }, amp: strike(0.4, 1.5), level: 0.5 },
      { name: "Pfeifenbass", oscs: [["triangle"], ["sine", [0, 0.3], 0, 2]], amp: hold(0.04, 0.95, 0.2, 0.08, 0.5), noise: [bp(600, 1), 0.06, 0.1, 0.03], level: 0.5 },
      { name: "Cello", oscs: [["sawtooth"]], filter: { from: 200, to: 1600, q: 1 }, amp: hold(0.06, 0.9, 0.3, 0.1, 0.6), vibrato: [8, 0.2, 0.25], level: 0.34 },
      { name: "Harfe", oscs: [["triangle"], ["sine", 0.3, 0, 2]], filter: { from: 300, to: 3000, q: 1, env: [3, 0.05] }, amp: strike(0.4, 1.6), level: 0.6 },
      { name: "Kalimbass", oscs: [["sine"], ["sine", 0.15, 0, 5.4]], amp: strike(0.2, 0.8), noise: [bp(2000, 2), 0.08, 0.006], level: 0.6 },
      { name: "Glockenbass", oscs: [["sine"]], fm: { times: 3.5, index: [1, 4], seconds: 0.3 }, amp: strike(0.4, 1.6), level: 0.5 },
    ],
  },
];
