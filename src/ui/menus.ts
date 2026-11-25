import type { App, ContextTarget } from "../app/app";
import { nextHit } from "../acid";
import { ACID_SOUND, BODY_SOUND, BUILD_SIZES, SAMPLE_SOUND, VOICE_SOUND, currentScene, MARK_NAMES, MAX_BARS, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MIN_BARS, MIN_STEPS, OWN_SOUND, patternOf, PITCH_MAX, PITCH_MIN, SCENE_NAMES, stepAt, TENSION_MAX, TRACK_COUNT, trackInfo, trackOf, type Build, type BuildSize, type Sway, wrap } from "../model";
import { chordName, pitchName } from "../music";
import { activeSteps } from "../patterns";
import { hasRumble, RUMBLE_SHAPES, shapeOf } from "../rumble";
import { describeChain, takesPedals } from "../pedals";
import { hasWeather, WEATHER_NAMES, windName } from "../weather";
import { MAX_ROUNDS } from "../order";
import { barCount, buildReach, kickOut, phraseOf, ROSTER, rosterOf, SHAPE_HINTS, SHAPE_NAMES, SHAPES, sizeName, sizeOf } from "../piece";
import { SOUND_COUNT } from "../sounds/index";
import type { MenuRow, MenuSpec } from "./menu";
import { soundLabel } from "./sound-palette";

/*
 * What the right button offers, place by place: a hit, a ring, the piece, a
 * chord field, a scene, the hub. Each menu is rebuilt from the Kreisel as it
 * is now, so it stays true while its own rows change things.
 */

/** The windows a menu can open, which belong to the panels. */
export interface MenuDoors {
  relay(): void;
  help(): void;
  /** The piece written down phrase by phrase. */
  protocol?(): void;
  /** Opens another menu in this one's place: for a row that leads on (from a bar of the piece to the build-up it is part of). */
  turnTo?(target: ContextTarget): void;
}

const VELOCITIES = ["quiet", "normal", "loud"] as const;
const CHANCES = ["always", "75 %", "50 %", "25 %"] as const;

function ringMenu(app: App, track: number, step: number | null): MenuSpec | null {
  if (app.relay.veiled(track)) return null;
  const project = app.project;
  const info = trackInfo(track);
  const pattern = patternOf(project, track);
  const settings = trackOf(project, track);
  const at = step !== null && step < pattern.len ? step : null;
  const rows: MenuRow[] = [];

  if (at !== null) {
    const note = stepAt(pattern, at);
    if (note.on) {
      rows.push(
        { kind: "choice", label: "Accent", options: VELOCITIES.map((label, vel) => ({ label, active: note.vel === vel, run: () => app.rings.setStep(track, at, { vel }) })) },
        { kind: "choice", label: "Chance", options: CHANCES.map((label, chance) => ({ label, active: note.chance === chance, title: chance === 0 ? "The hit comes every time" : `The hit comes in ${label} of the rounds`, run: () => app.rings.setStep(track, at, { chance }) })) },
        { kind: "choice", label: "Ratchet", options: [1, 2, 3, 4].map((ratchet) => ({ label: String(ratchet), active: note.ratchet === ratchet, title: ratchet === 1 ? "One hit" : `${ratchet} fast hits`, run: () => app.rings.setStep(track, at, { ratchet }) })) },
      );
      if (info.melodic) {
        const longest = Math.min(MAX_NOTE_LENGTH, pattern.len);
        rows.push({
          kind: "choice",
          label: `Length ${note.len}`,
          options: [
            { label: "−", title: "Hold the note shorter", disabled: note.len <= 1, run: () => app.rings.setStep(track, at, { len: note.len - 1 }) },
            { label: "+", title: "Hold the note longer", disabled: note.len >= longest, run: () => app.rings.setStep(track, at, { len: note.len + 1 }) },
          ],
        });
        // The acid machine ties a note that is held into the next one: the next is not struck again, and slides if it is another note.
        if (settings.sound === ACID_SOUND && nextHit(pattern, at)) {
          rows.push({ kind: "choice", label: "Into the next", options: [{ label: "slide", active: app.acid.tied(track, at), title: "Hold the note into the next one: it then glides instead of striking anew", run: () => app.acid.tie(track, at) }] });
        }
      }
      rows.push(
        {
          kind: "choice",
          label: `${info.pitchLabel}: ${pitchName(project, track, note.pitch, app.chordNow())}`,
          options: [
            { label: "−", title: "Lower", disabled: note.pitch <= PITCH_MIN, run: () => app.rings.setStep(track, at, { pitch: note.pitch - 1 }) },
            { label: "+", title: "Higher", disabled: note.pitch >= PITCH_MAX, run: () => app.rings.setStep(track, at, { pitch: note.pitch + 1 }) },
          ],
        },
        { kind: "action", label: "Remove hit", run: () => { app.rings.removeNote(track, at, "menue"); app.endGesture(); } },
      );
    } else {
      rows.push({ kind: "action", label: "Place hit", keep: true, run: () => { app.rings.addNote(track, at, {}, "menue"); app.endGesture(); } });
    }
    rows.push({ kind: "heading", label: "Whole ring" });
  }

  const copied = app.rings.copied;
  rows.push(
    { kind: "action", label: "Dice", hint: "N", keep: true, run: () => app.rings.dice(track) },
    { kind: "action", label: "Vary", hint: "Shift+N", keep: true, run: () => app.rings.vary(track) },
    {
      kind: "choice",
      label: "Rotate",
      options: [
        { label: "←", title: "Rotate one step back", run: () => app.rings.rotate(track, -1) },
        { label: "→", title: "Rotate one step on", run: () => app.rings.rotate(track, 1) },
      ],
    },
    {
      kind: "choice",
      label: `Steps ${pattern.len}`,
      options: [
        { label: "−", title: "Make the ring one step shorter", disabled: pattern.len <= MIN_STEPS, run: () => app.rings.resize(track, pattern.len - 1) },
        ...[8, 12, 16, 32].map((length) => ({ label: String(length), title: `${length} steps`, active: pattern.len === length, run: () => app.rings.resize(track, length) })),
        { label: "+", title: "Make the ring one step longer", disabled: pattern.len >= MAX_STEPS, run: () => app.rings.resize(track, pattern.len + 1) },
      ],
    },
    {
      kind: "choice",
      label: "Sound",
      options: [
        { label: "‹", title: "Previous sound from the palette", run: () => app.rings.stepSound(track, -1) },
        { label: soundLabel(track, settings), title: `Show all ${SOUND_COUNT} sounds of this ring`, close: true, run: () => { app.select(track); if (!app.rings.paletteOpen) app.rings.togglePalette(); } },
        { label: "›", title: "Next sound from the palette", run: () => app.rings.stepSound(track, 1) },
        { label: "Dice", title: app.project.style === "techno" ? "Take one of this ring's ten techno sounds" : "Take any sound from the palette", run: () => app.rings.diceSound(track) },
      ],
    },
    {
      kind: "choice",
      label: "Own sound",
      options: [
        { label: "Use", active: settings.sound === OWN_SOUND, disabled: !settings.bild, title: settings.bild ? "Use this ring's painted sound" : "Not painted yet", run: () => app.rings.setSound(track, OWN_SOUND) },
        { label: "Paint …", title: "Paint this ring's own sound", close: true, run: () => { app.select(track); app.paint.open(); } },
      ],
    },
    {
      kind: "choice",
      label: "Voice",
      options: [
        { label: "Use", active: settings.sound === VOICE_SOUND, disabled: !settings.voice, title: settings.voice ? "Use this ring's voice" : "No line written yet", run: () => app.rings.setSound(track, VOICE_SOUND) },
        { label: "Text …", title: "Write the line this ring sings", close: true, run: () => { app.select(track); app.voice.open(); } },
      ],
    },
    {
      kind: "choice",
      label: "Body",
      options: [
        { label: "Use", active: settings.sound === BODY_SOUND, disabled: !settings.body, title: settings.body ? "Use this ring's built body" : "Not built yet", run: () => app.rings.setSound(track, BODY_SOUND) },
        { label: "Build …", title: "Build this ring's body", close: true, run: () => { app.select(track); app.body.open(); } },
      ],
    },
    {
      kind: "choice",
      label: "Sample",
      options: [
        { label: "Use", active: settings.sound === SAMPLE_SOUND, disabled: !settings.sample, title: settings.sample ? `Use this ring's sample “${settings.sample.name}”` : "No recording yet", run: () => app.rings.setSound(track, SAMPLE_SOUND) },
        { label: "Sampler …", title: "Give this ring a recording to play: a file, the microphone, or the Kreisel itself", close: true, run: () => { app.select(track); if (!app.sample.open) app.sample.toggle(); } },
      ],
    },
    ...(track === 0
      ? [{
          kind: "choice" as const,
          label: "Rumble",
          options: [
            ...RUMBLE_SHAPES.map((label, shape) => ({ label, active: shapeOf(pattern, currentScene(project).rumble) === shape, title: `Lay rumble in the shape “${label}” around the kicks`, run: () => app.rumble.shape(shape) })),
            { label: "Off", active: !hasRumble(currentScene(project), pattern.len), title: "Take the rumble away", run: () => app.rumble.shape(-1) },
          ],
        }]
      : []),
    ...(takesPedals(track)
      ? [{
          kind: "choice" as const,
          label: "Pedals",
          options: [
            { label: "Open …", title: `Open this ring's pedals (${describeChain(settings)})`, close: true, run: () => { app.select(track); if (!app.pedals.open) app.pedals.toggle(); } },
            { label: "Dice", title: "Put another of this ring's chains on it", run: () => app.pedals.dice(track) },
            // On a step of a ring whose phaser or flanger sweeps: the sweep's top can be put right here.
            ...(at !== null && app.pedals.sweeps(track)
              ? [{ label: "Sweep peaks here", title: `Put the top of this ring's sweep on step ${at + 1}: it is in time, and the same in every round`, active: (settings.pedals?.crest ?? 0) % pattern.len === at, run: () => app.pedals.crestAt(track, at) }]
              : []),
          ],
        }]
      : []),
    {
      kind: "choice",
      label: "Listen",
      options: [
        { label: "Mute", active: settings.mute, title: "Mute this ring (M)", run: () => app.rings.toggleMute(track) },
        { label: "Solo", active: app.rings.solo === track, title: "Hear only this ring (Shift+M)", run: () => app.rings.toggleSolo(track) },
      ],
    },
    {
      kind: "choice",
      label: "Weather",
      options: [
        { label: "Paint …", title: "Paint weather onto the wheel: effects that drift with the wind", close: true, run: () => app.weather.focus() },
        { label: "Clear up", title: "Take the weather over this ring away", disabled: !hasWeather(currentScene(project), undefined, track), run: () => app.weather.clear(undefined, track) },
      ],
    },
    {
      kind: "choice",
      label: "Pattern",
      options: [
        { label: "Copy", title: "Remember this ring's pattern", close: true, run: () => app.rings.copy(track) },
        { label: "Paste", title: copied ? `Put the pattern of ${trackInfo(copied.track).name} here` : "Nothing copied yet", disabled: !copied, run: () => app.rings.paste(track) },
        { label: "Clear", title: "Remove all hits of this ring", disabled: activeSteps(pattern).length === 0, run: () => app.rings.clear(track) },
      ],
    },
  );
  return { title: at === null ? info.name : `${info.name} · step ${at + 1}`, color: info.color, rows };
}

/** How many things the tension moves, in words. */
export const swayName = (count: number): string => (count === 0 ? "only the roster" : count === 1 ? "1 thing more" : `${count} things more`);

/** The colour of a drop's mark on the wheel. */
const DROP_COLOR = "#e4572e";

/** What the ready-made sizes of a build-up are made of, for whoever points at one. */
const SIZE_HINTS: Record<BuildSize, string> = {
  keiner: "No build-up: the drop just comes, without a crash",
  klein: "Small: one bar of riser, then the crash",
  mittel: "Medium: four bars with riser and snare roll, the lows go, then the crash",
  gross: "Big: eight bars with riser and tone, snare roll, lows out, cloud of reverb, getting quieter, a beat of gap, then the crash",
};

/**
 * The kit of a build-up: of the drop that lands in bar `drop`, or (`null`) of all drops that have none of their own.
 * The size sets everything at once; below it every part can be had by itself.
 */
function kitMenu(app: App, drop: number | null): MenuSpec | null {
  // A drop that is gone (the line was painted over, the break taken away) has no kit.
  if (drop !== null && !app.piece.dropAt(drop)) return null;
  const piece = app.project.piece;
  const build = app.piece.build(drop);
  const none = build.bars === 0;
  const size = sizeOf(build);
  const set = (change: Partial<Build>) => (): void => app.piece.setBuild(drop, change);
  const part = (label: string, key: "roll" | "lows" | "wash" | "dip" | "kick" | "hat"): MenuRow => ({ kind: "action", label, checked: build[key], disabled: none, keep: true, run: set({ [key]: !build[key] }) });
  const rows: MenuRow[] = [
    { kind: "choice", label: "Size", options: (Object.keys(BUILD_SIZES) as BuildSize[]).map((id) => ({ label: sizeName(BUILD_SIZES[id]), title: SIZE_HINTS[id], active: size === id, run: () => app.piece.sizeBuild(drop, id) })) },
    { kind: "choice", label: "Length", options: [1, 2, 4, 8].map((bars) => ({ label: bars === 8 ? "8 bars" : String(bars), title: bars === 1 ? "The build-up runs one bar" : `The build-up runs ${bars} bars`, active: build.bars === bars, run: set({ bars }) })) },
    { kind: "heading", label: "Parts" },
    {
      kind: "choice",
      label: "Riser",
      options: [
        { label: "off", title: "No riser", active: build.riser === 0, disabled: none, run: set({ riser: 0 }) },
        { label: "Noise", title: "Riser: noise that rises up to the drop", active: build.riser === 1, disabled: none, run: set({ riser: 1 }) },
        { label: "with tone", title: "Riser: noise and a tone that climbs two octaves and arrives in the key", active: build.riser === 2, disabled: none, run: set({ riser: 2 }) },
      ],
    },
    part(`Snare roll, ${build.bars >= 4 ? "thirty-seconds" : "sixteenths"} at the end`, "roll"),
    part("Lows out: the bass thins out, the kick gets weaker", "lows"),
    part("Cloud of reverb: grows, dry at the drop", "wash"),
    part("Getting quieter", "dip"),
    part("Last bar without kick", "kick"),
    part("Last bar without hi-hat", "hat"),
    { kind: "heading", label: "The moment" },
    {
      kind: "choice",
      label: "Gap",
      options: ([[0, "none", "No gap: the build-up runs up to the drop"], [1, "beat", "The last beat before the drop is silent: only reverb and echo ring out"], [2, "½ bar", "The last half bar before the drop is silent"], [4, "bar", "The whole last bar before the drop is silent"]] as const)
        .map(([gap, label, title]) => ({ label, title, active: build.gap === gap, disabled: none, run: set({ gap }) })),
    },
    {
      kind: "choice",
      label: "Drop",
      options: [
        { label: "on the one", title: "Everything comes in on the one", active: !build.late, disabled: none, run: set({ late: false }) },
        { label: "late", title: "Late drop: on the one only kick and bass come, everything else a beat later", active: build.late, disabled: none, run: set({ late: true }) },
      ],
    },
  ];
  if (drop === null) {
    const own = app.piece.ownBuilds;
    if (own > 0) rows.push({ kind: "action", label: own === 1 ? "Also for the drop with a build-up of its own" : `Also for the ${own} drops with a build-up of their own`, keep: true, run: () => app.piece.clearBuild(null) });
    return { title: "All drops · Build-up", color: DROP_COLOR, rows };
  }
  // Two bars of what comes before, so that the build-up is heard to begin.
  const from = wrap(drop - buildReach(piece, drop) - 2, barCount(piece));
  rows.push(
    { kind: "action", label: `Listen from bar ${from + 1}`, keep: true, run: () => app.piece.playFrom(from) },
    { kind: "action", label: "Use for all drops", run: () => app.piece.shareBuild(drop) },
    { kind: "action", label: "Same as all drops again", disabled: !app.piece.hasOwnBuild(drop), keep: true, run: () => app.piece.clearBuild(drop) },
  );
  return { title: `Drop in bar ${drop + 1} · Build-up`, color: DROP_COLOR, rows };
}

/** What the tension can move beyond who plays, as the page names it and says what it does. */
const SWAYS: readonly [part: keyof Sway, label: string, does: string][] = [
  ["hat", "Hi-hat opens", "The hi-hat rings out longer the higher the tension is"],
  ["bright", "Brightness", "Bass, chords and melody get brighter with the tension, from the ring's own sound; with an acid machine the bite goes along"],
  ["kick", "Kick grows", "With little tension the kick is shorter and thinner, at the top it is all there"],
  ["dense", "Density", "With little tension the quiet hits fall away, at the top all of them play"],
  ["drive", "Drive", "Towards the top every ring is driven a little harder"],
  ["room", "Room", "The less tension, the more reverb lies on everything but kick and bass"],
];

/** What the piece's tension moves beyond who plays: each thing off, gently or clearly. */
function swayMenu(app: App): MenuSpec {
  const sway = app.project.piece.sway;
  return {
    title: "What the tension moves",
    rows: SWAYS.map(([part, label, does]) => ({
      kind: "choice" as const,
      label,
      options: (["off", "gently", "clearly"] as const).map((name, depth) => ({
        label: name,
        title: depth === 0 ? `${label}: off` : `${label}, ${name}: ${does}`,
        active: (sway?.[part] ?? 0) === depth,
        run: () => app.piece.setSway(part, depth),
      })),
    })),
  };
}

/** What each live effect does when it is laid on a bar of the piece, in the order of MARK_NAMES. */
const MARK_HINTS = [
  "Dull: this bar sounds dull, as under the key",
  "Thin: the lows are missing in this bar",
  "Stutter: the second half of this bar stutters",
  "Echo: the last beat of this bar goes into the echo",
  "Pause: in the last beat of this bar drums and bass drop out",
] as const;

/** What happens by itself where a phrase of eight bars ends and the next begins. */
function endsMenu(app: App): MenuSpec {
  const piece = app.project.piece;
  const crash = piece.ends?.crash ?? 0;
  return {
    title: "Phrase ends",
    rows: [
      { kind: "action", label: "Fills", note: "Every eighth bar ends with one more kick, every sixteenth with two strokes of the drum as well", checked: piece.vary ?? false, keep: true, run: () => app.piece.toggleVary() },
      { kind: "action", label: "Last kick left out", note: "The last kick of every phrase stays out, the one after it hits harder", checked: piece.ends?.kick ?? false, keep: true, run: () => app.piece.setEnds({ kick: !(piece.ends?.kick ?? false) }) },
      {
        kind: "choice",
        label: "Crash on the one",
        options: ([[0, "off", "No crash at the phrases"], [16, "every 16", "A crash on the one every 16 bars"], [32, "every 32", "A crash on the one every 32 bars"]] as const)
          .map(([every, label, title]) => ({ label, title, active: crash === every, run: () => app.piece.setEnds({ crash: every }) })),
      },
      { kind: "action", label: "Backwards cymbal", note: "A cymbal swells backwards into the start of every phrase", checked: piece.ends?.swell ?? false, keep: true, run: () => app.piece.setEnds({ swell: !(piece.ends?.swell ?? false) }) },
    ],
  };
}

function pieceMenu(app: App, bar: number | null, doors: MenuDoors): MenuSpec {
  const project = app.project;
  const piece = project.piece;
  const count = barCount(piece);
  const at = bar !== null && bar < count ? bar : null;
  const rows: MenuRow[] = [];
  if (at !== null) {
    const tension = piece.tension[at] ?? 0;
    const from = Math.floor(at / 4) * 4;
    const phrase = phraseOf(piece, at);
    const out = kickOut(piece, at);
    rows.push(
      { kind: "action", label: "Play from here", run: () => app.piece.playFrom(at) },
      {
        kind: "choice",
        label: `Tension ${Math.round((tension / TENSION_MAX) * 100)} %`,
        options: [
          { label: "−", title: "Less going on in this bar", disabled: tension <= 0, run: () => app.piece.paintTension(at, tension - 2, `spannung-menue${at}`) },
          { label: "+", title: "More going on in this bar", disabled: tension >= TENSION_MAX, run: () => app.piece.paintTension(at, tension + 2, `spannung-menue${at}`) },
        ],
      },
      {
        kind: "choice",
        label: `Scene, bars ${from + 1} to ${Math.min(count, from + 4)}`,
        options: project.scenes.flatMap((scene, index) => (scene ? [{ label: SCENE_NAMES[index] ?? "", title: `Put scene ${SCENE_NAMES[index]} on these four bars`, active: piece.scenes[at] === index, run: () => app.piece.sceneForBars(at, index) }] : [])),
      },
      {
        kind: "choice",
        label: `Bars ${phrase.from + 1} to ${phrase.to}`,
        options: [
          { label: "with kick", title: "The kick plays in these bars as soon as the tension reaches it", active: !out, run: () => app.piece.kickForPhrase(at, true) },
          { label: "Break", title: "Break: kick and rumble drop out in these bars, everything else plays by the tension", active: out, run: () => app.piece.kickForPhrase(at, false) },
        ],
      },
    );
    // One or more of the five live effects, laid on this bar: they play there by themselves, once.
    const marks = app.piece.marksAt(at);
    rows.push({ kind: "choice", label: "Effect", options: MARK_NAMES.map((label, bit) => ({ label, title: MARK_HINTS[bit] ?? label, active: (marks & (1 << bit)) !== 0, run: () => app.piece.toggleMark(at, 1 << bit) })) });
    // A bar that leads up to a drop, or the drop itself: the way to its build-up.
    const drop = app.piece.dropNear(at);
    if (drop !== null) rows.push({ kind: "action", label: `Build-up before the drop in bar ${drop + 1} …`, note: app.piece.describeDrop(drop).split(" · ")[1] ?? "", run: () => doors.turnTo?.({ kind: "build", drop }) });
    rows.push({ kind: "heading", label: "Whole piece" });
  }
  rows.push(
    { kind: "action", label: "Play by the piece", checked: piece.on, keep: true, run: () => app.piece.toggle() },
    { kind: "action", label: "Dice", hint: "N", keep: true, run: () => app.piece.dice() },
    { kind: "choice", label: "Dice a shape", options: SHAPES.map((shape) => ({ label: SHAPE_NAMES[shape], title: SHAPE_HINTS[shape], run: () => app.piece.dice(shape) })) },
    { kind: "action", label: "Smooth", keep: true, run: () => app.piece.smooth() },
    {
      kind: "choice",
      label: `Bars ${count}`,
      options: [
        { label: "−", title: "Four bars shorter", disabled: count <= MIN_BARS, run: () => app.piece.resize(count - 4) },
        ...[16, 32, 64].map((bars) => ({ label: String(bars), title: `${bars} bars`, active: count === bars, run: () => app.piece.resize(bars) })),
        { label: "+", title: "Four bars longer", disabled: count >= MAX_BARS, run: () => app.piece.resize(count + 4) },
      ],
    },
    { kind: "action", label: `The tension moves: ${swayName(app.piece.swayCount)} …`, run: () => doors.turnTo?.({ kind: "sway" }) },
    { kind: "action", label: `Build-up of all drops: ${sizeName(app.piece.build(null))} …`, run: () => doors.turnTo?.({ kind: "build", drop: null }) },
    { kind: "action", label: "Fills every eight bars", checked: piece.vary ?? false, keep: true, run: () => app.piece.toggleVary() },
    { kind: "action", label: `Phrase ends: ${app.piece.endsCount === 0 ? "nothing" : app.piece.endsCount} …`, run: () => doors.turnTo?.({ kind: "ends" }) },
    { kind: "action", label: "Outline …", run: () => doors.protocol?.() },
  );
  return { title: at === null ? "Piece" : `Piece · bar ${at + 1}`, rows };
}

/** The roster of one phrase: every ring, and whether it goes by the tension, plays or rests there. */
function rosterMenu(app: App, bar: number): MenuSpec | null {
  const piece = app.project.piece;
  if (bar < 0 || bar >= barCount(piece)) return null;
  const { from, to } = phraseOf(piece, bar);
  const rows: MenuRow[] = [{ kind: "heading", label: "Roster in these bars" }];
  // The melody first, as in the list of rings.
  for (let ring = TRACK_COUNT - 1; ring >= 0; ring -= 1) {
    const name = trackInfo(ring).name;
    const state = rosterOf(piece, ring, bar);
    rows.push({
      kind: "choice",
      label: name,
      options: [
        { label: "Tension", title: `${name}: the tension decides in these bars`, active: state === ROSTER.tension, run: () => app.piece.layRoster(ring, bar, ROSTER.tension) },
        { label: "plays", title: `${name}: plays in these bars, whatever the tension says`, active: state === ROSTER.plays, run: () => app.piece.layRoster(ring, bar, ROSTER.plays) },
        { label: "rests", title: `${name}: rests in these bars`, active: state === ROSTER.rests, run: () => app.piece.layRoster(ring, bar, ROSTER.rests) },
      ],
    });
  }
  rows.push(
    { kind: "action", label: "All play in these bars", keep: true, run: () => app.piece.fillRoster(bar) },
    { kind: "action", label: "All by the tension", keep: true, run: () => app.piece.clearRoster(bar) },
    { kind: "action", label: "Play from here", run: () => app.piece.playFrom(from) },
  );
  return { title: `Piece · bars ${from + 1} to ${to}`, rows };
}

function chordMenu(app: App, slot: number): MenuSpec | null {
  const project = app.project;
  const chords = currentScene(project).chords;
  const degree = chords[slot];
  if (degree === undefined) return null;
  return {
    title: `Bar ${slot + 1} of ${chords.length}`,
    color: trackInfo(5).color,
    rows: [
      { kind: "choice", label: "Chord", options: Array.from({ length: 7 }, (_, index) => ({ label: chordName(project.root, project.scale, index), active: degree === index, run: () => app.chords.set(slot, index) })) },
      { kind: "action", label: "Double the bar", disabled: chords.length >= MAX_CHORDS, keep: true, run: () => app.chords.insertBar(slot) },
      { kind: "action", label: "Remove the bar", disabled: chords.length <= 1, run: () => app.chords.removeBar(slot) },
    ],
  };
}

function sceneMenu(app: App, index: number): MenuSpec | null {
  const project = app.project;
  const name = SCENE_NAMES[index];
  if (name === undefined) return null;
  if (!project.scenes[index]) {
    return { title: `Scene ${name} (empty)`, rows: [{ kind: "action", label: `Create as a copy of ${SCENE_NAMES[project.scene]}`, run: () => app.scenes.pick(index) }] };
  }
  const free = app.scenes.free();
  const filled = project.scenes.filter((scene) => scene !== null).length;
  return {
    title: `Scene ${name}`,
    rows: [
      { kind: "action", label: "Switch here", disabled: project.scene === index, run: () => app.scenes.pick(index) },
      { kind: "action", label: free >= 0 ? `Put a copy on ${SCENE_NAMES[free]}` : "Create a copy (no room left)", disabled: free < 0, run: () => app.scenes.copy(index) },
      { kind: "action", label: "Put into the row", disabled: project.order.length >= MAX_ROUNDS, run: () => app.scenes.lay(index) },
      { kind: "action", label: "Play through the whole piece", run: () => app.piece.sceneForBars(0, index, true) },
      { kind: "action", label: "Clear", hint: "Shift+click", disabled: filled <= 1, run: () => app.scenes.clear(index) },
    ],
  };
}

/** One round of the row under the wheel. */
function roundMenu(app: App, round: number): MenuSpec | null {
  const project = app.project;
  const scene = project.order[round];
  if (scene === undefined) return null;
  const filled = project.scenes.flatMap((entry, index) => (entry ? [index] : []));
  return {
    title: `Row: round ${round + 1}, scene ${SCENE_NAMES[scene] ?? ""}`,
    rows: [
      { kind: "action", label: "Play from here", run: () => app.scenes.playFrom(round) },
      { kind: "action", label: "Once more", keep: true, disabled: project.order.length >= MAX_ROUNDS, run: () => app.scenes.repeatRound(round) },
      { kind: "choice", label: "Scene", options: filled.map((index) => ({ label: SCENE_NAMES[index] ?? "", title: `This round plays scene ${SCENE_NAMES[index] ?? ""}`, active: index === scene, run: () => app.scenes.setRound(round, index) })) },
      // What the mouse does by carrying the tile, for a finger and for the keyboard.
      { kind: "action", label: "One round earlier", disabled: round === 0, run: () => app.scenes.moveRound(round, round - 1) },
      { kind: "action", label: "One round later", disabled: round >= project.order.length - 1, run: () => app.scenes.moveRound(round, round + 1) },
      { kind: "action", label: "Take out", hint: "Del", disabled: project.order.length <= 1, run: () => app.scenes.removeRound(round) },
    ],
  };
}

function hubMenu(app: App, doors: MenuDoors): MenuSpec {
  return {
    title: "Kreisel",
    rows: [
      { kind: "action", label: app.playing ? "Stop" : "Start", hint: "Space", run: () => app.togglePlay() },
      { kind: "action", label: app.engine.recording ? "Stop recording" : "Record", run: () => void app.files.toggleRecording() },
      { kind: "action", label: "Dice all rings", run: () => app.rings.diceAll() },
      { kind: "action", label: "Realign every eight bars", note: "Rings of unequal length rub for eight bars and then start together again", checked: app.project.align ?? false, keep: true, run: () => app.toggleAlign() },
      { kind: "action", label: "Undo", hint: "Ctrl+Z", disabled: !app.store.canUndo, keep: true, run: () => app.undo() },
      { kind: "action", label: "Redo", hint: "Ctrl+Y", disabled: !app.store.canRedo, keep: true, run: () => app.redo() },
      { kind: "heading", label: "Pass on" },
      { kind: "action", label: "Copy link", run: () => void app.files.share() },
      { kind: "action", label: "Pass around …", run: () => doors.relay() },
      { kind: "action", label: "Save as Opus", run: () => void app.files.exportSound() },
      { kind: "heading", label: "Help" },
      { kind: "action", label: "Help and keys", hint: "?", run: () => doors.help() },
    ],
  };
}

function weatherMenu(app: App): MenuSpec {
  const scene = currentScene(app.project);
  const rows: MenuRow[] = [
    { kind: "action", label: "Paint weather …", run: () => app.weather.focus() },
    { kind: "action", label: "Dice", keep: true, run: () => app.weather.dice() },
    { kind: "action", label: "Clear everything up", disabled: !hasWeather(scene), run: () => app.weather.clear() },
  ];
  // What lies in the sky can be taken away kind by kind, or held still.
  WEATHER_NAMES.forEach((name, kind) => {
    if (!hasWeather(scene, kind)) return;
    rows.push({
      kind: "choice",
      label: `${name}: ${windName(scene.wind[kind] ?? 0)}`,
      options: [
        { label: "stop", title: `Stop the wind of ${name}`, disabled: (scene.wind[kind] ?? 0) === 0, run: () => app.weather.setWind(kind, 0) },
        { label: "remove", title: `Take ${name} away`, run: () => app.weather.clear(kind) },
      ],
    });
  });
  return { title: "Weather", color: "#3d7edb", rows };
}

/** The menu for what the right button landed on, or `null` when there is nothing to offer (any more). */
export function buildMenu(app: App, target: ContextTarget, doors: MenuDoors): MenuSpec | null {
  if (target.kind === "ring") return ringMenu(app, target.track, target.step);
  if (target.kind === "piece") return pieceMenu(app, target.bar, doors);
  if (target.kind === "build") return kitMenu(app, target.drop);
  if (target.kind === "sway") return swayMenu(app);
  if (target.kind === "ends") return endsMenu(app);
  if (target.kind === "roster") return rosterMenu(app, target.bar);
  if (target.kind === "chord") return chordMenu(app, target.slot);
  if (target.kind === "scene") return sceneMenu(app, target.index);
  if (target.kind === "round") return roundMenu(app, target.round);
  if (target.kind === "weather") return weatherMenu(app);
  return hubMenu(app, doors);
}
