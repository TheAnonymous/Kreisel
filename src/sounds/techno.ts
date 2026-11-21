/*
 * The techno group: for every ring, the ten of its fifty sounds that hard
 * techno and acid techno reach for first. A pick is a place on the palette
 * (family, place), not a sound of its own: it has the number of the sound it
 * points at. So nothing here travels in a link, and this list can change
 * without any Kreisel sounding different.
 *
 * What the lists go by is what the genre's own guides ask of each
 * instrument: a hard, driven kick; layered claps and a noise snare with
 * overdrive; metallic machine hats, an open hat, ride and crash; a low driven
 * tom, metal and a zap; squelching and distorted basses over a sub; stabs of
 * detuned saws; and leads that scream.
 */

export type Pick = readonly [family: number, place: number];

export const TECHNO: readonly (readonly Pick[])[] = [
  // Kick. Hart, Punch, Faust, Nagel, Hammer, Stahl, Rammbock; two long, low ones (Lang, Grollen); Knall.
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 7], [1, 8], [2, 2], [2, 4], [4, 7]],
  // Snare. Claps, single and layered (Klatsch, Menge, Applaus, Disco, Eng); a machine's snare; driven noise (Schrot, Peng, Stein); Rauschen.
  [[1, 0], [1, 3], [1, 9], [1, 6], [1, 2], [4, 1], [4, 2], [0, 8], [4, 8], [4, 5]],
  // Hi-hat. Metal (Maschine, Blech, Schelle, Rost); open ones (Offen, Zisch); Shaker; Ride, Crash, China.
  [[1, 1], [1, 0], [1, 5], [1, 9], [3, 1], [3, 0], [2, 0], [4, 0], [4, 2], [4, 3]],
  // Tuned drum. Toms from the classic one down (Tom, Standtom, Basstom, Taiko, Elektro-Tom); metal (Amboss, Topfdeckel, Stahlfass); Zapp, Brumm.
  [[0, 0], [0, 1], [0, 9], [0, 4], [0, 5], [2, 4], [2, 8], [4, 7], [4, 1], [4, 3]],
  // Bass. The squelching kind (Acid, Kantig, Zwitscher, Gift, Schnapp, Gurgel); driven saws (Knurr, Fuzz); Sub, Dunkel.
  [[2, 0], [2, 1], [2, 2], [2, 4], [2, 6], [2, 8], [1, 3], [1, 7], [0, 0], [0, 7]],
  // Chords. Stabs (Stab, Rave, House, Dub, Kurz, Hupe, Knack); wide saws (Breit, Schweif); a driven organ (Rock).
  [[1, 0], [1, 3], [1, 1], [1, 7], [1, 6], [1, 4], [1, 8], [0, 3], [0, 6], [3, 6]],
  // Melody. Schrei, Säge, Sync, Trance, Breit, Quinte, Gleiter; Sirene, Roboter, Quadrat.
  [[3, 4], [3, 0], [3, 2], [3, 3], [3, 1], [3, 8], [3, 7], [4, 9], [4, 7], [4, 0]],
];
