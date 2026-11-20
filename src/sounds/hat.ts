import { bp, hp, lp, noise, pk, tone, type Drum, type FilterRow, type Part, type Palette } from "./shapes";

/*
 * The hi-hat's palette: noise through filters, mostly. What rings like metal
 * has a handful of square waves at uneven distances under it, the way drum
 * machines make their cymbals.
 */

/** One burst of noise: its filters, [level, decay], and an attack for what is shaken rather than struck. */
const hat = (filters: readonly FilterRow[], level: number, decay: number, attack = 0.001): Part[] => [noise(filters, level, decay, { attack })];

/** Six square waves at the uneven distances of a drum machine's cymbal, above `base` Hz and through `filter`. */
const metal = (base: number, level: number, decay: number, filter: FilterRow): Part[] =>
  [1, 1.4826, 1.8, 2.546, 2.63, 3.897].map((times) => tone("square", base * times, level, decay, { attack: 0.001, filter }));

export const HAT: Palette<Drum> = [
  {
    name: "Seide",
    sounds: [
      { name: "Seide", classic: 0 },
      { name: "Samt", parts: hat([hp(9000)], 0.4, 0.03) },
      { name: "Hauch", parts: hat([hp(10_500)], 0.32, 0.025, 0.002) },
      { name: "Tick", parts: hat([hp(8000)], 0.5, 0.015) },
      { name: "Fein", parts: hat([hp(6800), pk(12_000, 2, 6)], 0.34, 0.04) },
      { name: "Dünn", parts: hat([bp(9500, 1.5)], 0.9, 0.035) },
      { name: "Zart", parts: hat([hp(7000)], 0.36, 0.05, 0.004) },
      { name: "Spitze", parts: hat([hp(11_000), pk(13_000, 2, 6)], 0.4, 0.02) },
      { name: "Luft", parts: hat([hp(5000), lp(9000)], 0.5, 0.05) },
      { name: "Nadel", parts: hat([hp(12_000)], 0.5, 0.012) },
    ],
  },
  {
    name: "Blech",
    sounds: [
      { name: "Blech", classic: 1 },
      { name: "Maschine", parts: metal(205, 0.3, 0.05, hp(7000)) },
      { name: "Dose", parts: hat([bp(4200, 3), pk(6300, 4, 8)], 0.9, 0.05) },
      { name: "Topf", parts: metal(160, 0.3, 0.07, bp(5000, 1.2)) },
      { name: "Klirr", parts: hat([hp(6000), pk(9500, 8, 14), pk(12_500, 8, 10)], 0.22, 0.05) },
      { name: "Schelle", parts: metal(310, 0.3, 0.06, hp(8000)) },
      { name: "Sieb", parts: hat([hp(4500), pk(7200, 6, 10)], 0.24, 0.04) },
      { name: "Draht", parts: hat([bp(8000, 4)], 1.4, 0.04) },
      { name: "Münze", parts: [tone("sine", 6200, 0.1, 0.06, { attack: 0.001 }), tone("sine", 8700, 0.08, 0.05, { attack: 0.001 }), noise([hp(9000)], 0.2, 0.03)] },
      { name: "Rost", parts: hat([hp(3600), pk(5200, 4, 9)], 0.3, 0.06), drive: 0.4 },
    ],
  },
  {
    name: "Shaker",
    sounds: [
      { name: "Shaker", classic: 2 },
      { name: "Reis", parts: hat([bp(7500, 1)], 0.6, 0.04, 0.012) },
      { name: "Sand", parts: hat([bp(4500, 0.7)], 0.5, 0.06, 0.02) },
      { name: "Rassel", parts: [noise([bp(5500, 1.2)], 0.6, 0.05, { attack: 0.008 }), noise([bp(5500, 1.2)], 0.35, 0.04, { attack: 0.008, after: 0.03 })] },
      { name: "Maracas", parts: hat([hp(6500)], 0.45, 0.035, 0.006) },
      { name: "Kürbis", parts: hat([bp(8500, 2)], 0.9, 0.07, 0.02) },
      { name: "Streichholz", parts: hat([bp(3800, 1.5)], 0.8, 0.03, 0.01) },
      { name: "Bohnen", parts: hat([bp(3000, 0.9)], 0.6, 0.05, 0.012) },
      { name: "Schütteln", parts: [noise([bp(6500, 1)], 0.55, 0.04, { attack: 0.012 }), noise([bp(7000, 1)], 0.45, 0.04, { attack: 0.012, after: 0.05 })] },
      { name: "Kies", parts: hat([bp(2600, 0.6)], 0.55, 0.07, 0.015) },
    ],
  },
  {
    name: "Zisch",
    sounds: [
      { name: "Zisch", classic: 3 },
      { name: "Offen", parts: hat([hp(6500), pk(9000, 1.5, 5)], 0.3, 0.18) },
      { name: "Dampf", parts: hat([hp(3000)], 0.22, 0.2, 0.01) },
      { name: "Welle", parts: hat([hp(5000)], 0.26, 0.16, 0.03) },
      { name: "Spray", parts: hat([bp(7000, 0.6)], 0.4, 0.12, 0.004) },
      { name: "Gischt", parts: hat([hp(8500)], 0.28, 0.22) },
      { name: "Fauch", parts: hat([bp(4000, 0.5)], 0.4, 0.14, 0.008) },
      { name: "Sog", parts: hat([hp(6000)], 0.3, 0.08, 0.06) },
      { name: "Halb", parts: hat([hp(7000), pk(10_000, 2, 5)], 0.32, 0.1) },
      { name: "Regen", parts: hat([hp(9500), lp(14_000)], 0.4, 0.25) },
    ],
  },
  {
    name: "Becken",
    sounds: [
      { name: "Ride", parts: [...metal(340, 0.05, 0.5, hp(5000)), noise([hp(8000)], 0.12, 0.3)] },
      { name: "Kuppe", parts: [tone("sine", 1050, 0.12, 0.35, { attack: 0.001 }), tone("sine", 1580, 0.1, 0.3, { attack: 0.001 }), tone("sine", 2370, 0.07, 0.25, { attack: 0.001 }), noise([hp(7000)], 0.1, 0.1)] },
      { name: "Crash", parts: hat([hp(4200), pk(8000, 1.2, 6)], 0.3, 0.6) },
      { name: "China", parts: hat([hp(3000), pk(4700, 3, 9)], 0.3, 0.4), drive: 0.4 },
      { name: "Splash", parts: hat([hp(6000)], 0.3, 0.3) },
      { name: "Tamburin", parts: [...metal(520, 0.06, 0.09, hp(9000)), noise([hp(8000)], 0.25, 0.07)] },
      { name: "Triangel", parts: [tone("sine", 4186, 0.14, 0.5, { attack: 0.001 }), tone("sine", 5274, 0.1, 0.45, { attack: 0.001 }), noise([hp(9000)], 0.1, 0.01, { tight: true })] },
      { name: "Schellen", parts: [...metal(480, 0.05, 0.07, hp(8500)), noise([hp(9000)], 0.2, 0.06, { attack: 0.01, after: 0.04 })] },
      { name: "Zimbel", parts: [tone("sine", 3100, 0.12, 0.8, { attack: 0.001 }), tone("sine", 3160, 0.12, 0.8, { attack: 0.001 }), noise([hp(10_000)], 0.08, 0.02, { tight: true })] },
      { name: "Blatt", parts: metal(120, 0.09, 0.5, bp(3000, 0.7)) },
    ],
  },
];
