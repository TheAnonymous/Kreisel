import { bp, hp, lp, noise, tone, type Drum, type Part, type Palette } from "./shapes";

/*
 * The tuned drum's palette: skins, hands on skins, metal, wood, and things
 * that are none of these. Every tone is a multiple of the note the ring
 * plays (which follows the key), so all of them stay in tune.
 */

/** A skin: a sine at `times` the note that falls to `to` within `seconds`, [level, decay], and the slap of the hand or stick as [Hz, level]. */
const skin = (times: number, fall: readonly [to: number, seconds: number], level: number, decay: number, slap: readonly [hz: number, level: number], ...more: Part[]): Part[] => [
  tone("sine", times, level, decay, { attack: 0.002, fall }),
  noise([bp(slap[0], 1)], slap[1], 0.012, { attack: 0.0005, tight: true }),
  ...more,
];

/** Metal: square waves at uneven multiples of the note through a band around `band` times the note. */
const bell = (partials: readonly number[], band: number, level: number, decay: number): Part[] => partials.map((times) => tone("square", times, level, decay, { attack: 0.001, filter: bp(band, 1.6) }));

/** Something that rings purely: sines at these multiples, each a little quieter and shorter than the one before. */
const chime = (partials: readonly number[], level: number, decay: number): Part[] => partials.map((times, index) => tone("sine", times, level / (1 + index * 0.6), decay / (1 + index * 0.35), { attack: 0.001 }));

/** Wood: a short triangle and a shorter sine above it. */
const wood = (times: number, level: number, decay: number, over: readonly [times: number, level: number]): Part[] => [
  tone("triangle", times, level, decay, { attack: 0.0005 }),
  tone("sine", over[0], over[1], decay * 0.45, { attack: 0.0005 }),
];

export const PERC: Palette<Drum> = [
  {
    name: "Tom",
    sounds: [
      { name: "Tom", classic: 0 },
      { name: "Standtom", parts: skin(0.75, [0.5, 0.16], 0.85, 0.36, [1600, 0.12]) },
      { name: "Hängetom", parts: skin(1.5, [1.05, 0.12], 0.75, 0.22, [2400, 0.12]) },
      { name: "Pauke", parts: skin(1, [0.95, 0.2], 0.8, 0.6, [1200, 0.1], tone("sine", 1.5, 0.2, 0.4), tone("sine", 2, 0.1, 0.3)) },
      { name: "Taiko", parts: skin(0.6, [0.45, 0.08], 0.9, 0.4, [900, 0.2], noise([lp(800)], 0.3, 0.03, { tight: true })), drive: 0.2 },
      { name: "Elektro-Tom", parts: skin(2, [0.7, 0.18], 0.8, 0.3, [3000, 0.08]) },
      { name: "Kessel", parts: [tone("triangle", 1, 0.8, 0.3, { attack: 0.002, fall: [0.7, 0.1] }), noise([bp(1800, 1)], 0.15, 0.012, { tight: true })] },
      { name: "Rototom", parts: skin(2.5, [2, 0.05], 0.7, 0.18, [3200, 0.15]) },
      { name: "Fell", parts: skin(1, [0.8, 0.03], 0.8, 0.12, [1200, 0.3]) },
      { name: "Basstom", parts: skin(0.5, [0.36, 0.2], 0.9, 0.5, [1000, 0.1]) },
    ],
  },
  {
    name: "Conga",
    sounds: [
      { name: "Conga", classic: 1 },
      { name: "Bongo", parts: skin(3, [2.7, 0.02], 0.7, 0.1, [3200, 0.2]) },
      { name: "Bongo tief", parts: skin(2.4, [2.1, 0.02], 0.7, 0.12, [2800, 0.2]) },
      { name: "Djembe", parts: skin(1.3, [1.1, 0.03], 0.8, 0.2, [1800, 0.35]) },
      { name: "Klaps", parts: skin(2.6, [2.4, 0.02], 0.5, 0.05, [4000, 0.6]) },
      { name: "Tabla", parts: skin(2, [2.25, 0.12], 0.7, 0.3, [2600, 0.15], tone("sine", 4, 0.15, 0.15)) },
      { name: "Udu", parts: skin(1, [1.5, 0.09], 0.8, 0.2, [1400, 0.1]) },
      { name: "Cajón", parts: skin(1.1, [0.8, 0.04], 0.8, 0.14, [2400, 0.3], noise([bp(2400, 0.7)], 0.25, 0.05)) },
      { name: "Darbuka", parts: skin(3.4, [3.1, 0.02], 0.7, 0.07, [5000, 0.25]) },
      { name: "Hand", parts: skin(1.8, [1.6, 0.02], 0.6, 0.09, [1500, 0.3], noise([lp(1500)], 0.2, 0.03, { tight: true })) },
    ],
  },
  {
    name: "Kuhglocke",
    sounds: [
      { name: "Kuhglocke", classic: 2 },
      { name: "Agogo", parts: bell([6, 8.9], 7.5, 0.4, 0.18) },
      { name: "Agogo tief", parts: bell([4.5, 6.7], 5.6, 0.4, 0.2) },
      { name: "Glöckchen", parts: chime([12, 17.9], 0.3, 0.35) },
      { name: "Amboss", parts: bell([3, 4.75, 7.1], 5, 0.36, 0.3), drive: 0.3 },
      { name: "Triangel", parts: chime([16, 21.3], 0.25, 0.6) },
      { name: "Becher", parts: chime([9, 14.2, 20.7], 0.25, 0.3) },
      { name: "Rohr", parts: chime([4, 8.03, 11.9], 0.3, 0.7) },
      { name: "Topfdeckel", parts: bell([5, 7.03, 9.6], 8, 0.3, 0.4) },
      { name: "Kling", parts: chime([20, 30], 0.3, 0.15) },
    ],
  },
  {
    name: "Holz",
    sounds: [
      { name: "Holz", classic: 3 },
      { name: "Clave", parts: [tone("sine", 22.7, 0.6, 0.05, { attack: 0.0005 }), noise([bp(2500, 2)], 0.2, 0.006, { tight: true })] },
      { name: "Block", parts: wood(6, 0.6, 0.06, [9.1, 0.3]) },
      { name: "Block hoch", parts: wood(10, 0.6, 0.05, [15.2, 0.3]) },
      { name: "Marimba", parts: [tone("sine", 4, 0.7, 0.25, { attack: 0.001 }), tone("sine", 16, 0.15, 0.03, { attack: 0.0005 })] },
      { name: "Xylophon", parts: wood(8, 0.6, 0.12, [24, 0.15]) },
      { name: "Kokosnuss", parts: [tone("sine", 5.5, 0.6, 0.05, { attack: 0.0005, fall: [5, 0.03] }), noise([bp(1800, 2)], 0.3, 0.01, { tight: true })] },
      { name: "Stäbchen", parts: [...wood(14, 0.5, 0.025, [21, 0.2]), noise([hp(5000)], 0.2, 0.008, { tight: true })] },
      { name: "Kalimba", parts: [tone("sine", 4, 0.6, 0.4, { attack: 0.001 }), tone("sine", 21.6, 0.2, 0.06, { attack: 0.0005 }), noise([bp(3000, 2)], 0.1, 0.006, { tight: true })] },
      { name: "Bambus", parts: wood(3, 0.6, 0.09, [8.3, 0.2]) },
    ],
  },
  {
    name: "Fremd",
    sounds: [
      { name: "Tropfen", parts: [tone("sine", 8, 0.5, 0.08, { attack: 0.001, fall: [14, 0.05] })] },
      { name: "Zapp", parts: [tone("sine", 20, 0.6, 0.1, { attack: 0.001, fall: [2, 0.08] })] },
      { name: "Blip", parts: [tone("square", 8, 0.4, 0.05, { attack: 0.001, filter: lp(24) })] },
      { name: "Brumm", parts: [tone("sawtooth", 1, 0.6, 0.2, { attack: 0.002, filter: lp(6, 2) })] },
      { name: "Pieps", parts: [tone("sine", 32, 0.4, 0.06, { attack: 0.001 })] },
      { name: "Boing", parts: [tone("sine", 1.5, 0.7, 0.12, { attack: 0.002, fall: [3, 0.06] })] },
      { name: "Feder", parts: [tone("sine", 4, 0.4, 0.4, { attack: 0.001 }), tone("sine", 4.12, 0.4, 0.4, { attack: 0.001 })] },
      { name: "Stahlfass", parts: chime([4, 8, 12.1], 0.45, 0.5) },
      { name: "Glas", parts: [tone("sine", 14, 0.3, 0.5, { attack: 0.001 }), tone("sine", 14.3, 0.3, 0.5, { attack: 0.001 })] },
      { name: "Knacks", parts: [noise([bp(3000, 4)], 2.5, 0.01, { attack: 0.0005, tight: true }), tone("sine", 6, 0.3, 0.02, { attack: 0.0005 })] },
    ],
  },
];
