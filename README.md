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
  or remove the bar), a scene (copy, lay into the row, clear), a round of the
  row (play from here, once more, another scene, earlier or later, take out)
  and the hub. The rows that change
  a value keep the menu open, and it redraws as the Kreisel changes. A right
  click on an effect latches it, on a control puts it back to its factory
  value. A finger that rests on a ring gets the same menu, and so does the
  menu key at the keyboard's cursor.
- **Everything has its place in the bar.** There is no drawer for what is
  left over. The Kreisel's name opens what concerns the Kreisel as a whole
  (start anew: empty, techno, the Werks-Kreisel; the style of the dice; back
  to the workshop). The speaker holds the two controls for everything
  together, volume and Druck. "Teilen" gives the Kreisel away, as a link or
  Reihum, and says so while a round is going. The arrow at "Aufnehmen" saves
  a file. The question mark is the help and the tour. Stage and light show
  are two buttons at the wheel. All of them are the menu of the right button
  hung under a button (`src/ui/bar-menus.ts`). A phone's bar has no room for
  that: there three dots open one sheet with the same groups under their
  names.
- **Always in key.** Rings store scale steps. The bass follows the chord of
  the bar (the fields around the hub), the chords are voiced close together,
  and changing key or scale re-tunes everything.
- **Happy accidents.** Dice give a ring a new idea in the manner of its
  instrument, "Variieren" changes it only a little, "Verteilen" spreads hits
  evenly (Euclidean rhythms), and undo takes any of it back.
- **From loop to piece.** Eight scenes, each shown as a small wheel; an empty
  one becomes a copy of the current one when clicked. Scenes change on the
  bar line, and the row ("Folge") under the wheel plays them in the order
  they were laid (see "Scenes and the row").
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

Every ring has its ready-made sounds (fifty of them by now, see "Fifty
sounds a ring") and one of its own, and that one is painted. "Malen" opens
the paint box on top of the turning wheel:

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
piece is long (4 to 256). Only one thing is painted into it, the tension:
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
way to build one is a chain: the kick is driven, a copy of it goes through a
delay and a reverb, that is driven again and then low-passed, ducked under
the kick, and both leave through one group. Here the chain is wired that way
inside, and what you do is paint one line into the kick's ring.

- **The kick can be hard.** "Härte" drives the kick itself into a clipper
  before anything else hears it: its tail is pressed up into a body that
  stands, and what the drive adds up high is taken off again after it. At
  nothing the kick passes untouched; at full it is some 5 dB louder on
  average at a lower peak.
- **The kick is in key.** Its body lands on the key's root or on its fifth,
  whichever is nearer to where the sound and the pad put it (never more than
  three and a half semitones away); the pad still moves where the fall
  starts. A step's own tuning moves it from there.
- **It comes from your kick.** Every kick, whatever its sound and as hard as
  it has been driven, also goes down into a cellar: a long dark room and a
  row of echoes a sixteenth apart. What comes back is driven until it growls
  and only then darkened (24 dB an octave, from 90 Hz to 700 Hz with
  "Dreck"), so it always suits the kick it came from.
- **You paint where the ground shakes.** On the kick's ring the tool that
  holds notes elsewhere (a drum has none to hold) paints the Nachbeben: one
  stroke around the ring, far out is a lot, the inner edge is nothing; the
  right button erases. It is drawn as a dark mass in the ring that trembles
  where the Kreisel is.
- **The kick punches through by itself.** Every kick pushes the Nachbeben
  away for a moment (starting a few milliseconds early), so the kick is
  always heard alone and the pumping comes for free.
- **In key.** Under the growl lies a deep tone that moves with its
  loudness: the root of the bar's chord, brought down to between 38 and
  76 Hz, with a little of its octave for small speakers. Bar by bar the
  ground shakes at the pitch of the chord, like a sub bass line the kick
  plays by itself.
- **One thing.** Where a scene shakes, the kick's bus and the Nachbeben
  leave for the mix through one soft clipper, the more the dirtier: the kick
  pushes the rumble down for the moment it is there. A kick without a
  Nachbeben does not pass through it.
- **Character.** "Dreck" drives it from deep and clean into a growl,
  "Rollen" breaks the swell into sixteenths. Dice lay the usual shapes
  around the kicks that are there: off-beat swell, rolling, tail.

The line is a number from 0 to 15 for each step of the kick's ring, kept
with the scene (one hex digit a step in the link); the character is two
numbers for the whole Kreisel, and the kick's hardness a third (left out of
the link where the kick is clean, so an older link has a clean kick). The
shapes and the pitches are plain arithmetic (`src/rumble.ts`, `src/kick.ts`).
The sound is two small graphs beside the rings' buses: the kick's clipper
and the group (`src/audio/kick.ts`, wave shapers without oversampling, so
the driven kick is not late against the clean one), and the Nachbeben
(`src/audio/rumble.ts`): convolver, echoes, a shaper for the growl, two
low-passes and a high-pass, an envelope follower made from a wave shaper and
two slow filters that drives two sine oscillators, and three gains for the
line, the roll and the kick's push. It is the same live and in the saved
file.

## Part seven: Wetter

Effects and their automation, as weather painted onto the wheel. The wheel
has two directions a straight sequencer lacks: how far out a place is says
which instrument, its angle says when. So one brush stroke across several
rings says "these instruments, in this part of their round".

- **Six kinds.** Fog makes what lies under it duller, sun brighter, clouds
  send it into the hall, rain into the echo, sparks drive it, hail chops it.
  "Wetter" is chosen like a ring (it heads the list); then the tools are the
  six kinds, a stroke on the wheel paints, going over it again makes it
  stronger, the right button takes it away, the mouse wheel makes the brush
  wider.
- **Wind is the automation.** Every kind of weather has a wind: a quarter
  step to four steps a bar, with or against the clock. The weather then
  drifts around the wheel and the sound changes over many bars, with no
  curve drawn and no knob recorded. Rings of different lengths carry the
  same patch round at their own pace.
- **Into the sound.** On the rings whose sound has a brightness of its own
  (hi-hat, bass, chords, melody), sun and fog also move that, note by note:
  the filter ride of an acid line, painted.
- **Effects leave weather.** With "Einspielen" on, holding the dull, echo or
  stutter key leaves fog, rain or hail where the Kreisel is, over every ring.

Weather is a number from 0 to 15 for each kind, ring and step, kept with
the scene (in the link: one entry for each ring a kind lies on, a hex digit
a step), plus six winds. The rules are plain arithmetic (`src/weather.ts`);
the sound is a short chain before each ring's bus and two sends after it
(`src/audio/weather.ts`), which the player sets step by step. Under a clear
sky the chain changes nothing.

## Part eight: Stimme

A ring that sings. Type a line and the ring sings it, one syllable a hit, at
the ring's own pitch: the bass sings low, the melody its melody, the chord
ring is a small choir, a drum speaks. Nothing is recorded and nothing is
looked up: the voice is made on the spot from the letters.

- **A line, cut into syllables.** "Stimme geben" (or "Text", or the right
  button on a ring) opens a small window with one field. What is typed is cut
  as German is written ("Kaf·fee·pau·se jetzt"); a hyphen cuts where the
  rules get it wrong. Every hit of the ring sings the next syllable, so a
  line of five syllables on a ring of four hits walks around the beat.
  Enter sings the line once, a click on a syllable sings that one.
- **The sound pad is the mouth.** For a voice the pad shows i, e, a, o and u
  where a vowel chart has them. In the middle every vowel is itself; the
  further out the point, the more all of them are pulled to that place, and
  at the edge the ring sings one vowel only. "Mundraum" makes the mouth small
  and bright or big and dark, "Hauch" gives the voice breath.
- **A mouth in the hub.** While a voice sounds, the hub of the wheel is a
  mouth that forms what is sung: wide open for an a, a smile for an i, a
  small round hole for an u.

It is a robot choir, not a speaker: vowels are clear, words are understood
about as well as on an old vocoder record. A voice is two numbers and a
line of text in the link. The rules are plain arithmetic (`src/voice.ts`):
syllables, a handful of rules of German speech (a short and a long vowel,
the murmured e of an ending, "st" at the start of a word, "ch" after a dark
vowel), each vowel as three resonances, and a syllable laid out in time so
that its vowel lands on the beat and the consonants before it come ahead of
the beat. The sound (`src/audio/voice.ts`) is a buzz at the note's pitch
through three band filters that move from sound to sound, with noise through
a filter of its own for every hiss and pop. It is the same live and in the
saved file.

## Motion

Kreisel is a tin toy on a paper table, and it moves like one: what appears hops into place with a little
overshoot, what goes shrinks away quickly, what is pressed gives way, what is chosen clicks in. Nothing
floats, and nothing takes longer than about a quarter of a second.

- On the wheel (`src/ui/ring.ts`, rules and curves in `src/ui/motion.ts`): a hit that is set hops in, one
  that is taken shrinks away, one whose accent, chance or roll changes swells once. A ring that is turned
  slides into its new place. A new pattern (dice, another scene, a Kreisel from a link, the first look) is
  dealt around the ring, hit by hit. A muted ring fades to grey. At a start or a stop the hub gives way like
  a pressed button and its sign is stamped in anew; the runner grows out of the middle and fades where it
  stood. The bar that plays lights up in the middle, and the mark at the top hops on the one.
- Around it, answers to what was done are played by the page (`src/ui/answers.ts`, with the Web Animations
  API): dice tumble, the arrows of undo and redo wind back and on (also when a key did it), a button
  lights up in the ring's colour, a chosen scene, sound or tool clicks in, numbers tick, the name of the
  ring in focus arrives, the frame of the keyboard's focus lands.
- What goes with a state or with something appearing is in the style sheet (`src/styles/motion.css`): buttons stand
  higher under the pointer, menus unfold, messages come up, windows fade in, the lamp of every ring in the
  list jumps when the ring strikes, a held effect shows on its key what it does, the point on the sound
  pad glides, and the mark in the bar wobbles while the Kreisel plays.

Two rules keep it out of the way. Boxes that a pointer is aimed at (the wheel, the sound pad, the paint
box, the windows around them) never move; only what lies in them does. And whoever asked the system for
less motion (`prefers-reduced-motion`) gets none of it.

## Light, stage and first steps

Easier to get into, and more to look at.

- **The light show** (`src/ui/lights.ts`, drawn from `src/ui/ring.ts`). While the Kreisel plays, every hit
  throws a soft glow in its ring's colour onto the table, an accented hit throws sparks, the kick sends a
  wave out through the rings, and the runner draws a wake. The glow is painted on a small canvas of its
  own under the wheel (128 pixels, stretched, which blurs it for free) and repainted from the list of
  living glows every frame. It changes nothing that is heard, it can be switched off (the lamp in the
  corner beside the wheel, kept in the browser), and with `prefers-reduced-motion` it is never shown.
- **The wheel is a thing**: a hard shadow under it and a line around it like every tin part of the page,
  light from the upper left on all that lies on it, and a hub that is a domed knob. Until the Kreisel has
  played once, a ring around the hub beckons to the start (six times, then it lets be).
- **The stage** (the button in the corner beside the wheel, or the key O): only the wheel,
  larger, on a dark table whatever the colour scheme, with the tools and the held effects still at hand
  and the glow stronger. Escape or the button leads back; a window that opens takes the Kreisel off it.
- **The tour** (`src/ui/tour.ts`) replaces the single hint of the first visit: a light falls on one part
  of the page after the other and a card says in two sentences what it is for. Nothing is locked while
  it runs, and a step that asks for something to be tried (start, set a hit, pick a ring) goes on by
  itself once it was done. It comes once and again from the question mark in the bar.
- **Easier to read**: the smallest writing is a little larger, the keyboard's focus frame is drawn in ink
  (a ring's colour can be too pale on paper), and `prefers-contrast: more` gets stronger lines and
  writing and no glow.

## Fifty sounds a ring

Each ring has a palette of fifty ready-made sounds, in five families of ten: for the kick "Rund", "Hart",
"Tief", "Staub" and "Schräg", for the melody plucked strings, bells, pipes, saws and the square waves of
old game consoles. That makes 350.

- **Where they are**: in the ring's panel the sound's name stands between two arrows that leaf through
  the palette (keys U and I). A click on the name (key P) opens the palette beside the panel: every sound
  is one click away and is heard at once, and the palette stays open while sounds are tried, also when
  another ring is picked. "Würfeln", or the right button on the name, takes any of the fifty. The ring's
  right-click menu leafs as well.
- **The four each ring always had** lead the first four families and keep their numbers, so a Kreisel
  from an old link sounds as it did. The others are numbered from 7 on (4 to 6 are a ring's own painted,
  built and sung sound); a number is a sound's place in the palette and travels in links, so sounds are
  never moved and a palette never grows in the middle.
- **A sound is a recipe**, plain numbers in `src/sounds/`: a struck one for the four drum rings (tones
  and bursts of noise that ring out, some through a distortion), a played one for the three rings that
  play notes (oscillators through a filter, frequency modulation, vibrato, a breath or a pick of noise).
  Two players in `src/audio/sounds.ts` turn recipes into sound; the four classics are written out there
  as ever. Every recipe reads the pad like the classics do: brightness to the right, length upwards.
- **Evenly loud**: `npm run level` plays every sound once by itself (faster than it sounds, in a
  headless browser), measures it, and writes `src/sounds/trims.ts`: each sound is turned up or down
  until its loudest twentieth of a second is as loud as the ring's four classics on average, unless its
  peak would then stand out (which holds very short clicks a little lower). The numbers are measured,
  not chosen by ear.

## Techno

Kreisel is being made fit for acid techno and hard techno, step by step. The
first step is where a Kreisel begins.

- **The techno Kreisel** is what a first visit finds: 150 beats a minute and
  no swing, G Phrygian over one chord, the kick on every beat with the
  Nachbeben shaking between, an open hi-hat on the off-beats, a clap on two
  and four, a low drum on a ring of twelve, and an acid line that slides three
  times. The Werks-Kreisel of before is still there, beside it in the menu
  under the Kreisel's name.
- **A Kreisel has a style**, free or techno, which it takes from its start
  and which the menu under the Kreisel's name can switch ("Stil"). The style decides what the
  dice throw, what a control goes back to on a right click, and what an empty
  Kreisel is like. It travels in the link; a link from before there were
  styles is free.
- **Techno dice** go by what the genre's own tutorials say. The kick is on
  every beat and only the end of its ring varies. The open hi-hat sits between
  the kicks, with sixteenths, eighths or nothing around it. The clap is on two
  and four. An acid line plays about two steps in three and has at most five
  different notes (the root most of the time, its octaves, one or two notes of
  the scale). A note that follows another without a rest keeps that one's
  pitch, except where the line is meant to slide, one to three times: the acid
  bass glides between touching notes of different pitch, so a slide is written
  simply as two such notes. Two to four notes are accented, the ones slid into
  first.
- **A techno form** for the piece: its dice cut it into an intro that builds
  from the kick alone, full sections that arrive with a run-up, breaks that
  fall and climb again, and an outro; sections are 16 and 32 bars long (8 and
  16 in a piece under 64 bars). In a techno piece the kick comes in first. A
  piece can be 256 bars now, a little under seven minutes at 150.

The second step is hardness: in this music nearly every sound is distorted,
and so is the sum.

- **Zerre** drives one ring. It is the fourth control in a ring's panel,
  under volume, hall and echo, and it uses the shaper the weather's sparks
  already had: a ring can be driven all the time, and sparks painted on it
  come on top. The control is levelled by measurement (`driveTrim` in
  `src/press.ts`), so turning it changes how the ring sounds more than how
  loud it is (within about 3 dB, a little differently in each browser): its
  peaks come down to its body. The kick's ring has no Zerre: what makes a
  kick hard is its own control, "Härte" (see the Nachbeben).
- **Druck** presses the sum of everything, behind the speaker in the bar,
  under the volume. Mix, hall and echo meet in a press on their way to the master
  (`src/audio/press.ts`): two soft clippers in a row, pushed harder the
  further the control goes, and everything below 150 Hz brought to the
  middle. On the techno Kreisel it makes about 3 dB at a third and 6 dB at
  full, and the peaks stand 9 dB above the average instead of 12. The
  master's filters, compressor and limiter come after it, so a filter ride
  sweeps the pressed sound.
- **At zero both are nothing**: a ring that is not driven and a Kreisel that
  is not pressed sound as they always did, and are packed into a link as
  before. The Werks-Kreisel has neither; the techno Kreisel starts with a
  little of both.
- `window.kreisel.whole()` renders the Kreisel on the table faster than it
  plays and measures it (`src/audio/whole.ts`): peak, loudness, how far the
  peaks stand above it, brightness, and how much of the deep lows differs
  between left and right. The numbers above come from it, and the tests use
  it; nobody has to listen for a test to pass, and nothing here was set by
  ear.

The third step is acid as an instrument: a machine of its own, in the manner
of the little silver bass machine the music is named after.

- **Where it is.** The bass and the melody can each have an acid machine. It
  is one more sound under the palette's fifty ("Maschine: Acid 303"), with the
  number 53; nothing on the palette changed, and the older "Acid" sounds are
  as they were. The techno Kreisel plays its line on it.
- **The pad is its filter**: how far open from left to right, how much it
  rings from bottom to top. Under the pad the machine has a group of its own:
  "Biss" (how far a note opens the filter), "Dauer" (how slowly it falls shut),
  saw or square, and the filter ride. The ring's Zerre is its distortion.
- **Accents** are louder, fall shut at the shortest time whatever "Dauer"
  says, and open the filter further; accents that follow closely leave a
  charge that pushes the next one higher still, the more the filter rings.
- **Slides.** The machine has one voice and plays a plain note for a little
  more than half a step, so two notes side by side are two notes. A note that
  is held into the next one is tied to it: the next is not struck again, its
  filter goes on from where the first one's was, and if it is another note it
  glides there in a sixteenth of a second. On the wheel a stroke leads from
  the one to the other. The length tool makes a tie by pulling a note into the
  next, and so does "In den nächsten ziehen" in the hit's menu. Nothing new is
  stored: a tie is a note's length.
- **Room for the Nachbeben.** While the ground shakes, the machine is thinned
  out below 150 Hz, so that the Nachbeben has the lows to itself.
- **The filter ride** ("Filterfahrt") lays a hill of sun over the ring and
  sets the sun's wind to one step a bar: the filter opens and closes by
  itself, once in as many bars as the ring has steps. It is ordinary weather
  and can be repainted as such.

The rules are in `src/model.ts` (the two starts), `src/patterns.ts` (the dice),
`src/piece.ts` (the form), `src/press.ts` (hardness) and `src/acid.ts` (the
machine; `src/audio/acid.ts` makes it sound). Still to come: breaks that take
the kick out, and a techno Kreisel that uses the ride, the open hi-hat and the
claps of the new palettes (its drums start on the classics for now).

## Scenes and the row

What is in a scene, and in which order the scenes play, can be seen and laid
by hand.

- **A scene is a small wheel** (`src/ui/scene-thumb.ts`): its hits where they
  lie, in the rings' colours, the kick innermost as on the wheel itself. A
  thick frame marks the scene on the table, a red dot the one that is heard,
  an empty one shows a plus.
- **One switch says what plays** (under the scenes): the scene on the table
  round and round, the row, or the piece. It replaces the tick "Folge
  spielen" and the piece's own switch stays in step with it. The row and the
  piece are kept as they were laid; only which of them is heard changes.
- **The row** lies under the wheel while it plays: one tile a round, a round
  being a scene once through its chords. "+" lays the scene on the table at
  the end, a scene carried there with the mouse lands where it is let go, a
  tile carried along the row takes another place. A click on a tile goes
  there at the next bar line (while the Kreisel stands, the row will begin
  there), the right button repeats the round, gives it another scene, moves
  it a round earlier or later or takes it out (as Delete does). A new scene joins the row at its end, a cleared
  one takes its rounds along. A scene carried onto an empty one is copied
  there. On a phone the row is laid with "+" and a resting finger (its menu
  moves a round); carrying is the mouse's.
- **In the link** the row is a string of digits (`f`), left out while every
  filled scene plays once in turn. A Kreisel from before, which could only
  say "every scene so many times", is read as just that row.

The rules are in `src/order.ts` (plain functions on the list of rounds, with
`tests/order.test.ts`), the player walks the row in `src/audio/engine.ts`
(`changeScene`), `src/app/scenes.ts` is the desk, and the two parts of the page
are `src/ui/scenes-box.ts` and `src/ui/row-band.ts`; `src/ui/carry.ts` carries
a thing across the page with the mouse.

## Build

Sound comes from [Klangwerk](https://github.com/TheAnonymous/Klangwerk), the
Musik-Werkstatt's shared Web Audio engine; there is no UI framework, the wheel
is one canvas.

```sh
npm install
npm run dev      # http://localhost:5173/Kreisel/
npm run verify   # lint, types, unit tests, build, browser tests under the production CSP
npm run level    # after adding or changing a ready-made sound: measure all 350 and write their trims
```

The toolchain is pinned in `mise.toml` (Node 24.15.0, npm 12.0.0). All checks
run locally; see [AGENTS.md](AGENTS.md).

The code lies in four layers, and each knows only the ones before it (the linter says so, too):

1. **The project and its rules** (`src/*.ts`, `src/sounds/`): plain data and pure functions. Nothing here needs a browser.
2. **Sound** (`src/audio/`): the project made audible, live and into a file.
3. **The app** (`src/app/`): the project on the table and everything that can be done to it. `app.ts` holds
   what all of it shares; what can be done to one subject is at that subject's desk (`app.piece.dice()`,
   `app.weather.paint(…)`).
4. **The page** (`src/ui/`, `src/styles/`): the wheel, everything around it, the keyboard.

`src/main.ts` puts them together.

| Where | What |
| --- | --- |
| `src/model.ts`, `src/music.ts` | the project as plain data and the two Kreisel one can start with; scales, chords and where each ring's notes sit |
| `src/patterns.ts` | turning, spreading, dice in both styles and small variations (pure, seeded) |
| `src/codec.ts`, `src/store.ts` | the project as a link and in the browser's storage; undo |
| `src/bild.ts`, `src/imitate.ts`, `src/collection.ts` | painted sounds: strokes, guide lines, dice; what the microphone heard as strokes; the shelf of kept pictures |
| `src/body.ts`, `src/voice.ts`, `src/kick.ts`, `src/rumble.ts`, `src/weather.ts`, `src/press.ts`, `src/acid.ts` | the rules of the Klangkörper, the voice, the kick's place in the key, the Nachbeben, the weather, of Zerre and Druck, and of the acid machine |
| `src/piece.ts`, `src/order.ts`, `src/relay.ts` | the piece: what a bar's tension asks for; the row of scenes: laying, moving and walking its rounds; Reihum: what a turn touched, people's colours |
| `src/sounds/` | the palettes: 350 ready-made sounds as recipes (`shapes.ts` says what a recipe is, a file for each ring holds its fifty, `index.ts` knows their numbers and names, `trims.ts` how loud each is) |
| `src/audio/` | the ready-made sounds made audible, painted sounds, bodies and voices, the kick's drive and the Nachbeben, listening, the mixer, the player (live and offline), effects, recording; `hear.ts` renders one hit by itself and measures it, `whole.ts` the whole Kreisel |
| `src/app/app.ts` | the app's core: the table, what is in focus, starting and stopping, steps back, messages |
| `src/app/rings.ts`, `voice.ts`, `weather.ts`, `rumble.ts`, `relay.ts`, `piece.ts`, `paint.ts`, `body.ts`, `chords.ts`, `scenes.ts`, `files.ts` | one desk for each subject |
| `src/app/workshop.ts`, `prefs.ts` | what the three windows for a ring's own sound share; what the browser remembers |
| `src/ui/ring.ts`, `ring-gestures.ts`, `ring-shape.ts` | the wheel: drawing it; what a pointer does on it; what both go by |
| `src/ui/motion.ts`, `lights.ts`, `answers.ts` | motion on the wheel, the light show, the little motions with which the page answers |
| `src/ui/easel.ts`, `bench.ts`, `booth.ts` | the canvases in the three windows: the sheet, the body, the mouth |
| `src/ui/panels.ts` | everything around the wheel: the bar, the list of rings, tools, the panel of the ring in focus |
| `src/ui/scenes-box.ts`, `row-band.ts`, `scene-thumb.ts`, `carry.ts` | the scenes as small wheels with the switch for what plays; the row under the wheel; a scene drawn small; carrying a thing with the mouse |
| `src/ui/easel-window.ts`, `bench-window.ts`, `booth-window.ts`, `piece-panel.ts`, `weather-panel.ts`, `relay-dialog.ts`, `chord-menu.ts`, `toast.ts`, `help.ts`, `tour-guide.ts`, `tour.ts` | the parts of the page that have a file of their own |
| `src/ui/sound-palette.ts` | the row with the ring's sound in its panel, and the palette of all fifty |
| `src/ui/menu.ts`, `menus.ts`, `bar-menus.ts`, `keys.ts`, `keymap.ts`, `dom.ts` | the menu under the right button and what stands in it; the same menu under the bar's buttons; the keyboard; small helpers for building the page |
| `src/styles/` | the style sheet, one file for each part of the page; `src/style.css` lists them in the order of the cascade |
| `scripts/level-sounds.mjs` | `npm run level`: measures every ready-made sound and writes `src/sounds/trims.ts` |
| `e2e/` | browser tests against the built app: laptop and phone in Chromium, the laptop again in Firefox; a file a subject (`wheel`, `menus`, `files`, `sounds`, `paint`, `body`, `voice`, `rumble`, `weather`, `piece`, `relay`, `show`, `start`, `press`, `acid`, `kick`, `bar`, `scenes`), and `helpers.ts` for what they share; most tests begin with the Werks-Kreisel on the table, `start` looks at a true first visit |

## License

MIT. Klangwerk is MIT as well.
