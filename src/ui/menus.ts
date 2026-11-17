import type { App, ContextTarget } from "../app";
import { BODY_SOUND, currentScene, MAX_BARS, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MIN_BARS, MIN_STEPS, OWN_SOUND, patternOf, PITCH_MAX, PITCH_MIN, SCENE_NAMES, stepAt, TENSION_MAX, trackInfo, trackOf } from "../model";
import { chordName, pitchName } from "../music";
import { activeSteps } from "../patterns";
import { hasRumble, RUMBLE_SHAPES, shapeOf } from "../rumble";
import { hasWeather, WEATHER_NAMES, windName } from "../weather";
import { barCount } from "../piece";
import type { MenuRow, MenuSpec } from "./menu";

/*
 * What the right button offers, place by place: a hit, a ring, the piece, a
 * chord field, a scene, the hub. Each menu is rebuilt from the Kreisel as it
 * is now, so it stays true while its own rows change things.
 */

/** The windows a menu can open, which belong to the panels. */
export interface MenuDoors {
  relay(): void;
  help(): void;
}

const VELOCITIES = ["leise", "normal", "laut"] as const;
const CHANCES = ["immer", "75 %", "50 %", "25 %"] as const;

function ringMenu(app: App, track: number, step: number | null): MenuSpec | null {
  if (app.veiled(track)) return null;
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
        { kind: "choice", label: "Betonung", options: VELOCITIES.map((label, vel) => ({ label, active: note.vel === vel, run: () => app.setStep(track, at, { vel }) })) },
        { kind: "choice", label: "Zufall", options: CHANCES.map((label, chance) => ({ label, active: note.chance === chance, title: chance === 0 ? "Der Schlag kommt jedes Mal" : `Der Schlag kommt in ${label} der Runden`, run: () => app.setStep(track, at, { chance }) })) },
        { kind: "choice", label: "Wirbel", options: [1, 2, 3, 4].map((ratchet) => ({ label: String(ratchet), active: note.ratchet === ratchet, title: ratchet === 1 ? "Ein Schlag" : `${ratchet} schnelle Schläge`, run: () => app.setStep(track, at, { ratchet }) })) },
      );
      if (info.melodic) {
        const longest = Math.min(MAX_NOTE_LENGTH, pattern.len);
        rows.push({
          kind: "choice",
          label: `Länge ${note.len}`,
          options: [
            { label: "−", title: "Den Ton kürzer halten", disabled: note.len <= 1, run: () => app.setStep(track, at, { len: note.len - 1 }) },
            { label: "+", title: "Den Ton länger halten", disabled: note.len >= longest, run: () => app.setStep(track, at, { len: note.len + 1 }) },
          ],
        });
      }
      rows.push(
        {
          kind: "choice",
          label: `${info.pitchLabel}: ${pitchName(project, track, note.pitch, app.chordNow())}`,
          options: [
            { label: "−", title: "Tiefer", disabled: note.pitch <= PITCH_MIN, run: () => app.setStep(track, at, { pitch: note.pitch - 1 }) },
            { label: "+", title: "Höher", disabled: note.pitch >= PITCH_MAX, run: () => app.setStep(track, at, { pitch: note.pitch + 1 }) },
          ],
        },
        { kind: "action", label: "Schlag löschen", run: () => { app.removeNote(track, at, "menue"); app.endGesture(); } },
      );
    } else {
      rows.push({ kind: "action", label: "Schlag setzen", keep: true, run: () => { app.addNote(track, at, {}, "menue"); app.endGesture(); } });
    }
    rows.push({ kind: "heading", label: "Ganzer Ring" });
  }

  const copied = app.copied;
  rows.push(
    { kind: "action", label: "Würfeln", hint: "N", keep: true, run: () => app.diceRing(track) },
    { kind: "action", label: "Variieren", hint: "Umschalt+N", keep: true, run: () => app.varyRing(track) },
    {
      kind: "choice",
      label: "Drehen",
      options: [
        { label: "←", title: "Einen Schritt zurückdrehen", run: () => app.rotate(track, -1) },
        { label: "→", title: "Einen Schritt weiterdrehen", run: () => app.rotate(track, 1) },
      ],
    },
    {
      kind: "choice",
      label: `Schritte ${pattern.len}`,
      options: [
        { label: "−", title: "Den Ring einen Schritt kürzer machen", disabled: pattern.len <= MIN_STEPS, run: () => app.resizeRing(track, pattern.len - 1) },
        ...[8, 12, 16, 32].map((length) => ({ label: String(length), title: `${length} Schritte`, active: pattern.len === length, run: () => app.resizeRing(track, length) })),
        { label: "+", title: "Den Ring einen Schritt länger machen", disabled: pattern.len >= MAX_STEPS, run: () => app.resizeRing(track, pattern.len + 1) },
      ],
    },
    { kind: "choice", label: "Klang", options: info.sounds.map((label, sound) => ({ label, active: settings.sound === sound, run: () => app.setSound(track, sound) })) },
    {
      kind: "choice",
      label: "Eigener Klang",
      options: [
        { label: "Nehmen", active: settings.sound === OWN_SOUND, disabled: !settings.bild, title: settings.bild ? "Den gemalten Klang dieses Rings nehmen" : "Noch nicht gemalt", run: () => app.setSound(track, OWN_SOUND) },
        { label: "Malen …", title: "Den eigenen Klang dieses Rings malen", close: true, run: () => { app.select(track); app.openEasel(); } },
      ],
    },
    {
      kind: "choice",
      label: "Klangkörper",
      options: [
        { label: "Nehmen", active: settings.sound === BODY_SOUND, disabled: !settings.body, title: settings.body ? "Den gebauten Klangkörper dieses Rings nehmen" : "Noch nicht gebaut", run: () => app.setSound(track, BODY_SOUND) },
        { label: "Bauen …", title: "Den Klangkörper dieses Rings bauen", close: true, run: () => { app.select(track); app.openBench(); } },
      ],
    },
    ...(track === 0
      ? [{
          kind: "choice" as const,
          label: "Nachbeben",
          options: [
            ...RUMBLE_SHAPES.map((label, shape) => ({ label, active: shapeOf(pattern, currentScene(project).rumble) === shape, title: `Nachbeben in der Form „${label}“ um die Kicks legen`, run: () => app.shapeRumble(shape) })),
            { label: "Aus", active: !hasRumble(currentScene(project), pattern.len), title: "Das Nachbeben wegnehmen", run: () => app.shapeRumble(-1) },
          ],
        }]
      : []),
    {
      kind: "choice",
      label: "Hören",
      options: [
        { label: "Stumm", active: settings.mute, title: "Diesen Ring stumm schalten (M)", run: () => app.toggleMute(track) },
        { label: "Allein", active: app.solo === track, title: "Nur diesen Ring hören (Umschalt+M)", run: () => app.toggleSolo(track) },
      ],
    },
    {
      kind: "choice",
      label: "Wetter",
      options: [
        { label: "Malen …", title: "Wetter auf das Rad malen: Effekte, die mit dem Wind ziehen", close: true, run: () => app.focusWeather() },
        { label: "Aufklaren", title: "Das Wetter über diesem Ring wegnehmen", disabled: !hasWeather(currentScene(project), undefined, track), run: () => app.clearWeather(undefined, track) },
      ],
    },
    {
      kind: "choice",
      label: "Muster",
      options: [
        { label: "Kopieren", title: "Das Muster dieses Rings merken", close: true, run: () => app.copyRing(track) },
        { label: "Einfügen", title: copied ? `Das Muster von ${trackInfo(copied.track).name} hierher legen` : "Noch nichts kopiert", disabled: !copied, run: () => app.pasteRing(track) },
        { label: "Leeren", title: "Alle Schläge dieses Rings entfernen", disabled: activeSteps(pattern).length === 0, run: () => app.clearRing(track) },
      ],
    },
  );
  return { title: at === null ? info.name : `${info.name} · Schritt ${at + 1}`, color: info.color, rows };
}

function pieceMenu(app: App, bar: number | null): MenuSpec {
  const project = app.project;
  const piece = project.piece;
  const count = barCount(piece);
  const at = bar !== null && bar < count ? bar : null;
  const rows: MenuRow[] = [];
  if (at !== null) {
    const tension = piece.tension[at] ?? 0;
    const from = Math.floor(at / 4) * 4;
    rows.push(
      { kind: "action", label: "Ab hier spielen", run: () => app.playFrom(at) },
      {
        kind: "choice",
        label: `Spannung ${Math.round((tension / TENSION_MAX) * 100)} %`,
        options: [
          { label: "−", title: "Weniger los in diesem Takt", disabled: tension <= 0, run: () => app.paintTension(at, tension - 2, `spannung-menue${at}`) },
          { label: "+", title: "Mehr los in diesem Takt", disabled: tension >= TENSION_MAX, run: () => app.paintTension(at, tension + 2, `spannung-menue${at}`) },
        ],
      },
      {
        kind: "choice",
        label: `Szene, Takt ${from + 1} bis ${Math.min(count, from + 4)}`,
        options: project.scenes.flatMap((scene, index) => (scene ? [{ label: SCENE_NAMES[index] ?? "", title: `Szene ${SCENE_NAMES[index]} auf diese vier Takte legen`, active: piece.scenes[at] === index, run: () => app.sceneForBars(at, index) }] : [])),
      },
      { kind: "heading", label: "Ganzes Stück" },
    );
  }
  rows.push(
    { kind: "action", label: "Nach dem Stück spielen", checked: piece.on, keep: true, run: () => app.togglePiece() },
    { kind: "action", label: "Würfeln", hint: "N", keep: true, run: () => app.diceThePiece() },
    { kind: "action", label: "Glätten", keep: true, run: () => app.smoothThePiece() },
    {
      kind: "choice",
      label: `Takte ${count}`,
      options: [
        { label: "−", title: "Vier Takte kürzer", disabled: count <= MIN_BARS, run: () => app.resizeThePiece(count - 4) },
        ...[16, 32, 64].map((bars) => ({ label: String(bars), title: `${bars} Takte`, active: count === bars, run: () => app.resizeThePiece(bars) })),
        { label: "+", title: "Vier Takte länger", disabled: count >= MAX_BARS, run: () => app.resizeThePiece(count + 4) },
      ],
    },
  );
  return { title: at === null ? "Stück" : `Stück · Takt ${at + 1}`, rows };
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
      { kind: "choice", label: "Akkord", options: Array.from({ length: 7 }, (_, index) => ({ label: chordName(project.root, project.scale, index), active: degree === index, run: () => app.setChord(slot, index) })) },
      { kind: "action", label: "Takt verdoppeln", disabled: chords.length >= MAX_CHORDS, keep: true, run: () => app.insertBar(slot) },
      { kind: "action", label: "Takt entfernen", disabled: chords.length <= 1, run: () => app.removeBar(slot) },
    ],
  };
}

function sceneMenu(app: App, index: number): MenuSpec | null {
  const project = app.project;
  const name = SCENE_NAMES[index];
  if (name === undefined) return null;
  if (!project.scenes[index]) {
    return { title: `Szene ${name} (leer)`, rows: [{ kind: "action", label: `Als Kopie von ${SCENE_NAMES[project.scene]} anlegen`, run: () => app.pickScene(index) }] };
  }
  const free = app.freeScene();
  const filled = project.scenes.filter((scene) => scene !== null).length;
  return {
    title: `Szene ${name}`,
    rows: [
      { kind: "action", label: "Hierher wechseln", disabled: project.scene === index, run: () => app.pickScene(index) },
      { kind: "action", label: free >= 0 ? `Kopie nach ${SCENE_NAMES[free]} legen` : "Kopie anlegen (kein Platz frei)", disabled: free < 0, run: () => app.copyScene(index) },
      { kind: "action", label: "Im ganzen Stück spielen", run: () => app.sceneForBars(0, index, true) },
      { kind: "action", label: "Leeren", hint: "Umschalt+Klick", disabled: filled <= 1, run: () => app.clearScene(index) },
    ],
  };
}

function hubMenu(app: App, doors: MenuDoors): MenuSpec {
  return {
    title: "Kreisel",
    rows: [
      { kind: "action", label: app.playing ? "Anhalten" : "Starten", hint: "Leertaste", run: () => app.togglePlay() },
      { kind: "action", label: app.engine.recording ? "Aufnahme beenden" : "Aufnehmen", run: () => void app.toggleRecording() },
      { kind: "action", label: "Alle Ringe würfeln", run: () => app.diceAll() },
      { kind: "action", label: "Rückgängig", hint: "Strg+Z", disabled: !app.store.canUndo, keep: true, run: () => app.undo() },
      { kind: "action", label: "Wiederholen", hint: "Strg+Y", disabled: !app.store.canRedo, keep: true, run: () => app.redo() },
      { kind: "heading", label: "Weitergeben" },
      { kind: "action", label: "Link kopieren", run: () => void app.share() },
      { kind: "action", label: "Reihum …", run: () => doors.relay() },
      { kind: "action", label: "Als Opus speichern", run: () => void app.exportSound() },
      { kind: "heading", label: "Hilfe" },
      { kind: "action", label: "Hilfe und Tasten", hint: "?", run: () => doors.help() },
    ],
  };
}

function weatherMenu(app: App): MenuSpec {
  const scene = currentScene(app.project);
  const rows: MenuRow[] = [
    { kind: "action", label: "Wetter malen …", run: () => app.focusWeather() },
    { kind: "action", label: "Würfeln", keep: true, run: () => app.diceWeather() },
    { kind: "action", label: "Alles aufklaren", disabled: !hasWeather(scene), run: () => app.clearWeather() },
  ];
  // What lies in the sky can be taken away kind by kind, or held still.
  WEATHER_NAMES.forEach((name, kind) => {
    if (!hasWeather(scene, kind)) return;
    rows.push({
      kind: "choice",
      label: `${name}: ${windName(scene.wind[kind] ?? 0)}`,
      options: [
        { label: "anhalten", title: `Den Wind von ${name} anhalten`, disabled: (scene.wind[kind] ?? 0) === 0, run: () => app.setWind(kind, 0) },
        { label: "weg", title: `${name} wegnehmen`, run: () => app.clearWeather(kind) },
      ],
    });
  });
  return { title: "Wetter", color: "#3d7edb", rows };
}

/** The menu for what the right button landed on, or `null` when there is nothing to offer (any more). */
export function buildMenu(app: App, target: ContextTarget, doors: MenuDoors): MenuSpec | null {
  if (target.kind === "ring") return ringMenu(app, target.track, target.step);
  if (target.kind === "piece") return pieceMenu(app, target.bar);
  if (target.kind === "chord") return chordMenu(app, target.slot);
  if (target.kind === "scene") return sceneMenu(app, target.index);
  if (target.kind === "weather") return weatherMenu(app);
  return hubMenu(app, doors);
}
