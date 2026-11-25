import type { App } from "../app/app";
import type { MenuRow, MenuSpec } from "./menu";
import type { MenuDoors } from "./menus";

/*
 * The menus that hang under the bar's buttons. Each thing has one place, by
 * what it is about: the Kreisel itself under its name, the sound of the whole
 * under the speaker, giving it away under "Share", getting sound out of it
 * under "Record", the help under the question mark. A phone's bar has no
 * room for those buttons: there one sheet holds the same groups under their
 * names.
 */

export type BarMenu = "kreisel" | "klang" | "teilen" | "aufnahme" | "hilfe" | "alles";

/** What a bar menu can open that belongs to the panels, and how the stage's key is called on this keyboard. */
export interface BarDoors extends MenuDoors {
  tour(): void;
  stageKey: string;
}

/** The two controls for everything together. */
function soundRows(app: App): MenuRow[] {
  return [
    { kind: "slider", label: "Volume", id: "volume", value: app.project.volume, set: (volume) => app.setGlobal({ volume }, "volume"), reset: () => { app.resetGlobal("volume"); app.store.settle(); } },
    {
      kind: "slider",
      label: "Pressure",
      id: "pressure",
      value: app.project.pressure,
      title: "Presses everything together against the ceiling: louder, denser, harder. Below 150 Hz everything moves to the middle.",
      set: (pressure) => app.setGlobal({ pressure }, "pressure"),
      reset: () => { app.resetGlobal("pressure"); app.store.settle(); },
    },
  ];
}

/** Another Kreisel on the table. What lay there comes back with the message's "Undo". */
function startRows(app: App): MenuRow[] {
  return [
    { kind: "action", label: "Empty Kreisel", run: () => app.newProject(true) },
    { kind: "action", label: "Techno Kreisel", run: () => app.newProject(false, "techno") },
    { kind: "action", label: "Factory Kreisel", note: "What is on the table comes back with “Undo”.", run: () => app.newProject(false, "frei") },
  ];
}

/** In which style the dice throw. */
function diceRows(app: App): MenuRow[] {
  const techno = app.project.style === "techno";
  const turn = (to: boolean) => (): void => { if (techno !== to) app.toggleStyle(); };
  return [{
    kind: "choice",
    label: "Style",
    options: [
      { label: "Free", title: "The dice throw freely", active: !techno, run: turn(false) },
      { label: "Techno", title: "The dice throw techno: kick on every beat, open hi-hat in between, acid lines", active: techno, run: turn(true) },
    ],
  }];
}

function shareRows(app: App, doors: BarDoors): MenuRow[] {
  const link: MenuRow = { kind: "action", label: "Copy link", note: "The whole Kreisel in one link. Whoever opens it gets their own copy.", run: () => void app.files.share() };
  const turns = app.relay.round?.turns.length ?? 0;
  // A Kreisel whose rings play recordings: a link names them but cannot carry them, a file can.
  const file: MenuRow[] = app.project.tracks.some((track) => track.sample !== undefined)
    ? [{ kind: "action", label: "Save as a file with its recordings", note: "A link cannot carry sound. This file holds the Kreisel and the recordings its rings play; dropped on a Kreisel, it opens.", run: () => void app.sample.saveBundle() }]
    : [];
  // A round that is going comes first: its next turn is what "Share" is about now.
  if (turns > 0) return [{ kind: "action", label: `Pass around: turn ${turns + 1} is yours`, note: "Build your turn, finish it and send the link on.", run: () => doors.relay() }, link, ...file];
  return [link, ...file, { kind: "action", label: "Pass around: from hand to hand", note: "Everyone builds a turn and sends the link on.", run: () => doors.relay() }];
}

function soundOutRows(app: App, withRecording: boolean): MenuRow[] {
  const save: MenuRow = { kind: "action", label: "Save as Opus", note: "The scene or the whole piece as a file, without it having to play.", run: () => void app.files.exportSound() };
  if (!withRecording) return [save];
  const recording = app.engine.recording;
  return [
    { kind: "action", label: recording ? "Stop recording" : "Record what you hear", note: recording ? "The file comes as soon as you press." : "Keeps running until you press once more.", run: () => void app.files.toggleRecording() },
    save,
  ];
}

function viewRows(app: App, doors: BarDoors): MenuRow[] {
  return [
    { kind: "action", label: app.stage ? "Back from the stage" : "Stage: only the wheel, in the dark", hint: doors.stageKey, run: () => app.toggleStage() },
    { kind: "action", label: "Light show", checked: app.lights, keep: true, run: () => app.toggleLights() },
  ];
}

function helpRows(doors: BarDoors): MenuRow[] {
  return [
    { kind: "action", label: "Help and keys", hint: "?", run: () => doors.help() },
    { kind: "action", label: "Guide: first steps and lessons", run: () => doors.tour() },
  ];
}

const heading = (label: string): MenuRow => ({ kind: "heading", label });

/** The menu under one of the bar's buttons; "alles" is the phone's one sheet. */
export function barMenu(app: App, which: BarMenu, doors: BarDoors): MenuSpec {
  if (which === "klang") return { title: "All together", rows: soundRows(app) };
  if (which === "teilen") return { title: "Share", rows: shareRows(app, doors) };
  if (which === "aufnahme") return { title: "Record", rows: soundOutRows(app, true) };
  if (which === "hilfe") return { title: "Help", rows: helpRows(doors) };
  const kreisel: MenuRow[] = [heading("Start anew"), ...startRows(app), heading("The dice throw"), ...diceRows(app)];
  if (which === "kreisel") {
    return { title: "Kreisel", rows: [...kreisel, heading("Elsewhere"), { kind: "action", label: "To the Musik-Werkstatt", run: () => { location.href = "../"; } }] };
  }
  return {
    title: "Kreisel",
    rows: [
      heading("Sound"),
      ...soundRows(app),
      ...kreisel,
      heading("Share"),
      ...shareRows(app, doors),
      heading("Recording"),
      ...soundOutRows(app, false),
      heading("View"),
      ...viewRows(app, doors),
      heading("Help"),
      ...helpRows(doors),
    ],
  };
}
