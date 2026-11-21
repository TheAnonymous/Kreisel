import type { App } from "../app/app";
import type { MenuRow, MenuSpec } from "./menu";
import type { MenuDoors } from "./menus";

/*
 * The menus that hang under the bar's buttons. Each thing has one place, by
 * what it is about: the Kreisel itself under its name, the sound of the whole
 * under the speaker, giving it away under "Teilen", getting sound out of it
 * under "Aufnehmen", the help under the question mark. A phone's bar has no
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
    { kind: "slider", label: "Lautstärke", id: "volume", value: app.project.volume, set: (volume) => app.setGlobal({ volume }, "volume"), reset: () => { app.resetGlobal("volume"); app.store.settle(); } },
    {
      kind: "slider",
      label: "Druck",
      id: "pressure",
      value: app.project.pressure,
      title: "Presst alles zusammen gegen die Decke: lauter, dichter, härter. Unter 150 Hz rückt alles in die Mitte.",
      set: (pressure) => app.setGlobal({ pressure }, "pressure"),
      reset: () => { app.resetGlobal("pressure"); app.store.settle(); },
    },
  ];
}

/** Another Kreisel on the table. What lay there comes back with the message's "Zurück". */
function startRows(app: App): MenuRow[] {
  return [
    { kind: "action", label: "Leerer Kreisel", run: () => app.newProject(true) },
    { kind: "action", label: "Techno-Kreisel", run: () => app.newProject(false, "techno") },
    { kind: "action", label: "Werks-Kreisel", note: "Was auf dem Tisch liegt, kommt mit „Zurück“ wieder.", run: () => app.newProject(false, "frei") },
  ];
}

/** In which style the dice throw. */
function diceRows(app: App): MenuRow[] {
  const techno = app.project.style === "techno";
  const turn = (to: boolean) => (): void => { if (techno !== to) app.toggleStyle(); };
  return [{
    kind: "choice",
    label: "Stil",
    options: [
      { label: "Frei", title: "Die Würfel werfen frei", active: !techno, run: turn(false) },
      { label: "Techno", title: "Die Würfel werfen Techno: Kick auf jedem Schlag, offene Hi-Hat dazwischen, Acid-Linien", active: techno, run: turn(true) },
    ],
  }];
}

function shareRows(app: App, doors: BarDoors): MenuRow[] {
  const link: MenuRow = { kind: "action", label: "Link kopieren", note: "Der ganze Kreisel in einem Link. Wer ihn öffnet, bekommt eine eigene Kopie.", run: () => void app.files.share() };
  const turns = app.relay.round?.turns.length ?? 0;
  // A round that is going comes first: its next turn is what "Teilen" is about now.
  if (turns > 0) return [{ kind: "action", label: `Reihum: Zug ${turns + 1} ist deiner`, note: "Bau deinen Zug, schließ ihn ab und schick den Link weiter.", run: () => doors.relay() }, link];
  return [link, { kind: "action", label: "Reihum: von Hand zu Hand", note: "Jeder baut einen Zug und schickt den Link weiter.", run: () => doors.relay() }];
}

function soundOutRows(app: App, withRecording: boolean): MenuRow[] {
  const save: MenuRow = { kind: "action", label: "Als Opus speichern", note: "Die Szene oder das ganze Stück als Datei, ohne dass es spielen muss.", run: () => void app.files.exportSound() };
  if (!withRecording) return [save];
  const recording = app.engine.recording;
  return [
    { kind: "action", label: recording ? "Aufnahme beenden" : "Aufnehmen, was du hörst", note: recording ? "Die Datei kommt, sobald du drückst." : "Läuft mit, bis du noch einmal drückst.", run: () => void app.files.toggleRecording() },
    save,
  ];
}

function viewRows(app: App, doors: BarDoors): MenuRow[] {
  return [
    { kind: "action", label: app.stage ? "Zurück von der Bühne" : "Bühne: nur das Rad, im Dunkeln", hint: doors.stageKey, run: () => app.toggleStage() },
    { kind: "action", label: "Lichtspiel", checked: app.lights, keep: true, run: () => app.toggleLights() },
  ];
}

function helpRows(doors: BarDoors): MenuRow[] {
  return [
    { kind: "action", label: "Hilfe und Tasten", hint: "?", run: () => doors.help() },
    { kind: "action", label: "Tour: die ersten Schritte", run: () => doors.tour() },
  ];
}

const heading = (label: string): MenuRow => ({ kind: "heading", label });

/** The menu under one of the bar's buttons; "alles" is the phone's one sheet. */
export function barMenu(app: App, which: BarMenu, doors: BarDoors): MenuSpec {
  if (which === "klang") return { title: "Alles zusammen", rows: soundRows(app) };
  if (which === "teilen") return { title: "Teilen", rows: shareRows(app, doors) };
  if (which === "aufnahme") return { title: "Aufnehmen", rows: soundOutRows(app, true) };
  if (which === "hilfe") return { title: "Hilfe", rows: helpRows(doors) };
  const kreisel: MenuRow[] = [heading("Neu anfangen"), ...startRows(app), heading("Die Würfel werfen"), ...diceRows(app)];
  if (which === "kreisel") {
    return { title: "Kreisel", rows: [...kreisel, heading("Woanders hin"), { kind: "action", label: "Zur Musik-Werkstatt", run: () => { location.href = "../"; } }] };
  }
  return {
    title: "Kreisel",
    rows: [
      heading("Klang"),
      ...soundRows(app),
      ...kreisel,
      heading("Teilen"),
      ...shareRows(app, doors),
      heading("Aufnahme"),
      ...soundOutRows(app, false),
      heading("Ansicht"),
      ...viewRows(app, doors),
      heading("Hilfe"),
      ...helpRows(doors),
    ],
  };
}
