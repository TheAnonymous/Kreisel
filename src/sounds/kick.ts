import { bp, click, hp, lp, noise, tone, type Drum, type Part, type Palette } from "./shapes";

/*
 * The kick's palette. A kick is a sine that falls from `top` to `bottom` Hz,
 * a short knock (a filtered square, so it is heard on small speakers too)
 * and a tick of noise; some have more parts on top of that.
 */

/** The body falls from `top` to `bottom` within `sweep` seconds and rings for `decay`; `knock` and `tick` are [Hz, level]. */
const kick = (top: number, bottom: number, sweep: number, decay: number, level: number, knock: readonly [number, number], tick: readonly [number, number], ...more: Part[]): Part[] => [
  tone("sine", top, level, decay, { attack: 0.001, fall: [bottom, sweep] }),
  tone("square", knock[0], knock[1], 0.03, { attack: 0.001, filter: lp(900), tight: true }),
  click(tick[0], tick[1]),
  ...more,
];

export const KICK: Palette<Drum> = [
  {
    name: "Rund",
    sounds: [
      { name: "Rund", classic: 0 },
      { name: "Samt", parts: kick(140, 50, 0.09, 0.34, 0.95, [110, 0.06], [2200, 0.08]) },
      { name: "Kissen", parts: kick(120, 46, 0.1, 0.28, 0.95, [100, 0.04], [1500, 0.03]) },
      { name: "Herz", parts: kick(100, 44, 0.06, 0.22, 1, [90, 0.1], [1200, 0.05]) },
      { name: "Bauch", parts: kick(165, 55, 0.11, 0.4, 0.95, [120, 0.1], [2600, 0.12]) },
      { name: "Pauke", parts: kick(130, 62, 0.14, 0.55, 0.9, [130, 0.08], [2000, 0.1], tone("triangle", 190, 0.12, 0.4)) },
      { name: "Ballon", parts: kick(180, 60, 0.16, 0.32, 0.9, [140, 0.05], [3000, 0.06]) },
      { name: "Wolle", parts: kick(110, 48, 0.07, 0.26, 0.95, [95, 0.14], [900, 0.06], noise([lp(400)], 0.12, 0.05, { tight: true })) },
      { name: "Mond", parts: kick(145, 43, 0.2, 0.5, 0.9, [100, 0.04], [2400, 0.05]) },
      { name: "Tropfen", parts: kick(220, 58, 0.04, 0.24, 0.95, [130, 0.06], [4200, 0.1]) },
    ],
  },
  {
    name: "Hart",
    sounds: [
      { name: "Hart", classic: 1 },
      { name: "Punch", parts: kick(250, 56, 0.045, 0.22, 1, [150, 0.26], [4000, 0.45]) },
      { name: "Faust", parts: kick(200, 50, 0.04, 0.18, 1, [160, 0.34], [3200, 0.5]), drive: 0.25 },
      { name: "Nagel", parts: kick(300, 60, 0.03, 0.15, 1, [170, 0.2], [5200, 0.6]) },
      { name: "Tür", parts: kick(180, 64, 0.035, 0.13, 1, [200, 0.4], [2400, 0.35], noise([bp(800, 1)], 0.2, 0.03, { tight: true })) },
      { name: "Hammer", parts: kick(260, 48, 0.06, 0.26, 1, [140, 0.3], [3800, 0.5]), drive: 0.4 },
      { name: "Kante", parts: kick(220, 70, 0.025, 0.12, 1, [180, 0.3], [6000, 0.5]) },
      { name: "Stahl", parts: kick(240, 52, 0.05, 0.2, 1, [150, 0.2], [7000, 0.4], tone("square", 430, 0.08, 0.04, { filter: hp(900), tight: true })) },
      { name: "Rammbock", parts: kick(190, 45, 0.07, 0.3, 1, [130, 0.36], [3000, 0.4]), drive: 0.6 },
      { name: "Peitsche", parts: kick(400, 58, 0.03, 0.17, 0.95, [150, 0.18], [8000, 0.5]) },
    ],
  },
  {
    name: "Tief",
    sounds: [
      { name: "Tief", classic: 2 },
      { name: "Keller", parts: kick(95, 38, 0.14, 0.9, 0.95, [90, 0.06], [2000, 0.06]) },
      { name: "Lang", parts: kick(120, 44, 0.09, 1.1, 0.95, [100, 0.08], [2800, 0.12]) },
      { name: "Wal", parts: kick(85, 36, 0.25, 1, 0.9, [80, 0.05], [1500, 0.04]) },
      { name: "Grollen", parts: kick(100, 40, 0.1, 0.8, 0.95, [85, 0.1], [1800, 0.06]), drive: 0.3 },
      { name: "Pedal", parts: kick(80, 55, 0.05, 0.7, 0.9, [110, 0.06], [2200, 0.08], tone("sine", 110, 0.2, 0.6)) },
      { name: "Taucher", parts: kick(130, 35, 0.3, 0.7, 0.9, [90, 0.05], [2000, 0.05]) },
      { name: "Grund", parts: kick(70, 42, 0.05, 0.6, 1, [84, 0.1], [1200, 0.03]) },
      { name: "Donner", parts: kick(110, 39, 0.12, 1.2, 0.9, [95, 0.1], [2400, 0.1], noise([lp(300)], 0.2, 0.5)) },
      { name: "Glockenfuß", parts: kick(105, 50, 0.1, 0.9, 0.85, [100, 0.06], [2200, 0.08], tone("sine", 157, 0.15, 0.8), tone("sine", 236, 0.08, 0.6)) },
    ],
  },
  {
    name: "Staub",
    sounds: [
      { name: "Staub", classic: 3 },
      { name: "Karton", parts: kick(140, 70, 0.04, 0.14, 0.85, [150, 0.3], [1500, 0.1], noise([bp(500, 1.5)], 0.25, 0.04, { tight: true })) },
      { name: "Kassette", parts: kick(125, 50, 0.07, 0.22, 0.8, [100, 0.2], [1400, 0.06], noise([hp(5000)], 0.05, 0.2)), drive: 0.2 },
      { name: "Koffer", parts: kick(115, 60, 0.05, 0.18, 0.85, [170, 0.35], [1100, 0.12]) },
      { name: "Teppich", parts: kick(105, 50, 0.08, 0.2, 0.85, [80, 0.18], [800, 0.05], noise([lp(600)], 0.15, 0.06, { tight: true })) },
      { name: "Vinyl", parts: kick(135, 54, 0.06, 0.24, 0.8, [95, 0.16], [2400, 0.2], noise([bp(3000, 0.7)], 0.06, 0.1)), drive: 0.15 },
      { name: "Pappe", parts: kick(160, 80, 0.03, 0.1, 0.85, [200, 0.3], [2000, 0.15], noise([bp(900, 2)], 0.2, 0.03, { tight: true })) },
      { name: "Radio", parts: kick(150, 75, 0.05, 0.16, 0.8, [220, 0.35], [2600, 0.2]), drive: 0.3 },
      { name: "Keks", parts: kick(170, 66, 0.03, 0.09, 0.9, [160, 0.25], [3400, 0.3]) },
      { name: "Dachboden", parts: kick(120, 48, 0.09, 0.3, 0.8, [100, 0.15], [1600, 0.08], noise([bp(1200, 0.6)], 0.1, 0.25)) },
    ],
  },
  {
    name: "Schräg",
    sounds: [
      { name: "Laser", parts: kick(900, 60, 0.09, 0.2, 0.8, [120, 0.02], [5000, 0.1]) },
      { name: "Zapp", parts: kick(1400, 90, 0.05, 0.14, 0.7, [120, 0.02], [6000, 0.1]) },
      { name: "Blubb", parts: kick(300, 120, 0.08, 0.16, 0.85, [160, 0.05], [2000, 0.05]) },
      { name: "Fass", parts: kick(190, 95, 0.1, 0.3, 0.9, [150, 0.1], [2500, 0.15]) },
      { name: "Quadrat", parts: [tone("square", 110, 0.5, 0.25, { attack: 0.001, fall: [45, 0.07], filter: lp(350) }), click(2500, 0.2)] },
      { name: "Dreieck", parts: [tone("triangle", 150, 1, 0.3, { attack: 0.001, fall: [50, 0.08] }), click(3000, 0.15)] },
      { name: "Doppelt", parts: [...kick(150, 50, 0.07, 0.2, 0.9, [120, 0.12], [3000, 0.2]), tone("sine", 130, 0.6, 0.18, { attack: 0.001, fall: [48, 0.06], after: 0.07 })] },
      { name: "Knall", parts: kick(200, 50, 0.04, 0.15, 0.9, [150, 0.2], [3000, 0.3], noise([lp(2000)], 0.5, 0.08)), drive: 0.5 },
      { name: "Hüpfer", parts: [tone("sine", 60, 0.95, 0.2, { attack: 0.001, fall: [140, 0.1] }), click(2400, 0.1)] },
      { name: "Kessel", parts: kick(160, 55, 0.06, 0.28, 0.9, [130, 0.1], [3200, 0.2], tone("square", 311, 0.06, 0.25, { filter: hp(600) }), tone("square", 467, 0.05, 0.2, { filter: hp(900) })) },
    ],
  },
];
