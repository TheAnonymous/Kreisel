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
      ["8", "den Stück-Ring wählen · dort: ← → Takt, + − Spannung, Eingabe spielt ab dem Takt"],
      ["9", `das Wetter wählen · dort: ${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} ${key("KeyY")} Nebel, Sonne, Wolken, Regen, Funken, Hagel · ${key("KeyN")} würfeln · Entf nimmt das gewählte Wetter weg`],
      ["Hinter den drei Punkten", "Techno-Kreisel oder Werks-Kreisel laden · „Techno würfeln“: Die Würfel werfen Kick auf jedem Schlag, offene Hi-Hat dazwischen und Acid-Linien, das Stück bekommt Abschnitte von 16 und 32 Takten"],
      ["Strg+Z", "Rückgängig · mit Umschalt wiederholen"],
      ["?", "diese Hilfe"],
    ];
    const list = byId("help-keys");
    list.replaceChildren(...rows.flatMap(([keys, what]) => [el("dt", "", keys), el("dd", "", what)]));
    const commit: unknown = import.meta.env.VITE_APP_COMMIT;
    byId("version").textContent = typeof commit === "string" && commit ? `Kreisel, Stand ${commit.slice(0, 7)}` : "Kreisel, Entwicklungsstand";
  }
}
