import { byId, el } from "./dom";
import type { Panels } from "./panels";

/*
 * The help: every key, with what stands on it on this keyboard.
 */
export class HelpDialog {

  constructor(private readonly panels: Panels) {}

  show(): void {
    const dialog = byId<HTMLDialogElement>("help");
    if (!dialog.open) dialog.showModal();
  }

  build(): void {
    const key = (code: string): string => this.panels.keyLabel(code);
    const rows: [string, string][] = [
      ["Leertaste", "Start und Stopp"],
      ["Menütaste", "das Menü für den Ring und den Schritt am Zeiger (auch Umschalt+F10)"],
      ["1 bis 7", "Ring wählen · mit Umschalt stumm"],
      [`${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")}`, "Werkzeug: Setzen, Betonen, Zufall, Wirbel, Länge (am Kick-Ring: Beben)"],
      [`${key("KeyA")} bis ${key("KeyK")}`, "den Ring von Hand spielen (acht Stufen)"],
      [key("KeyL"), "Einspielen: Gespieltes landet im Ring"],
      [`${key("KeyZ")} ${key("KeyX")} ${key("KeyC")} ${key("KeyV")} ${key("KeyB")} halten`, "Effekte: Dumpf, Dünn, Stotter, Echo, Pause · mit Umschalt rasten sie ein"],
      ["← →", "Zeiger auf dem Ring · mit Umschalt den Ring drehen"],
      ["↑ ↓", "Ring wechseln · mit Umschalt alles höher oder tiefer"],
      ["Eingabe", "am Zeiger setzen oder löschen"],
      ["+ −", "Ton am Zeiger höher oder tiefer"],
      [key("KeyN"), "Ring würfeln · mit Umschalt nur variieren"],
      [`${key("KeyU")} ${key("KeyI")}`, `voriger und nächster Klang aus der Palette · ${key("KeyP")} zeigt alle 50`],
      ["Im Fenster der Stimme", "Eingabe singt die Zeile vor · ein Bindestrich trennt eine Silbe, wo du willst · Esc fertig"],
      ["An der Werkbank", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} Schlägel weich und hart, Zupfen, Streichen, Blasen · ${key("KeyN")} würfeln · Esc fertig`],
      ["Im Malkasten", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} Pinsel und Radierer · ${key("KeyT")} Dicke · ${key("KeyN")} würfeln · Entf nimmt den letzten Strich · Esc fertig`],
      [key("KeyM"), "Ring stumm · mit Umschalt allein hören"],
      [key("KeyO"), "Bühne: nur das Rad, im Dunkeln · Esc zurück"],
      [", .", "Szene zurück oder vor"],
      ["Szenen und Folge", "der Schalter unter den Szenen sagt, was spielt: die Szene im Kreis, die Folge oder das Stück · die Folge liegt unter dem Rad, eine Kachel je Runde · eine Szene dorthin ziehen oder „+“ legt sie hinein · Klick auf eine Kachel springt beim nächsten Takt dorthin · ziehen ordnet um · Rechtsklick: noch einmal, andere Szene, früher oder später, herausnehmen (auch Entf)"],
      ["8", `den Stück-Ring wählen · dort: ← → Takt, + − Spannung, Eingabe spielt ab dem Takt, ${key("KeyK")} macht die acht Takte dort zum Break`],
      ["Techno-Stück", "Rechtsklick auf einen Takt des Stück-Rings: „Break“ für acht Takte, dort setzen Kick und Nachbeben aus; wo die Kick wiederkommt oder die Spannung springt, ist ein Drop · im Feld des Stücks: Fills alle acht Takte"],
      ["Spannung", "im Feld des Stücks: „Bewegt“ öffnet, was die Spannung außer den Einsätzen bewegt, jedes aus, sanft oder deutlich · Hi-Hat öffnet sich · Bass, Akkorde und Melodie werden heller · die Kick wächst · leise Schläge fallen unten weg · Zerre zum Gipfel · mehr Hall, wo wenig los ist"],
      ["Phrasen und Effekte", "im Feld des Stücks: „Phrasen-Enden“ öffnet, was alle acht Takte von selbst passiert: Fills, die letzte Kick fehlt, ein Crash auf die Eins alle 16 oder 32 Takte, ein Rückwärts-Becken · Rechtsklick auf einen Takt: „Effekt“ legt Dumpf, Dünn, Stotter, Echo oder Pause auf diesen einen Takt, ein Punkt am Rand zeigt es"],
      ["Spannung spielen", `die Effekt-Taste „Build-up“ (${key("IntlBackslash")}, links neben den anderen fünf) baut auf, solange sie gehalten ist: Riser und Snare-Roll steigen, die Tiefen gehen; beim Loslassen kommt der Drop auf die nächste Eins · am Stück-Ring: ${key("KeyE")} schaltet „Einspielen“, dann schreiben Mausrad oder ↑ ↓ die Spannung in die Linie, während das Stück läuft`],
      ["Sog", "im Wetter-Feld hat jedes Wetter neben dem Wind seine Gezeiten: Über so viele Takte schwillt es an und ab (4 bis 64, auch 12 oder 20) · die Statuszeile sagt, nach wie vielen Takten ungleich lange Ringe wieder zusammenfallen und wie weit ein Ring hinter der Kick liegt · Rechtsklick auf die Mitte: „Alle acht Takte neu ausrichten“"],
      ["Bogen", "Rechtsklick auf „Würfeln“ im Feld des Stücks: eine Form würfeln (Plateau, Zwei Drops, Wellen, Lang gezogen) · solange das Stück spielt, zählt die Statuszeile die Takte bis zum nächsten Drop · im Menü des Stücks: „Protokoll“ schreibt auf, wer in welchen acht Takten spielt"],
      ["Build-up", "ein roter Keil am Rand des Stück-Rings zeigt jeden Drop, die Rampe davor seinen Build-up · Klick auf den Keil: der Baukasten dieses Drops · Größe (keiner, klein, mittel, groß) stellt alles auf einmal, darunter jede Zutat einzeln: Länge, Riser, Snare-Roll, Tiefen raus, Hall-Wolke, leiser werden, letzter Takt ohne Kick oder Hi-Hat, Lücke vor dem Drop, später Drop · im Feld des Stücks: der Build-up für alle Drops"],
      ["Einsätze", `am Stück-Ring: ${key("KeyQ")} malt die Spannung, ${key("KeyW")} zeigt die Einsätze · dann zeigen die sieben Ringe das ganze Stück, gefüllt heißt: der Ring spielt dort · ein Klick schaltet das für acht Takte um, ziehen malt weiter · heller Rand: spielt dort immer, gestrichelt: pausiert, sonst entscheidet die Spannung · Rechtsklick: alle sieben Ringe dieser Takte · mit den Tasten: ← → Phrase, ↑ ↓ Ring, Eingabe schaltet um`],
      ["9", `das Wetter wählen · dort: ${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} ${key("KeyY")} Nebel, Sonne, Wolken, Regen, Funken, Hagel · ${key("KeyN")} würfeln · Entf nimmt das gewählte Wetter weg`],
      ["Am Namen „Kreisel“", "neu anfangen: leer, mit dem Techno-Kreisel oder dem Werks-Kreisel · Stil der Würfel: Bei „Techno“ werfen sie Kick auf jedem Schlag, offene Hi-Hat dazwischen und Acid-Linien, das Stück bekommt Abschnitte von 16 und 32 Takten"],
      ["Härte", "„Zerre“ im Feld eines Rings treibt ihn in die Verzerrung (Funken aus dem Wetter kommen obendrauf) · „Druck“ am Lautsprecher in der Leiste presst alles zusammen: lauter, dichter, die Tiefen in der Mitte"],
      ["Acid-Maschine", "für Bass und Melodie, unten in der Klang-Palette · das Klangfeld ist ihr Filter, darunter Biss, Dauer, Welle und die Filterfahrt · ein Ton, der in den nächsten hineinreicht, gleitet in ihn (Rechtsklick auf den Ton: „In den nächsten ziehen“)"],
      ["Techno-Klänge", "im Techno-Kreisel beginnt die Palette jedes Rings mit seiner Techno-Gruppe (zehn der fünfzig), und „Würfeln“ nimmt einen von ihnen · die Hi-Hat ist dort eine Stimme wie an einer Drum-Machine: Ein geschlossener Schlag schneidet den offenen davor ab · ein Becken auf dem Hi-Hat-Ring bekommt beim Würfeln einen Takt statt offener Schläge"],
      ["In der Leiste", "Lautsprecher: Lautstärke und Druck · „Teilen“: Link kopieren oder reihum · der Pfeil an „Aufnehmen“: als Datei speichern · am Rad: Bühne und Lichtspiel"],
      ["Strg+Z", "Rückgängig · mit Umschalt wiederholen"],
      ["?", "diese Hilfe"],
    ];
    const list = byId("help-keys");
    list.replaceChildren(...rows.flatMap(([keys, what]) => [el("dt", "", keys), el("dd", "", what)]));
    const commit: unknown = import.meta.env.VITE_APP_COMMIT;
    byId("version").textContent = typeof commit === "string" && commit ? `Kreisel, Stand ${commit.slice(0, 7)}` : "Kreisel, Entwicklungsstand";
  }
}
