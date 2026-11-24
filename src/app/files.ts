import { Engine, renderFile } from "../audio/engine";
import { decodeLink, encodeLink } from "../codec";
import { clone } from "../model";
import type { App } from "./app";

/** How a saved file's format is named; a WAV says why it is not Opus. */
const FORMATS = { opus: "Opus", wav: "WAV (this browser cannot write Opus)" } as const;

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
      this.app.say("Link copied. Whoever opens it gets their own copy of your Kreisel.");
      this.app.onDeed({ what: "share" });
    } else {
      this.app.say("The link is now in the address bar: copy it from there.");
    }
  }

  /** Opens a Kreisel from a link's `#k=`; the one on the table is kept for "Undo". */
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
      const back = { label: "Back to mine", run: () => this.app.undo() };
      if (!relay || !last) this.app.say("A shared Kreisel. Yours is not gone.", back);
      else if (relay.rule === 2 && !relay.open) this.app.say(`Telephone from ${last.name}: you hear only the ring before yours. Add your own and pass the link on.`, back);
      else this.app.say(`Pass around: ${last.name} made turn ${relay.turns.length}. It's your turn.`, back);
    } catch {
      this.app.say("This link could not be opened.");
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
      const what = this.app.project.piece.on ? "The whole piece" : this.app.project.chain ? "The whole row" : "The scene";
      this.app.say(`${what} saved as ${FORMATS[file.kind]}${this.app.project.piece.on || this.app.project.chain ? "" : " (twice through the chords)"}.`);
    } catch {
      this.app.say("The file could not be created.");
    } finally {
      this.exporting = null;
      this.app.notify();
    }
  }

  async toggleRecording(): Promise<void> {
    if (!Engine.canRecord) {
      this.app.say("This browser cannot record here. Use “Save as Opus” in the menu.");
      return;
    }
    const wasRecording = this.app.engine.recording;
    const file = await this.app.engine.toggleRecording();
    if (!wasRecording) {
      if (!this.app.playing) await this.app.engine.start();
      this.app.say("Recording: everything you hear and play. One more click saves it.");
    } else if (file) {
      download(file.blob, `kreisel-recording.${file.kind}`);
      this.app.say(`Recording saved as ${FORMATS[file.kind]}.`);
    } else {
      this.app.say("The recording was silent and was not saved.");
    }
  }
}
