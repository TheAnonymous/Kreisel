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
  hi-hat), a stroke with the right button always erases. Five tools decide
  what a click means: set, accent, chance, roll, length.
- **The right button knows the place.** A right click opens a menu for what
  is under the pointer: a hit (accent, chance, roll, length, pitch), a ring
  (dice, turn, length, sound, mute, copy and paste its pattern), a bar of the
  piece (play from here, lay a scene, tension), a chord field (chord, double
  or remove the bar), a scene (copy, clear) and the hub. The rows that change
  a value keep the menu open, and it redraws as the Kreisel changes. A right
  click on an effect latches it, on a control puts it back to its factory
  value. A finger that rests on a ring gets the same menu, and so does the
  menu key at the keyboard's cursor.
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
  renders a file faster than real time. Both are saved as Opus: the browser's
  own encoder (WebCodecs) makes the packets, `src/ogg.ts` wraps them into an
  Ogg file any player knows, a tenth the size of a WAV. A browser without
  the encoder still gets a WAV.

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
dozen bytes a stroke), are rendered into the saved file and can be undone.

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
(`src/piece.ts`), the same live and in the saved file, which holds the piece once
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

## Part five: Klangkörper

The built-in sounds and the painted ones are synthesizer sounds. A
Klangkörper is a *thing* that rings: a skin, a string, a bar, a tube or a
bowl, built on a workbench ("Bauen" in the ring's panel).

- **Knock on it.** The body is drawn as what it is. A click strikes it where
  the pointer is, and that place is where the ring strikes it from then on:
  the middle of a skin is round and deep, its rim full of overtones; a string
  touched in its middle loses every second overtone.
- **Shape it by pulling.** The grip on its right makes it bigger (lower and
  longer on rings without notes, fuller on rings that play them), the one on
  its left tightens it (brighter and shorter). A slider runs from wood over
  metal to glass: how long it rings, and how fast its overtones die.
- **What sets it going.** A soft or a hard mallet, a plucking finger, a bow,
  breath (on the top row of keys). Bowed and blown, a body sounds for as long
  as the note lasts.
- **It moves.** While it sounds it is seen to: rings run over the skin, the
  string swings widest where it was touched, the bowl's rim goes oval.

A body is not a recording. It is a list of the ways it can vibrate
(`src/body.ts`): a round skin's modes from the zeros of the Bessel functions,
a string's whole-number overtones (a little sharp where it is stiff), a free
bar's 1 : 2.76 : 5.4 …, a stopped tube's odd overtones, a bowl's few modes in
beating pairs. Where it is struck decides how strongly each mode starts, the
material how each dies. The sound is worked out once as samples and kept per
half octave (`src/audio/body.ts`); a ring has one body, so a new hit takes
over from the one still ringing. A body is six small numbers in the link.

## Part six: Nachbeben

The rumble under the kick, as hard techno and acid techno have it. The usual
way to build one is a chain: reverb, equaliser, distortion, sidechain. Here
it is one line painted into the kick's ring.

- **It comes from your kick.** Every kick, whatever its sound, also goes down
  into a cellar: a long dark room and a row of echoes a sixteenth apart. What
  comes back is the rumble, so it always suits the kick it came from.
- **You paint where the ground shakes.** On the kick's ring the tool that
  holds notes elsewhere (a drum has none to hold) paints the Nachbeben: one
  stroke around the ring, far out is a lot, the inner edge is nothing; the
  right button erases. It is drawn as a dark mass in the ring that trembles
  where the Kreisel is.
- **The kick punches through by itself.** Every kick pushes the Nachbeben
  away for a moment (starting a few milliseconds early), so the kick is
  always heard alone and the pumping comes for free.
- **In key.** The loudness of what comes back from the cellar moves a deep
  tone with it: the root of the bar's chord, brought down to between 38 and
  76 Hz, with its octave for small speakers. Bar by bar the ground shakes at
  the pitch of the chord, like a sub bass line the kick plays by itself.
- **Character.** "Dreck" drives it from deep and clean into a growl,
  "Rollen" breaks the swell into sixteenths. Dice lay the usual shapes
  around the kicks that are there: off-beat swell, rolling, tail.

The line is a number from 0 to 15 for each step of the kick's ring, kept
with the scene (one hex digit a step in the link); the character is two
numbers for the whole Kreisel. The shapes and the pitch are plain arithmetic
(`src/rumble.ts`), the sound is a small graph of its own beside the rings'
buses (`src/audio/rumble.ts`): convolver, echoes, an envelope follower made
from a wave shaper and two slow filters that drives two sine oscillators, a
shaper for the growl, and three gains for the line, the roll and the kick's
push. It is the same live and in the saved file.

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
