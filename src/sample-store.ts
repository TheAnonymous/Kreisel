/*
 * Where the browser keeps recordings. A Kreisel is its link, and sound is far
 * too big for a link: a ring's sample only names its recording. The
 * recordings themselves lie here, in the browser's own database, each under
 * the hash of its sound. So the same file brought in twice is kept once, a
 * file that was lost can be brought in again and is found to be the same, and
 * every Kreisel that names a recording finds it.
 *
 * A recording is kept as it came: the file's own bytes (an MP3 stays an MP3),
 * or what the microphone wrote. It is decoded when a ring needs it.
 *
 * Where the browser gives no database (a private window in some browsers),
 * the recordings last for this visit.
 */

/** A recording as it is kept. */
export interface Recording {
  /** Sixteen hex digits of the hash of `bytes`. */
  id: string;
  name: string;
  /** What kind of file it is, as the page says it ("WAV", "MP3", "Opus" …). */
  kind: string;
  /** Where it came from: a file, the microphone, or the Kreisel itself. */
  source: "file" | "microphone" | "kreisel";
  bytes: ArrayBuffer;
  /** How long it is, in seconds (known once it was decoded). */
  seconds: number;
  /** When it came in, in milliseconds since 1970. */
  added: number;
  /** For a record pressed from the Kreisel: the Kreisel it was made of, packed (see resample.ts). */
  recipe?: string;
}

/** A recording without its sound: what a list of them needs. */
export type Listed = Omit<Recording, "bytes"> & { size: number };

const DATABASE = "kreisel.aufnahmen.v1";
const SOUNDS = "klang";
const NAMES = "namen";

/** For this visit only, where there is no database. */
const visit = new Map<string, Recording>();
let database: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        // The sound and what is said about it lie apart, so that a list need not read every recording.
        request.result.createObjectStore(SOUNDS);
        request.result.createObjectStore(NAMES, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

function done(request: IDBRequest | IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    if (request instanceof IDBTransaction) {
      request.oncomplete = () => resolve();
      request.onabort = () => reject(request.error ?? new Error("the browser did not keep it"));
      request.onerror = () => reject(request.error ?? new Error("the browser did not keep it"));
    } else {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("the browser did not answer"));
    }
  });
}

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("the browser did not answer"));
  });
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The name a sound is kept under: sixteen hex digits of its SHA-256. The same sound always has the same name. */
export async function idOf(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return hex(new Uint8Array(digest)).slice(0, 16);
}

/** The same for a text (a recipe): the name the sound made from it is kept under. */
export const idOfText = (text: string): Promise<string> => idOf(new TextEncoder().encode(text));

/**
 * Keeps a recording. Says whether the browser will still have it tomorrow ("kept") or only until the page is closed
 * ("for this visit": there is no database, or it is full).
 */
export async function keepRecording(recording: Recording): Promise<"kept" | "for this visit"> {
  const base = await open();
  if (base) {
    try {
      const { bytes, ...listed } = recording;
      const transaction = base.transaction([SOUNDS, NAMES], "readwrite");
      transaction.objectStore(SOUNDS).put(bytes, recording.id);
      transaction.objectStore(NAMES).put({ ...listed, size: bytes.byteLength } satisfies Listed);
      await done(transaction);
      visit.delete(recording.id);
      return "kept";
    } catch {
      // Full, or not allowed: it stays for this visit.
    }
  }
  visit.set(recording.id, recording);
  return "for this visit";
}

/** The recording kept under `id`, or `null` if this browser does not have it. */
export async function recordingOf(id: string): Promise<Recording | null> {
  const here = visit.get(id);
  if (here) return here;
  const base = await open();
  if (!base) return null;
  try {
    const transaction = base.transaction([SOUNDS, NAMES], "readonly");
    const [bytes, listed] = await Promise.all([read<unknown>(transaction.objectStore(SOUNDS).get(id)), read<unknown>(transaction.objectStore(NAMES).get(id))]);
    if (!(bytes instanceof ArrayBuffer) || typeof listed !== "object" || listed === null) return null;
    const { size: _size, ...said } = listed as Listed;
    return { ...said, bytes };
  } catch {
    return null;
  }
}

/** Every recording this browser has, the newest first, without their sound. */
export async function listRecordings(): Promise<Listed[]> {
  const here = Array.from(visit.values(), ({ bytes, ...listed }): Listed => ({ ...listed, size: bytes.byteLength }));
  const base = await open();
  let kept: Listed[] = [];
  if (base) {
    try {
      kept = (await read<unknown[]>(base.transaction(NAMES, "readonly").objectStore(NAMES).getAll())).filter((item): item is Listed => typeof item === "object" && item !== null && typeof (item as Listed).id === "string");
    } catch {
      kept = [];
    }
  }
  const all = [...here, ...kept.filter((item) => !visit.has(item.id))];
  return all.sort((a, b) => b.added - a.added);
}

/** Forgets a recording. A ring that names it is silent until the recording is brought in again. */
export async function dropRecording(id: string): Promise<void> {
  visit.delete(id);
  const base = await open();
  if (!base) return;
  try {
    const transaction = base.transaction([SOUNDS, NAMES], "readwrite");
    transaction.objectStore(SOUNDS).delete(id);
    transaction.objectStore(NAMES).delete(id);
    await done(transaction);
  } catch {
    // It was not there, or the browser will not say: nothing to forget.
  }
}

/** Asks the browser not to clear the recordings away when room gets short. It may say no; that changes nothing here. */
export async function askToKeep(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) === true;
  } catch {
    return false;
  }
}
