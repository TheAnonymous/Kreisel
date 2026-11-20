import { Engine, renderFile } from "../audio/engine";
import { decodeLink, encodeLink } from "../codec";
import { clone } from "../model";
import type { App } from "./app";

/** How a saved file's format is named; a WAV says why it is not Opus. */
const FORMATS = { opus: "Opus", wav: "WAV (dieser Browser schreibt kein Opus)" } as const;

function download(blob: Blob, name: string): void {
  // Handed over without a type: Firefox looks into a file it knows the type of and renames an Opus file to ".ogx".
  const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/*
 * What leaves the page and comes into it: links, saved sound, recordings.
 */
export class FileDesk {
  /** 0..1 while a file of the sound is being rendered. */
  exporting: number | null = null;

  constructor(private readonly app: App) {}

  /**
   * Copies the link that holds the whole Kreisel. Where the page may not copy, the link goes into the address bar
   * instead; the answer says which of the two happened.
   */
  async copyLink(): Promise<"copied" | "in address bar"> {
    const link = `${location.origin}${location.pathname}#k=${await encodeLink(this.app.store.project)}`;
    try {
      await navigator.clipboard.writeText(link);
      return "copied";
    } catch {
      history.replaceState(null, "", link);
      return "in address bar";
    }
  }

  async share(): Promise<void> {
    if ((await this.copyLink()) === "copied") {
      this.app.say("Link kopiert. Wer ihn öffnet, bekommt eine eigene Kopie deines Kreisels.");
      this.app.onDeed({ what: "share" });
    } else {
      this.app.say("Der Link steht jetzt in der Adresszeile: von dort kopieren.");
    }
  }

  /** Opens a Kreisel from a link's `#k=`; the one on the table is kept for "Zurück". */
  async openLink(hash: string): Promise<void> {
    const text = /[#&]k=([^&]+)/.exec(hash)?.[1];
    if (!text) return;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    try {
      const project = await decodeLink(text);
      this.app.relay.look(null);
      this.app.store.backup();
      this.app.store.replace(project);
      const relay = project.relay;
      const last = relay?.turns[relay.turns.length - 1];
      const back = { label: "Zurück zu meinem", run: () => this.app.undo() };
      if (!relay || !last) this.app.say("Ein geteilter Kreisel. Deiner ist nicht weg.", back);
      else if (relay.rule === 2 && !relay.open) this.app.say(`Stille Post von ${last.name}: Du hörst nur den Ring davor. Bau deinen dazu und schick den Link weiter.`, back);
      else this.app.say(`Reihum: ${last.name} hat Zug ${relay.turns.length} gemacht. Du bist dran.`, back);
    } catch {
      this.app.say("Dieser Link ließ sich nicht öffnen.");
    }
  }

  /** Saves what the Kreisel plays as a file: Opus, or WAV where this browser cannot write Opus. */
  async exportSound(): Promise<void> {
    if (this.exporting !== null) return;
    this.exporting = 0;
    this.app.notify();
    try {
      const file = await renderFile(clone(this.app.project), (share) => {
        this.exporting = share;
        this.app.notify();
      });
      download(file.blob, `kreisel.${file.kind}`);
      const what = this.app.project.piece.on ? "Das ganze Stück" : this.app.project.chain ? "Die ganze Folge" : "Die Szene";
      this.app.say(`${what} als ${FORMATS[file.kind]} gespeichert${this.app.project.piece.on || this.app.project.chain ? "" : " (zweimal durch die Akkorde)"}.`);
    } catch {
      this.app.say("Die Datei konnte nicht erzeugt werden.");
    } finally {
      this.exporting = null;
      this.app.notify();
    }
  }

  async toggleRecording(): Promise<void> {
    if (!Engine.canRecord) {
      this.app.say("Dieser Browser kann hier nicht aufnehmen. Nimm „Als Opus speichern“ im Menü.");
      return;
    }
    const wasRecording = this.app.engine.recording;
    const file = await this.app.engine.toggleRecording();
    if (!wasRecording) {
      if (!this.app.playing) await this.app.engine.start();
      this.app.say("Aufnahme läuft: alles, was du hörst und spielst. Noch ein Klick speichert sie.");
    } else if (file) {
      download(file.blob, `kreisel-aufnahme.${file.kind}`);
      this.app.say(`Aufnahme als ${FORMATS[file.kind]} gespeichert.`);
    } else {
      this.app.say("Die Aufnahme war still und wurde nicht gespeichert.");
    }
  }
}
