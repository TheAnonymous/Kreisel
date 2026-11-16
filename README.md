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

## Part two: Klangmalerei

Every ring has four built-in sounds and one of its own, and that one is
painted. "Malen" opens the paint box on top of the turning wheel:

- **The picture is the sound.** Time runs from left to right, pitch from
  bottom to top (nine octaves). Every stroke of the brush is one tone.
- **The brush runs dry.** A stroke is loudest where the brush was set down
  and fades as the paint runs out, so a stroke painted from left to right
  decays and one painted from right to left swells. Brush size is loudness.
  No envelope, no knobs.
- **Three brushes, named by ear:** Summen (a sine), Sägen (a sawtooth, drawn
  as a zigzag) and Zischen (noise around that pitch, drawn as a spray). The
  right button, or the eraser, takes a stroke away.
- **In tune by itself.** Rings that play notes show their root and its
  overtones as lines; tones painted near a line stick to it, and the whole
  picture moves to every note the ring plays. "Ton halten" adds a line where a
  long note stands still until it ends.
- **Vormachen.** Hum, knock or hiss into the microphone and the paint box
  paints what it heard: pitch and noise are followed a few dozen times a
  second and become strokes that can be repainted like any others. Nothing is
  recorded or leaves the device.
- **Dice and a shelf.** Dice paint a first picture in the manner of the ring;
  "Merken" puts a picture on a shelf that outlives the project, so a kick's
  picture can become a bass in next week's Kreisel.

The Kreisel keeps playing while you paint, so every stroke is heard in the
groove. Pictures are part of the project: they travel in the link (a few
dozen bytes a stroke), are rendered into the WAV and can be undone.

## Part three: the piece

The outermost ring is the whole piece: one turn of it is as many bars as the
piece is long (4 to 128). Only one thing is painted into it, the tension:
far out means a lot is going on, far in means little. The Kreisel arranges by
that line, bar by bar:

- **Who plays.** The rings come in one after another as the tension rises,
  in an order the piece keeps ("Wer zuerst einsetzt"). Each bar is drawn as
  the stack of the rings that play in it, so the ring shows who plays when.
- **How firmly.** A ring that has only just come in plays a little quieter
  and leaves its quiet steps out.
- **How open.** The master lowpass follows the line: dull when little is
  going on, open from about two thirds up, opening through a bar towards a
  higher one.
- **Run-ups and landings.** Before a steep rise the Kreisel takes a run-up of
  rising noise and lands with a crash; before a steep fall the last beat is
  thrown into the echo.
- **Scenes.** The inner edge of the ring holds the scenes: pick one on the
  left and paint it there.

The right button sends a playing piece to a bar, the wheel turns it, dice
give it the form of a track (climb, perhaps a break, a peak, a fade), and
"Glätten" rounds the line off. The rules are plain arithmetic on the line
(`src/piece.ts`), the same live and in the WAV, which holds the piece once
round. A piece is one byte a bar in the link.

## Part four: Reihum

A Kreisel already fits in a link. "Reihum" makes that a game for several,
with no account and no server: you build a turn and pass the link on, the next
person builds on and passes it back or to a third.

- **Every turn stays.** The link carries the Kreisel as it was after each
  turn, with the name of who took it. The turns show as rings in the hub, like
  a tree's, each in its person's colour; the Reihum window lists them.
- **Looking back.** Any turn can be listened to again: the wheel shows and
  plays the Kreisel as it was then, and nothing can be changed. From there one
  can return to now, or go on building from that turn (the later turns are
  dropped; undo brings them back).
- **Rules.** The first person picks one: anything goes; one ring a turn (the
  window says which rings the turn has touched and refuses a second); or
  *Stille Post*, where a turn is one ring and one hears only the ring of the
  person before. Rings built earlier are under a cloth, out of sight, hearing
  and reach, until someone reveals the round.

A turn's state is the packed project without its own history
(`packState`), and the whole link is deflated at once, so a turn costs about a
hundred characters: twelve turns (the most a round keeps) stay under 2500.
What a turn touched is worked out from two packed states (`src/relay.ts`):
a ring's settings and its patterns, where copying a scene touches nothing.
Whatever a link claims is unpacked and packed again turn by turn; a turn
that is no Kreisel is left out, and a turn never has turns of its own.

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
| `src/bild.ts`, `src/imitate.ts` | painted sounds: strokes, guide lines, dice; what the microphone heard as strokes |
| `src/collection.ts` | the shelf of kept pictures |
| `src/piece.ts` | the piece: what a bar's tension asks for, and shaping the line |
| `src/relay.ts` | Reihum: what a turn touched, people's colours, names |
| `src/audio/` | the 28 built-in sounds, painted sounds (`bild.ts`), listening (`listen.ts`), the mixer, the player (live and offline), effects, recording |
| `src/ui/ring.ts` | the wheel: drawing and every gesture on it |
| `src/ui/easel.ts` | the paint box: drawing pictures and painting them |
| `src/ui/panels.ts`, `src/ui/keys.ts` | everything around the wheel; the keyboard |
| `e2e/` | browser tests against the built app: laptop and phone in Chromium, the laptop again in Firefox |

## License

MIT. Klangwerk is MIT as well.
