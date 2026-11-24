import { bp, hold, strike, type Palette, type Tone } from "./shapes";

/*
 * The melody's palette: plucked strings, bells, pipes and whistles, saws, and
 * the square waves of old game consoles.
 */

export const LEAD: Palette<Tone> = [
  {
    name: "Pluck",
    sounds: [
      { name: "Pluck", classic: 0 },
      { name: "Harp", oscs: [["triangle"], ["sine", 0.3, 0, 2]], filter: { from: 800, to: 6000, q: 1, env: [3, 0.08] }, amp: strike(0.3, 1.8), level: 0.55 },
      { name: "Koto", oscs: [["sawtooth"]], filter: { type: "bandpass", from: 800, to: 5000, q: 2, env: [3, 0.06] }, amp: strike(0.2, 1), noise: [bp(4000, 2), 0.1, 0.006], level: 2 },
      { name: "Guitar", oscs: [["sawtooth", 0.5], ["triangle"]], filter: { from: 700, to: 5500, q: 1.5, env: [4, 0.1] }, amp: strike(0.3, 1.5), level: 0.5 },
      { name: "Kalimba", oscs: [["sine"]], fm: { times: 5.4, index: [0.3, 1.5], seconds: 0.04 }, amp: strike(0.2, 0.9), level: 0.5 },
      { name: "Pizzicato", oscs: [["sawtooth"]], filter: { from: 600, to: 4500, q: 1, env: [3, 0.04] }, amp: strike(0.06, 0.3), level: 0.55 },
      { name: "Banjo", oscs: [["sawtooth"]], filter: { type: "bandpass", from: 1000, to: 4000, q: 2.5 }, amp: strike(0.08, 0.45), level: 2 },
      { name: "Sitar", oscs: [["sawtooth", 1, -10], ["sawtooth", 1, 10]], filter: { from: 1500, to: 9000, q: 4, env: [2, 0.3] }, amp: strike(0.4, 1.6), level: 0.26, drive: 0.3 },
      { name: "Rubber band", oscs: [["triangle"]], filter: { from: 400, to: 3000, q: 2, env: [8, 0.03] }, amp: strike(0.08, 0.4), bend: [1.2, 0.04], level: 0.7 },
      { name: "Mandolin", oscs: [["sawtooth", 1, -12], ["sawtooth", 1, 12]], filter: { from: 1000, to: 7000, q: 1, env: [3, 0.07] }, amp: strike(0.2, 0.9), level: 0.34 },
    ],
  },
  {
    name: "Bell",
    sounds: [
      { name: "Bell", classic: 1 },
      { name: "Glockenspiel", oscs: [["sine"]], fm: { times: 4, index: [0.8, 5], seconds: 0.2 }, amp: strike(0.3, 2.2, 0.002), level: 0.36 },
      { name: "Chime", oscs: [["sine"]], fm: { times: 1.41, index: [1, 6], seconds: 0.4 }, amp: strike(0.5, 3, 0.002), level: 0.34 },
      { name: "Vibraphone", oscs: [["sine"]], fm: { times: 4, index: [0.2, 1.5], seconds: 0.15 }, amp: strike(0.6, 3, 0.002), level: 0.4 },
      { name: "Music box", oscs: [["sine", 1, 0, 2]], fm: { times: 7, index: [1, 4], seconds: 0.15 }, amp: strike(0.3, 1.4, 0.002), level: 0.34 },
      { name: "Crystal", oscs: [["sine"]], fm: { times: 7, index: [0.5, 3], seconds: 0.1 }, amp: strike(0.3, 2, 0.002), level: 0.36 },
      { name: "Gong", oscs: [["sine"]], fm: { times: 1.19, index: [2, 8], seconds: 0.6 }, amp: strike(0.8, 4, 0.002), level: 0.34 },
      { name: "Xylophone", oscs: [["sine"]], fm: { times: 3, index: [0.5, 3], seconds: 0.03 }, amp: strike(0.1, 0.5, 0.002), level: 0.5 },
      { name: "Triangle", oscs: [["sine", 1, 0, 4]], fm: { times: 21.2, index: [0.3, 2], seconds: 0.3 }, amp: strike(0.4, 2, 0.002), level: 0.3 },
      { name: "Temple", oscs: [["sine"]], fm: { times: 2.76, index: [1, 5], seconds: 0.35 }, amp: strike(0.5, 3, 0.002), level: 0.34 },
    ],
  },
  {
    name: "Pipe",
    sounds: [
      { name: "Pipe", classic: 2 },
      { name: "Flute", oscs: [["sine"], ["triangle", [0, 0.4]]], amp: hold(0.03, 0.9, 0.1, 0.06, 0.5), vibrato: [10, 0.15, 0.2], noise: [bp(2500, 1), 0.05, 0.12, 0.02], glide: true, level: 0.26 },
      { name: "Ocarina", oscs: [["sine"], ["sine", [0, 0.15], 0, 2]], amp: hold(0.03, 0.9, 0.1, 0.06, 0.5), vibrato: [8, 0.2, 0.2], level: 0.28 },
      { name: "Pan flute", oscs: [["triangle"]], amp: hold(0.04, 0.9, 0.1, 0.08, 0.6), noise: [bp(1800, 0.8), 0.12, 0.15, 0.03], level: 0.3 },
      { name: "Whistle", oscs: [["sine"]], amp: hold(0.015, 0.9, 0.1, 0.05, 0.4), vibrato: [20, 0.08, 0.1, 6.5], glide: true, level: 0.26 },
      { name: "Recorder", oscs: [["triangle", 0.7], ["sine", [0, 0.12], 0, 3]], amp: hold(0.03, 0.9, 0.1, 0.06, 0.5), level: 0.3 },
      { name: "Theremin", oscs: [["sine"], ["sine", 0.1, 0, 2]], amp: hold(0.06, 0.95, 0.2, 0.15, 0.9), vibrato: [25, 0.05, 0.15, 5.8], glide: true, level: 0.26 },
      { name: "Bottleneck", oscs: [["sine"]], amp: hold(0.05, 0.9, 0.1, 0.08, 0.6), noise: [bp(1200, 1.5), 0.15, 0.2, 0.04], level: 0.28 },
      { name: "Hum", oscs: [["triangle"]], filter: { from: 600, to: 2500 }, amp: hold(0.05, 0.9, 0.2, 0.08, 0.6), vibrato: [10, 0.2, 0.2], level: 0.34 },
      { name: "Bird", oscs: [["sine"]], amp: hold(0.005, 0.8, 0.1, 0.04, 0.3), bend: [1.5, 0.05], vibrato: [15, 0.03, 0.05, 9], level: 0.28 },
    ],
  },
  {
    name: "Saw",
    sounds: [
      { name: "Saw", classic: 3 },
      { name: "Wide", oscs: [["sawtooth", 1, -16], ["sawtooth"], ["sawtooth", 1, 16]], filter: { from: 800, to: 7000, q: 1.5 }, amp: hold(0.012, 0.75, 0.2, 0.06, 0.7), vibrato: [9], level: 0.17 },
      { name: "Sync", oscs: [["sawtooth"], ["sawtooth", 0.5, 7, 2]], filter: { from: 700, to: 6500, q: 4, env: [3, 0.2] }, amp: hold(0.01, 0.75, 0.2, 0.06, 0.6), level: 0.22 },
      { name: "Trance", oscs: [["sawtooth", 1, -10], ["sawtooth", 1, 10], ["sawtooth", 0.3, 0, 2]], filter: { from: 900, to: 8000, q: 1 }, amp: hold(0.005, 0.6, 0.15, 0.08, 0.8), level: 0.2 },
      { name: "Scream", oscs: [["sawtooth"]], filter: { from: 1000, to: 6000, q: 3 }, amp: hold(0.01, 0.8, 0.2, 0.06, 0.6), vibrato: [15, 0.15, 0.15], level: 0.2, drive: 0.7 },
      { name: "Violin", oscs: [["sawtooth"]], filter: { from: 800, to: 4500, q: 1 }, amp: hold(0.07, 0.9, 0.3, 0.1, 0.7), vibrato: [9, 0.2, 0.25], glide: true, level: 0.26 },
      { name: "Tin", oscs: [["sawtooth"]], filter: { from: 400, to: 4000, q: 1.5, env: [0.4, 0.1] }, amp: hold(0.03, 0.8, 0.3, 0.08, 0.5), level: 0.3 },
      { name: "Glider", oscs: [["sawtooth", 1, -5], ["sawtooth", 1, 5]], filter: { from: 600, to: 5000, q: 2.5 }, amp: hold(0.012, 0.8, 0.2, 0.06, 0.7), glide: true, level: 0.22 },
      { name: "Fifth", oscs: [["sawtooth"], ["sawtooth", 0.6, 0, 1.498]], filter: { from: 700, to: 6000, q: 1.5 }, amp: hold(0.012, 0.75, 0.2, 0.06, 0.7), level: 0.2 },
      { name: "Oboe", oscs: [["sawtooth"]], filter: { type: "bandpass", from: 900, to: 2500, q: 2.5 }, amp: hold(0.03, 0.9, 0.2, 0.06, 0.5), vibrato: [7, 0.25, 0.25], level: 1.4 },
    ],
  },
  {
    name: "Beep",
    sounds: [
      { name: "Square", oscs: [["square"]], filter: { from: 1500, to: 9000 }, amp: hold(0.004, 0.9, 0.1, 0.04, 0.4), level: 0.14 },
      { name: "Octave", oscs: [["square"], ["square", 0.5, 0, 2]], filter: { from: 1500, to: 9000 }, amp: hold(0.004, 0.9, 0.1, 0.04, 0.4), level: 0.12 },
      { name: "Console", oscs: [["square"]], amp: strike(0.05, 0.3, 0.001), level: 0.18 },
      { name: "Arcade", oscs: [["square"]], amp: hold(0.004, 0.9, 0.1, 0.04, 0.3), vibrato: [30, 0.02, 0.05, 8], level: 0.14 },
      { name: "Clarinet", oscs: [["square"]], filter: { from: 400, to: 2500, q: 1 }, amp: hold(0.03, 0.9, 0.2, 0.06, 0.5), vibrato: [5, 0.3, 0.3], level: 0.26 },
      { name: "Two notes", oscs: [["square"], ["square", 0.6, 0, 1.26]], filter: { from: 1200, to: 7000 }, amp: hold(0.004, 0.85, 0.1, 0.04, 0.4), level: 0.12 },
      { name: "Tri", oscs: [["triangle"]], amp: hold(0.004, 0.95, 0.1, 0.04, 0.4), level: 0.4 },
      { name: "Robot", oscs: [["sine"]], fm: { times: 1.5, index: [1, 6], settle: 1, seconds: 0.1 }, amp: hold(0.005, 0.9, 0.1, 0.04, 0.4), level: 0.26 },
      { name: "Beetle", oscs: [["square"]], filter: { type: "bandpass", from: 1200, to: 5000, q: 4 }, amp: strike(0.04, 0.25, 0.001), level: 2 },
      { name: "Siren", oscs: [["square", 0.7], ["sine", 0.5]], filter: { from: 800, to: 5000, q: 2 }, amp: hold(0.02, 0.9, 0.1, 0.06, 0.6), vibrato: [40, 0.1, 0.3, 4], glide: true, level: 0.16 },
    ],
  },
];
