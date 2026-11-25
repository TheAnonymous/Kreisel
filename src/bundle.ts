import type { Recording } from "./sample-store";

/*
 * A Kreisel with its recordings, as one file. A link carries a Kreisel but
 * not the sound of its samples; whoever wants to pass both on saves this
 * file. It is the link, a list of the recordings, and then the recordings'
 * own bytes, one after the other, as they are kept.
 *
 *   "KREISEL1\n"   nine bytes, so that the file can be told from a sound
 *   length          four bytes, little-endian: how long the header is
 *   header          JSON: { link, sounds: [{ id, name, kind, source, seconds, added, size }] }
 *   sounds          the bytes of each sound, `size` bytes each, in the header's order
 */

const MARK = "KREISEL1\n";
/** A Kreisel has seven rings: a file that claims more recordings than a few for each is none. */
const MOST_SOUNDS = 28;
/** The ending such a file has. */
export const BUNDLE_ENDING = ".kreisel";

export interface Bundle {
  /** The Kreisel, as its link carries it (what comes after "#k="). */
  link: string;
  recordings: Recording[];
}

/** Whether these bytes begin as a Kreisel's file does. */
export function isBundle(bytes: Uint8Array): boolean {
  return bytes.length >= MARK.length + 4 && MARK.split("").every((letter, index) => bytes[index] === letter.charCodeAt(0));
}

export function packBundle(bundle: Bundle): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(JSON.stringify({
    link: bundle.link,
    // A recording's recipe is not written: where it has one, the Kreisel in `link` carries it.
    sounds: bundle.recordings.map(({ bytes, recipe: _recipe, ...said }) => ({ ...said, size: bytes.byteLength })),
  }));
  const size = MARK.length + 4 + header.length + bundle.recordings.reduce((sum, recording) => sum + recording.bytes.byteLength, 0);
  const file = new Uint8Array(size);
  file.set(new TextEncoder().encode(MARK), 0);
  new DataView(file.buffer).setUint32(MARK.length, header.length, true);
  file.set(header, MARK.length + 4);
  let at = MARK.length + 4 + header.length;
  for (const recording of bundle.recordings) {
    file.set(new Uint8Array(recording.bytes), at);
    at += recording.bytes.byteLength;
  }
  return file;
}

/**
 * A Kreisel's file, taken apart; `null` if it is none or is damaged. What it says about a sound is checked for its
 * shape only: whether a sound is the one its name says (the name is the hash of its bytes) and whether the Kreisel
 * names it at all is for whoever opens the file to check, before anything of it is kept.
 */
export function unpackBundle(bytes: Uint8Array): Bundle | null {
  if (!isBundle(bytes)) return null;
  try {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MARK.length, true);
    const start = MARK.length + 4;
    if (start + length > bytes.length) return null;
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))) as { link?: unknown; sounds?: unknown };
    if (typeof header.link !== "string" || !Array.isArray(header.sounds) || header.sounds.length > MOST_SOUNDS) return null;
    let at = start + length;
    const recordings: Recording[] = [];
    for (const item of header.sounds as unknown[]) {
      const said = (item ?? {}) as Partial<Record<keyof Recording | "size", unknown>>;
      const size = typeof said.size === "number" && Number.isInteger(said.size) && said.size >= 0 ? said.size : -1;
      if (typeof said.id !== "string" || !/^[0-9a-f]{16}$/.test(said.id) || size < 0 || at + size > bytes.length) return null;
      recordings.push({
        id: said.id,
        name: typeof said.name === "string" ? said.name.slice(0, 40) : "sample",
        kind: typeof said.kind === "string" ? said.kind.slice(0, 20) : "sound",
        source: said.source === "microphone" || said.source === "kreisel" ? said.source : "file",
        seconds: typeof said.seconds === "number" && Number.isFinite(said.seconds) ? Math.max(0, said.seconds) : 0,
        added: typeof said.added === "number" && Number.isFinite(said.added) ? said.added : 0,
        bytes: bytes.slice(at, at + size).buffer,
      });
      at += size;
    }
    return { link: header.link, recordings };
  } catch {
    return null;
  }
}
