import type { App, ContextTarget } from "../app/app";
import { nextHit } from "../acid";
import { ACID_SOUND, BODY_SOUND, BUILD_SIZES, VOICE_SOUND, currentScene, MAX_BARS, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MIN_BARS, MIN_STEPS, OWN_SOUND, patternOf, PITCH_MAX, PITCH_MIN, SCENE_NAMES, stepAt, TENSION_MAX, TRACK_COUNT, trackInfo, trackOf, type Build, type BuildSize, wrap } from "../model";
import { chordName, pitchName } from "../music";
import { activeSteps } from "../patterns";
import { hasRumble, RUMBLE_SHAPES, shapeOf } from "../rumble";
import { hasWeather, WEATHER_NAMES, windName } from "../weather";
import { MAX_ROUNDS } from "../order";
import { barCount, buildReach, kickOut, phraseOf, ROSTER, rosterOf, sizeName, sizeOf } from "../piece";
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
  /** Opens another menu in this one's place: for a row that leads on (from a bar of the piece to the build-up it is part of). */
  turnTo?(target: ContextTarget): void;
}

const VELOCITIES = ["leise", "normal", "laut"] as const;
const CHANCES = ["immer", "75 %", "50 %", "25 %"] as const;

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
        { kind: "choice", label: "Betonung", options: VELOCITIES.map((label, vel) => ({ label, active: note.vel === vel, run: () => app.rings.setStep(track, at, { vel }) })) },
        { kind: "choice", label: "Zufall", options: CHANCES.map((label, chance) => ({ label, active: note.chance === chance, title: chance === 0 ? "Der Schlag kommt jedes Mal" : `Der Schlag kommt in ${label} der Runden`, run: () => app.rings.setStep(track, at, { chance }) })) },
        { kind: "choice", label: "Wirbel", options: [1, 2, 3, 4].map((ratchet) => ({ label: String(ratchet), active: note.ratchet === ratchet, title: ratchet === 1 ? "Ein Schlag" : `${ratchet} schnelle Schläge`, run: () => app.rings.setStep(track, at, { ratchet }) })) },
      );
      if (info.melodic) {
        const longest = Math.min(MAX_NOTE_LENGTH, pattern.len);
        rows.push({
          kind: "choice",
          label: `Länge ${note.len}`,
          options: [
            { label: "−", title: "Den Ton kürzer halten", disabled: note.len <= 1, run: () => app.rings.setStep(track, at, { len: note.len - 1 }) },
            { label: "+", title: "Den Ton länger halten", disabled: note.len >= longest, run: () => app.rings.setStep(track, at, { len: note.len + 1 }) },
          ],
        });
        // The acid machine ties a note that is held into the next one: the next is not struck again, and slides if it is another note.
        if (settings.sound === ACID_SOUND && nextHit(pattern, at)) {
          rows.push({ kind: "choice", label: "In den nächsten", options: [{ label: "ziehen", active: app.acid.tied(track, at), title: "Den Ton in den nächsten hineinhalten: Der gleitet dann, statt neu anzuschlagen", run: () => app.acid.tie(track, at) }] });
        }
      }
      rows.push(
        {
          kind: "choice",
          label: `${info.pitchLabel}: ${pitchName(project, track, note.pitch, app.chordNow())}`,
          options: [
            { label: "−", title: "Tiefer", disabled: note.pitch <= PITCH_MIN, run: () => app.rings.setStep(track, at, { pitch: note.pitch - 1 }) },
            { label: "+", title: "Höher", disabled: note.pitch >= PITCH_MAX, run: () => app.rings.setStep(track, at, { pitch: note.pitch + 1 }) },
          ],
        },
        { kind: "action", label: "Schlag löschen", run: () => { app.rings.removeNote(track, at, "menue"); app.endGesture(); } },
      );
    } else {
      rows.push({ kind: "action", label: "Schlag setzen", keep: true, run: () => { app.rings.addNote(track, at, {}, "menue"); app.endGesture(); } });
    }
    rows.push({ kind: "heading", label: "Ganzer Ring" });
  }

  const copied = app.rings.copied;
  rows.push(
    { kind: "action", label: "Würfeln", hint: "N", keep: true, run: () => app.rings.dice(track) },
    { kind: "action", label: "Variieren", hint: "Umschalt+N", keep: true, run: () => app.rings.vary(track) },
    {
      kind: "choice",
      label: "Drehen",
      options: [
        { label: "←", title: "Einen Schritt zurückdrehen", run: () => app.rings.rotate(track, -1) },
        { label: "→", title: "Einen Schritt weiterdrehen", run: () => app.rings.rotate(track, 1) },
      ],
    },
    {
      kind: "choice",
      label: `Schritte ${pattern.len}`,
      options: [
        { label: "−", title: "Den Ring einen Schritt kürzer machen", disabled: pattern.len <= MIN_STEPS, run: () => app.rings.resize(track, pattern.len - 1) },
        ...[8, 12, 16, 32].map((length) => ({ label: String(length), title: `${length} Schritte`, active: pattern.len === length, run: () => app.rings.resize(track, length) })),
        { label: "+", title: "Den Ring einen Schritt länger machen", disabled: pattern.len >= MAX_STEPS, run: () => app.rings.resize(track, pattern.len + 1) },
      ],
    },
    {
      kind: "choice",
      label: "Klang",
      options: [
        { label: "‹", title: "Voriger Klang aus der Palette", run: () => app.rings.stepSound(track, -1) },
        { label: soundLabel(track, settings), title: `Alle ${SOUND_COUNT} Klänge dieses Rings zeigen`, close: true, run: () => { app.select(track); if (!app.rings.paletteOpen) app.rings.togglePalette(); } },
        { label: "›", title: "Nächster Klang aus der Palette", run: () => app.rings.stepSound(track, 1) },
        { label: "Würfeln", title: app.project.style === "techno" ? "Einen der zehn Techno-Klänge dieses Rings nehmen" : "Irgendeinen Klang aus der Palette nehmen", run: () => app.rings.diceSound(track) },
      ],
    },
    {
      kind: "choice",
      label: "Eigener Klang",
      options: [
        { label: "Nehmen", active: settings.sound === OWN_SOUND, disabled: !settings.bild, title: settings.bild ? "Den gemalten Klang dieses Rings nehmen" : "Noch nicht gemalt", run: () => app.rings.setSound(track, OWN_SOUND) },
        { label: "Malen …", title: "Den eigenen Klang dieses Rings malen", close: true, run: () => { app.select(track); app.paint.open(); } },
      ],
    },
    {
      kind: "choice",
      label: "Stimme",
      options: [
        { label: "Nehmen", active: settings.sound === VOICE_SOUND, disabled: !settings.voice, title: settings.voice ? "Die Stimme dieses Rings nehmen" : "Noch keine Zeile geschrieben", run: () => app.rings.setSound(track, VOICE_SOUND) },
        { label: "Text …", title: "Die Zeile schreiben, die dieser Ring singt", close: true, run: () => { app.select(track); app.voice.open(); } },
      ],
    },
    {
      kind: "choice",
      label: "Klangkörper",
      options: [
        { label: "Nehmen", active: settings.sound === BODY_SOUND, disabled: !settings.body, title: settings.body ? "Den gebauten Klangkörper dieses Rings nehmen" : "Noch nicht gebaut", run: () => app.rings.setSound(track, BODY_SOUND) },
        { label: "Bauen …", title: "Den Klangkörper dieses Rings bauen", close: true, run: () => { app.select(track); app.body.open(); } },
      ],
    },
    ...(track === 0
      ? [{
          kind: "choice" as const,
          label: "Nachbeben",
          options: [
            ...RUMBLE_SHAPES.map((label, shape) => ({ label, active: shapeOf(pattern, currentScene(project).rumble) === shape, title: `Nachbeben in der Form „${label}“ um die Kicks legen`, run: () => app.rumble.shape(shape) })),
            { label: "Aus", active: !hasRumble(currentScene(project), pattern.len), title: "Das Nachbeben wegnehmen", run: () => app.rumble.shape(-1) },
          ],
        }]
      : []),
    {
      kind: "choice",
      label: "Hören",
      options: [
        { label: "Stumm", active: settings.mute, title: "Diesen Ring stumm schalten (M)", run: () => app.rings.toggleMute(track) },
        { label: "Allein", active: app.rings.solo === track, title: "Nur diesen Ring hören (Umschalt+M)", run: () => app.rings.toggleSolo(track) },
      ],
    },
    {
      kind: "choice",
      label: "Wetter",
      options: [
        { label: "Malen …", title: "Wetter auf das Rad malen: Effekte, die mit dem Wind ziehen", close: true, run: () => app.weather.focus() },
        { label: "Aufklaren", title: "Das Wetter über diesem Ring wegnehmen", disabled: !hasWeather(currentScene(project), undefined, track), run: () => app.weather.clear(undefined, track) },
      ],
    },
    {
      kind: "choice",
      label: "Muster",
      options: [
        { label: "Kopieren", title: "Das Muster dieses Rings merken", close: true, run: () => app.rings.copy(track) },
        { label: "Einfügen", title: copied ? `Das Muster von ${trackInfo(copied.track).name} hierher legen` : "Noch nichts kopiert", disabled: !copied, run: () => app.rings.paste(track) },
        { label: "Leeren", title: "Alle Schläge dieses Rings entfernen", disabled: activeSteps(pattern).length === 0, run: () => app.rings.clear(track) },
      ],
    },
  );
  return { title: at === null ? info.name : `${info.name} · Schritt ${at + 1}`, color: info.color, rows };
}

/** The colour of a drop's mark on the wheel. */
const DROP_COLOR = "#e4572e";

/** What the ready-made sizes of a build-up are made of, for whoever points at one. */
const SIZE_HINTS: Record<BuildSize, string> = {
  keiner: "Kein Build-up: Der Drop kommt einfach, ohne Crash",
  klein: "Klein: ein Takt Riser, dann der Crash",
  mittel: "Mittel: vier Takte mit Riser und Snare-Roll, die Tiefen gehen raus, dann der Crash",
  gross: "Groß: acht Takte mit Riser und Ton, Snare-Roll, Tiefen raus, Hall-Wolke, leiser werden, ein Schlag Lücke, dann der Crash",
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
    { kind: "choice", label: "Größe", options: (Object.keys(BUILD_SIZES) as BuildSize[]).map((id) => ({ label: sizeName(BUILD_SIZES[id]), title: SIZE_HINTS[id], active: size === id, run: () => app.piece.sizeBuild(drop, id) })) },
    { kind: "choice", label: "Länge", options: [1, 2, 4, 8].map((bars) => ({ label: bars === 8 ? "8 Takte" : String(bars), title: bars === 1 ? "Der Build-up läuft einen Takt" : `Der Build-up läuft ${bars} Takte`, active: build.bars === bars, run: set({ bars }) })) },
    { kind: "heading", label: "Zutaten" },
    {
      kind: "choice",
      label: "Riser",
      options: [
        { label: "aus", title: "Kein Riser", active: build.riser === 0, disabled: none, run: set({ riser: 0 }) },
        { label: "Rauschen", title: "Riser: Rauschen, das bis zum Drop ansteigt", active: build.riser === 1, disabled: none, run: set({ riser: 1 }) },
        { label: "mit Ton", title: "Riser: Rauschen und ein Ton, der zwei Oktaven hochfährt und in der Tonart ankommt", active: build.riser === 2, disabled: none, run: set({ riser: 2 }) },
      ],
    },
    part(`Snare-Roll, am Ende ${build.bars >= 4 ? "Zweiunddreißigstel" : "Sechzehntel"}`, "roll"),
    part("Tiefen raus: Bass dünnt aus, Kick wird schwächer", "lows"),
    part("Hall-Wolke: wächst, am Drop trocken", "wash"),
    part("Leiser werden", "dip"),
    part("Letzter Takt ohne Kick", "kick"),
    part("Letzter Takt ohne Hi-Hat", "hat"),
    { kind: "heading", label: "Der Moment" },
    {
      kind: "choice",
      label: "Lücke",
      options: ([[0, "keine", "Keine Lücke: Der Build-up läuft bis zum Drop"], [1, "Schlag", "Der letzte Schlag vor dem Drop ist still: Nur Hall und Echo klingen aus"], [2, "½ Takt", "Der letzte halbe Takt vor dem Drop ist still"], [4, "Takt", "Der ganze letzte Takt vor dem Drop ist still"]] as const)
        .map(([gap, label, title]) => ({ label, title, active: build.gap === gap, disabled: none, run: set({ gap }) })),
    },
    {
      kind: "choice",
      label: "Drop",
      options: [
        { label: "auf die Eins", title: "Alles setzt auf der Eins ein", active: !build.late, disabled: none, run: set({ late: false }) },
        { label: "spät", title: "Später Drop: Auf der Eins kommen nur Kick und Bass, alles andere einen Schlag später", active: build.late, disabled: none, run: set({ late: true }) },
      ],
    },
  ];
  if (drop === null) {
    const own = app.piece.ownBuilds;
    if (own > 0) rows.push({ kind: "action", label: own === 1 ? "Auch für den Drop mit eigenem Build-up" : `Auch für die ${own} Drops mit eigenem Build-up`, keep: true, run: () => app.piece.clearBuild(null) });
    return { title: "Alle Drops · Build-up", color: DROP_COLOR, rows };
  }
  // Two bars of what comes before, so that the build-up is heard to begin.
  const from = wrap(drop - buildReach(piece, drop) - 2, barCount(piece));
  rows.push(
    { kind: "action", label: `Anhören ab Takt ${from + 1}`, keep: true, run: () => app.piece.playFrom(from) },
    { kind: "action", label: "Für alle Drops übernehmen", run: () => app.piece.shareBuild(drop) },
    { kind: "action", label: "Wieder wie alle Drops", disabled: !app.piece.hasOwnBuild(drop), keep: true, run: () => app.piece.clearBuild(drop) },
  );
  return { title: `Drop in Takt ${drop + 1} · Build-up`, color: DROP_COLOR, rows };
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
      { kind: "action", label: "Ab hier spielen", run: () => app.piece.playFrom(at) },
      {
        kind: "choice",
        label: `Spannung ${Math.round((tension / TENSION_MAX) * 100)} %`,
        options: [
          { label: "−", title: "Weniger los in diesem Takt", disabled: tension <= 0, run: () => app.piece.paintTension(at, tension - 2, `spannung-menue${at}`) },
          { label: "+", title: "Mehr los in diesem Takt", disabled: tension >= TENSION_MAX, run: () => app.piece.paintTension(at, tension + 2, `spannung-menue${at}`) },
        ],
      },
      {
        kind: "choice",
        label: `Szene, Takt ${from + 1} bis ${Math.min(count, from + 4)}`,
        options: project.scenes.flatMap((scene, index) => (scene ? [{ label: SCENE_NAMES[index] ?? "", title: `Szene ${SCENE_NAMES[index]} auf diese vier Takte legen`, active: piece.scenes[at] === index, run: () => app.piece.sceneForBars(at, index) }] : [])),
      },
      {
        kind: "choice",
        label: `Takt ${phrase.from + 1} bis ${phrase.to}`,
        options: [
          { label: "mit Kick", title: "Die Kick spielt in diesen Takten, sobald die Spannung sie erreicht", active: !out, run: () => app.piece.kickForPhrase(at, true) },
          { label: "Break", title: "Break: Kick und Nachbeben setzen in diesen Takten aus, alles andere spielt nach der Spannung", active: out, run: () => app.piece.kickForPhrase(at, false) },
        ],
      },
    );
    // A bar that leads up to a drop, or the drop itself: the way to its build-up.
    const drop = app.piece.dropNear(at);
    if (drop !== null) rows.push({ kind: "action", label: `Build-up vor dem Drop in Takt ${drop + 1} …`, note: app.piece.describeDrop(drop).split(" · ")[1] ?? "", run: () => doors.turnTo?.({ kind: "build", drop }) });
    rows.push({ kind: "heading", label: "Ganzes Stück" });
  }
  rows.push(
    { kind: "action", label: "Nach dem Stück spielen", checked: piece.on, keep: true, run: () => app.piece.toggle() },
    { kind: "action", label: "Würfeln", hint: "N", keep: true, run: () => app.piece.dice() },
    { kind: "action", label: "Glätten", keep: true, run: () => app.piece.smooth() },
    {
      kind: "choice",
      label: `Takte ${count}`,
      options: [
        { label: "−", title: "Vier Takte kürzer", disabled: count <= MIN_BARS, run: () => app.piece.resize(count - 4) },
        ...[16, 32, 64].map((bars) => ({ label: String(bars), title: `${bars} Takte`, active: count === bars, run: () => app.piece.resize(bars) })),
        { label: "+", title: "Vier Takte länger", disabled: count >= MAX_BARS, run: () => app.piece.resize(count + 4) },
      ],
    },
    { kind: "action", label: `Build-up aller Drops: ${sizeName(app.piece.build(null))} …`, run: () => doors.turnTo?.({ kind: "build", drop: null }) },
    { kind: "action", label: "Fills alle acht Takte", checked: piece.vary ?? false, keep: true, run: () => app.piece.toggleVary() },
  );
  return { title: at === null ? "Stück" : `Stück · Takt ${at + 1}`, rows };
}

/** The roster of one phrase: every ring, and whether it goes by the tension, plays or rests there. */
function rosterMenu(app: App, bar: number): MenuSpec | null {
  const piece = app.project.piece;
  if (bar < 0 || bar >= barCount(piece)) return null;
  const { from, to } = phraseOf(piece, bar);
  const rows: MenuRow[] = [{ kind: "heading", label: "Einsätze in diesen Takten" }];
  // The melody first, as in the list of rings.
  for (let ring = TRACK_COUNT - 1; ring >= 0; ring -= 1) {
    const name = trackInfo(ring).name;
    const state = rosterOf(piece, ring, bar);
    rows.push({
      kind: "choice",
      label: name,
      options: [
        { label: "Spannung", title: `${name}: Die Spannung entscheidet in diesen Takten`, active: state === ROSTER.tension, run: () => app.piece.layRoster(ring, bar, ROSTER.tension) },
        { label: "spielt", title: `${name}: spielt in diesen Takten, was auch die Spannung sagt`, active: state === ROSTER.plays, run: () => app.piece.layRoster(ring, bar, ROSTER.plays) },
        { label: "pausiert", title: `${name}: pausiert in diesen Takten`, active: state === ROSTER.rests, run: () => app.piece.layRoster(ring, bar, ROSTER.rests) },
      ],
    });
  }
  rows.push(
    { kind: "action", label: "Alle spielen in diesen Takten", keep: true, run: () => app.piece.fillRoster(bar) },
    { kind: "action", label: "Alle nach der Spannung", keep: true, run: () => app.piece.clearRoster(bar) },
    { kind: "action", label: "Ab hier spielen", run: () => app.piece.playFrom(from) },
  );
  return { title: `Stück · Takt ${from + 1} bis ${to}`, rows };
}

function chordMenu(app: App, slot: number): MenuSpec | null {
  const project = app.project;
  const chords = currentScene(project).chords;
  const degree = chords[slot];
  if (degree === undefined) return null;
  return {
    title: `Takt ${slot + 1} von ${chords.length}`,
    color: trackInfo(5).color,
    rows: [
      { kind: "choice", label: "Akkord", options: Array.from({ length: 7 }, (_, index) => ({ label: chordName(project.root, project.scale, index), active: degree === index, run: () => app.chords.set(slot, index) })) },
      { kind: "action", label: "Takt verdoppeln", disabled: chords.length >= MAX_CHORDS, keep: true, run: () => app.chords.insertBar(slot) },
      { kind: "action", label: "Takt entfernen", disabled: chords.length <= 1, run: () => app.chords.removeBar(slot) },
    ],
  };
}

function sceneMenu(app: App, index: number): MenuSpec | null {
  const project = app.project;
  const name = SCENE_NAMES[index];
  if (name === undefined) return null;
  if (!project.scenes[index]) {
    return { title: `Szene ${name} (leer)`, rows: [{ kind: "action", label: `Als Kopie von ${SCENE_NAMES[project.scene]} anlegen`, run: () => app.scenes.pick(index) }] };
  }
  const free = app.scenes.free();
  const filled = project.scenes.filter((scene) => scene !== null).length;
  return {
    title: `Szene ${name}`,
    rows: [
      { kind: "action", label: "Hierher wechseln", disabled: project.scene === index, run: () => app.scenes.pick(index) },
      { kind: "action", label: free >= 0 ? `Kopie nach ${SCENE_NAMES[free]} legen` : "Kopie anlegen (kein Platz frei)", disabled: free < 0, run: () => app.scenes.copy(index) },
      { kind: "action", label: "In die Folge legen", disabled: project.order.length >= MAX_ROUNDS, run: () => app.scenes.lay(index) },
      { kind: "action", label: "Im ganzen Stück spielen", run: () => app.piece.sceneForBars(0, index, true) },
      { kind: "action", label: "Leeren", hint: "Umschalt+Klick", disabled: filled <= 1, run: () => app.scenes.clear(index) },
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
    title: `Folge: ${round + 1}. Runde, Szene ${SCENE_NAMES[scene] ?? ""}`,
    rows: [
      { kind: "action", label: "Von hier spielen", run: () => app.scenes.playFrom(round) },
      { kind: "action", label: "Noch einmal", keep: true, disabled: project.order.length >= MAX_ROUNDS, run: () => app.scenes.repeatRound(round) },
      { kind: "choice", label: "Szene", options: filled.map((index) => ({ label: SCENE_NAMES[index] ?? "", title: `Diese Runde spielt Szene ${SCENE_NAMES[index] ?? ""}`, active: index === scene, run: () => app.scenes.setRound(round, index) })) },
      // What the mouse does by carrying the tile, for a finger and for the keyboard.
      { kind: "action", label: "Eine Runde früher", disabled: round === 0, run: () => app.scenes.moveRound(round, round - 1) },
      { kind: "action", label: "Eine Runde später", disabled: round >= project.order.length - 1, run: () => app.scenes.moveRound(round, round + 1) },
      { kind: "action", label: "Herausnehmen", hint: "Entf", disabled: project.order.length <= 1, run: () => app.scenes.removeRound(round) },
    ],
  };
}

function hubMenu(app: App, doors: MenuDoors): MenuSpec {
  return {
    title: "Kreisel",
    rows: [
      { kind: "action", label: app.playing ? "Anhalten" : "Starten", hint: "Leertaste", run: () => app.togglePlay() },
      { kind: "action", label: app.engine.recording ? "Aufnahme beenden" : "Aufnehmen", run: () => void app.files.toggleRecording() },
      { kind: "action", label: "Alle Ringe würfeln", run: () => app.rings.diceAll() },
      { kind: "action", label: "Rückgängig", hint: "Strg+Z", disabled: !app.store.canUndo, keep: true, run: () => app.undo() },
      { kind: "action", label: "Wiederholen", hint: "Strg+Y", disabled: !app.store.canRedo, keep: true, run: () => app.redo() },
      { kind: "heading", label: "Weitergeben" },
      { kind: "action", label: "Link kopieren", run: () => void app.files.share() },
      { kind: "action", label: "Reihum …", run: () => doors.relay() },
      { kind: "action", label: "Als Opus speichern", run: () => void app.files.exportSound() },
      { kind: "heading", label: "Hilfe" },
      { kind: "action", label: "Hilfe und Tasten", hint: "?", run: () => doors.help() },
    ],
  };
}

function weatherMenu(app: App): MenuSpec {
  const scene = currentScene(app.project);
  const rows: MenuRow[] = [
    { kind: "action", label: "Wetter malen …", run: () => app.weather.focus() },
    { kind: "action", label: "Würfeln", keep: true, run: () => app.weather.dice() },
    { kind: "action", label: "Alles aufklaren", disabled: !hasWeather(scene), run: () => app.weather.clear() },
  ];
  // What lies in the sky can be taken away kind by kind, or held still.
  WEATHER_NAMES.forEach((name, kind) => {
    if (!hasWeather(scene, kind)) return;
    rows.push({
      kind: "choice",
      label: `${name}: ${windName(scene.wind[kind] ?? 0)}`,
      options: [
        { label: "anhalten", title: `Den Wind von ${name} anhalten`, disabled: (scene.wind[kind] ?? 0) === 0, run: () => app.weather.setWind(kind, 0) },
        { label: "weg", title: `${name} wegnehmen`, run: () => app.weather.clear(kind) },
      ],
    });
  });
  return { title: "Wetter", color: "#3d7edb", rows };
}

/** The menu for what the right button landed on, or `null` when there is nothing to offer (any more). */
export function buildMenu(app: App, target: ContextTarget, doors: MenuDoors): MenuSpec | null {
  if (target.kind === "ring") return ringMenu(app, target.track, target.step);
  if (target.kind === "piece") return pieceMenu(app, target.bar, doors);
  if (target.kind === "build") return kitMenu(app, target.drop);
  if (target.kind === "roster") return rosterMenu(app, target.bar);
  if (target.kind === "chord") return chordMenu(app, target.slot);
  if (target.kind === "scene") return sceneMenu(app, target.index);
  if (target.kind === "round") return roundMenu(app, target.round);
  if (target.kind === "weather") return weatherMenu(app);
  return hubMenu(app, doors);
}
