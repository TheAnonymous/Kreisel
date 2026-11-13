# Kreisel

A groovebox in a circle, for the browser. Part of the
[Musik-Werkstatt](https://musik.jodie-oesterling.de/); it lives at
`/Kreisel/`.

Every instrument is a ring, one turn of the ring is its pattern. Step 1 is at
twelve o'clock and time runs clockwise. You paint hits straight into the
rings, turn a ring with the mouse wheel, and pull a step outwards to make it
sound higher. Rings may have different lengths (2 to 32 steps), so they drift
against each other and the groove keeps moving.

## The idea

A groovebox on a web page has a mouse, a wheel, a keyboard and a big canvas,
and no knobs. So Kreisel has no knobs either:

- **One surface.** All seven rings (kick, snare, hi-hat, tuned drum, bass,
  chords, melody) are on the wheel at once. The ring in focus grows wider;
  the others stay where they are, so the hand learns the places.
- **Paint, don't program.** A click sets or removes a hit, a stroke along the
  ring paints or erases, a pull outwards bends the pitch (or opens the
  hi-hat), the right button always erases. Five tools decide what a click
  means: set, accent, chance, roll, length.
- **Always in key.** Rings store scale steps. The bass follows the chord of
  the bar (the fields around the hub), the chords are voiced close together,
  and changing key or scale re-tunes everything.
- **Happy accidents.** Dice give a ring a new idea in the manner of its
  instrument, "Variieren" changes it only a little, "Verteilen" spreads hits
  evenly (Euclidean rhythms), and undo takes any of it back.
- **From loop to piece.** Eight scenes; an empty one becomes a copy of the
  current one when clicked. Scenes change on the bar line, and the chain
  plays them one after another.
- **Play it.** The bottom row of the keyboard holds five effects (lowpass,
  highpass, stutter, echo throw, pause with a crash on release), the home row
  plays the ring in focus, and "Einspielen" writes what is played into the
  turning ring.
- **The web's own tricks.** The whole Kreisel fits in a link (no upload: the
  link *is* the project), it starts offline, records what is heard and
  renders a WAV faster than real time.

## Build

Sound comes from [Klangwerk](https://github.com/TheAnonymous/Klangwerk), the
Musik-Werkstatt's shared Web Audio engine; there is no UI framework, the wheel
is one canvas.

```sh
npm install
npm run dev      # http://localhost:5173/Kreisel/
npm run verify   # lint, types, unit tests, build, browser tests under the production CSP
```

The toolchain is pinned in `mise.toml` (Node 24.15.0, npm 12.0.0). All checks
run locally; see [AGENTS.md](AGENTS.md).

| Where | What |
| --- | --- |
| `src/model.ts`, `src/music.ts` | the project as plain data; scales, chords and where each ring's notes sit |
| `src/patterns.ts` | turning, spreading, dice and small variations (pure, seeded) |
| `src/codec.ts`, `src/store.ts` | the project as a link and in the browser's storage; undo |
| `src/audio/` | the 28 sounds, the mixer, the player (live and offline), effects, recording |
| `src/ui/ring.ts` | the wheel: drawing and every gesture on it |
| `src/ui/panels.ts`, `src/ui/keys.ts` | everything around the wheel; the keyboard |
| `e2e/` | browser tests against the built app: laptop and phone in Chromium, the laptop again in Firefox |

## License

MIT. Klangwerk is MIT as well.
