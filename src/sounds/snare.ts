import { bp, clap, hp, lp, noise, pk, tone, type Drum, type FilterRow, type Part, type Palette } from "./shapes";

/*
 * The snare's palette: drums with a rattle, hands that clap, sticks on a rim,
 * fingers that snap, and noise of other kinds.
 */

/** A body that falls from `top` to `bottom` Hz in 50 ms, and a rattle of noise; `body` is [level, decay]. */
const snare = (top: number, bottom: number, body: readonly [number, number], rattle: readonly FilterRow[], level: number, decay: number, ...more: Part[]): Part[] => [
  tone("triangle", top, body[0], body[1], { fall: [bottom, 0.05] }),
  noise(rattle, level, decay),
  ...more,
];

/** A stick on something hard: a short tone and a tick of noise. */
const rim = (wave: OscillatorType, hz: number, level: number, decay: number, tick: readonly [hz: number, q: number, level: number], ...more: Part[]): Part[] => [
  tone(wave, hz, level, decay, { attack: 0.001, filter: hp(hz * 0.6) }),
  noise([bp(tick[0], tick[1])], tick[2], 0.014, { attack: 0.0005, tight: true }),
  ...more,
];

/** Two bursts of narrow noise a moment apart: the finger leaves the thumb, then lands. */
const snap = (hz: number, q: number, first: readonly [number, number], second: readonly [number, number], gap = 0.013): Part[] => [
  noise([bp(hz, q)], first[0], first[1], { attack: 0.0005, tight: true }),
  noise([bp(hz, q)], second[0], second[1], { attack: 0.0005, after: gap }),
];

export const SNARE: Palette<Drum> = [
  {
    name: "Snare",
    sounds: [
      { name: "Snare", classic: 0 },
      { name: "Dry", parts: snare(250, 180, [0.5, 0.07], [hp(2600)], 0.5, 0.09) },
      { name: "Fat", parts: snare(200, 140, [0.65, 0.14], [hp(1500)], 0.55, 0.2) },
      { name: "Bright", parts: snare(280, 200, [0.4, 0.08], [hp(3600)], 0.55, 0.13) },
      { name: "Wire", parts: snare(240, 170, [0.3, 0.08], [bp(4500, 0.8), pk(7000, 2, 6)], 0.9, 0.22) },
      { name: "March", parts: snare(300, 220, [0.5, 0.09], [hp(2400)], 0.5, 0.16, tone("sine", 440, 0.2, 0.03, { tight: true })) },
      { name: "Brushes", parts: snare(220, 170, [0.15, 0.08], [bp(2500, 0.6)], 0.8, 0.2, noise([hp(5000)], 0.2, 0.12, { attack: 0.02 })) },
      { name: "Bin", parts: snare(170, 120, [0.7, 0.18], [hp(1200)], 0.45, 0.2) },
      { name: "Pow", parts: snare(260, 150, [0.6, 0.06], [hp(3000)], 0.7, 0.07), drive: 0.3 },
      { name: "Reverb", parts: snare(220, 160, [0.5, 0.12], [bp(2000, 0.5)], 0.7, 0.4) },
    ],
  },
  {
    name: "Clap",
    sounds: [
      { name: "Clap", classic: 1 },
      { name: "Hands", parts: [clap(1000, 0.9, [0.12, 0.5])] },
      { name: "Tight", parts: [clap(1700, 0.8, [0.06, 0.3])] },
      { name: "Crowd", parts: [clap(1100, 0.7, [0.1, 0.45]), clap(1500, 0.6, [0.1, 0.4], 0.015), clap(900, 0.5, [0.1, 0.5], 0.028)] },
      { name: "Smack", parts: [clap(800, 1, [0.08, 0.35])] },
      { name: "Sharp", parts: [clap(2400, 0.85, [0.08, 0.4])] },
      { name: "Disco", parts: [clap(1300, 0.9, [0.1, 0.4]), noise([bp(1300, 0.7)], 0.3, 0.3, { after: 0.03 })] },
      { name: "Thigh", parts: [clap(600, 1, [0.08, 0.3]), tone("sine", 150, 0.3, 0.05, { fall: [90, 0.03] })] },
      { name: "Lightning", parts: [clap(3200, 0.8, [0.05, 0.25])] },
      { name: "Applause", parts: [clap(1100, 0.7, [0.1, 0.4]), clap(1400, 0.6, [0.1, 0.4], 0.03), clap(900, 0.6, [0.12, 0.5], 0.07)] },
    ],
  },
  {
    name: "Rim",
    sounds: [
      { name: "Rim", classic: 2 },
      { name: "Stick", parts: rim("square", 1100, 0.36, 0.025, [4500, 1.4, 0.5]) },
      { name: "Wooden rim", parts: rim("triangle", 640, 0.6, 0.04, [2400, 1.2, 0.3]) },
      { name: "Click", parts: rim("square", 1800, 0.3, 0.012, [7000, 2, 0.4]) },
      { name: "Knock", parts: rim("sine", 420, 0.7, 0.05, [1800, 1, 0.3]) },
      { name: "Reed", parts: [tone("sine", 1500, 0.6, 0.03, { attack: 0.001, fall: [700, 0.02] }), noise([bp(3000, 2)], 0.2, 0.01, { tight: true })] },
      { name: "Ping", parts: rim("sine", 1900, 0.4, 0.09, [5000, 2, 0.3], tone("square", 2850, 0.06, 0.06, { filter: hp(1500) })) },
      { name: "Tick", parts: [noise([bp(7000, 3)], 2.4, 0.008, { attack: 0.0005, tight: true }), noise([hp(9000)], 0.2, 0.02)] },
      { name: "Crack", parts: rim("square", 500, 0.4, 0.02, [2000, 2, 0.6]), drive: 0.4 },
      { name: "Table edge", parts: rim("triangle", 900, 0.5, 0.035, [3000, 1.5, 0.4], tone("triangle", 1350, 0.25, 0.03)) },
    ],
  },
  {
    name: "Finger snap",
    sounds: [
      { name: "Finger snap", classic: 3 },
      { name: "Finger", parts: snap(3200, 3, [0.7, 0.006], [1.5, 0.04], 0.012) },
      { name: "Sparks", parts: snap(5000, 2, [0.6, 0.005], [1.3, 0.03], 0.01) },
      { name: "Plop", parts: [tone("sine", 600, 0.7, 0.06, { attack: 0.001, fall: [300, 0.03] }), noise([bp(1500, 1.5)], 0.3, 0.01, { tight: true })] },
      { name: "Cluck", parts: snap(1900, 4, [0.9, 0.006], [1.6, 0.03], 0.018) },
      { name: "Flick", parts: [noise([hp(4000)], 0.6, 0.004, { attack: 0.0005, tight: true }), noise([hp(4000)], 0.5, 0.012, { attack: 0.0005, after: 0.02 })] },
      { name: "Castanet", parts: [tone("sine", 2000, 0.5, 0.02, { attack: 0.001, tight: true }), noise([bp(2600, 2)], 0.5, 0.012, { tight: true }), tone("sine", 2200, 0.4, 0.02, { attack: 0.001, after: 0.03 }), noise([bp(2800, 2)], 0.4, 0.015, { after: 0.03 })] },
      { name: "Paper", parts: [noise([hp(3000)], 0.6, 0.06, { attack: 0.005 })] },
      { name: "Fizz", parts: [noise([bp(6000, 5)], 2.8, 0.02, { attack: 0.001 })] },
      { name: "Puff", parts: [noise([bp(1500, 0.8)], 0.8, 0.08, { attack: 0.01 })] },
    ],
  },
  {
    name: "Din",
    sounds: [
      { name: "Electro", parts: [tone("sine", 330, 0.6, 0.08, { attack: 0.001, fall: [180, 0.03] }), noise([hp(1800)], 0.5, 0.12)] },
      { name: "Machine", parts: [tone("sine", 238, 0.45, 0.1), tone("sine", 476, 0.3, 0.07), noise([hp(2500)], 0.45, 0.15)] },
      { name: "Pellets", parts: [noise([hp(400), lp(3000)], 0.9, 0.12)], drive: 0.6 },
      { name: "Tin can", parts: [tone("square", 540, 0.2, 0.07, { filter: hp(400) }), tone("square", 800, 0.16, 0.06, { filter: hp(600) }), noise([bp(4200, 1.5)], 0.6, 0.08)] },
      { name: "Shot", parts: [tone("sine", 2000, 0.5, 0.1, { attack: 0.001, fall: [200, 0.08] }), noise([hp(2000)], 0.35, 0.08)] },
      { name: "Noise", parts: [noise([hp(500)], 0.5, 0.25)] },
      { name: "Steam", parts: [noise([bp(900, 0.5)], 0.9, 0.3, { attack: 0.02 })] },
      { name: "Stumble", parts: [tone("square", 150, 0.3, 0.03, { filter: lp(900), tight: true }), noise([hp(2000)], 0.5, 0.02, { tight: true }), noise([hp(2000)], 0.4, 0.02, { tight: true, after: 0.03 }), noise([hp(2000)], 0.3, 0.05, { after: 0.06 })] },
      { name: "Stone", parts: [tone("sine", 190, 0.7, 0.05, { attack: 0.001, fall: [90, 0.02] }), noise([bp(1400, 1.2)], 0.7, 0.03)], drive: 0.3 },
      { name: "Wave", parts: [noise([bp(2200, 0.8)], 0.9, 0.15, { attack: 0.04 }), tone("triangle", 200, 0.3, 0.08, { after: 0.04 })] },
    ],
  },
];
