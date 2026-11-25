/*
 * What a file is, and the two plain formats read by hand.
 *
 * A browser decodes WAV, MP3, Ogg Vorbis, Opus, FLAC, AAC and WebM by itself.
 * It does not read AIFF, which many sample packs still come in, and now and
 * then it turns down a WAV it finds odd. So AIFF and AIFF-C are read here,
 * and WAV as well for when the browser will not. The first bytes of a file
 * also say what it is, so that the page can call it by its name and say why
 * it could not be read ("a MIDI file" has notes in it, no sound). Plain
 * arithmetic on bytes: no browser needed.
 */

export type SoundFormat = "wav" | "aiff" | "mp3" | "ogg-vorbis" | "ogg-opus" | "ogg-flac" | "ogg" | "flac" | "mp4" | "aac" | "webm" | "caf" | "midi" | "unknown";

/** What the page calls each kind of file. */
const LABELS: Record<SoundFormat, string> = {
  wav: "WAV",
  aiff: "AIFF",
  mp3: "MP3",
  "ogg-vorbis": "Ogg Vorbis",
  "ogg-opus": "Opus",
  "ogg-flac": "FLAC",
  ogg: "Ogg",
  flac: "FLAC",
  mp4: "AAC (M4A)",
  aac: "AAC",
  webm: "WebM",
  caf: "CAF",
  midi: "a MIDI file",
  unknown: "not a sound I know",
};

/** Whether the letters of `text` stand at `at`. Past the end of what was given they do not. */
function has(bytes: Uint8Array, at: number, text: string): boolean {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) if (bytes[at + index] !== text.charCodeAt(index)) return false;
  return true;
}

/** The layer (1, 2 or 3) of an MPEG audio frame that begins at `at`; 0 if none does. */
function mpegLayer(bytes: Uint8Array, at: number): number {
  const second = bytes[at + 1];
  const third = bytes[at + 2];
  if (bytes[at] !== 0xff || second === undefined || third === undefined) return 0;
  if ((second & 0xe0) !== 0xe0) return 0;
  const layer = (second >> 1) & 3;
  // A layer or a version of 00 or 01 that the standard keeps to itself, a bit rate or a sample rate it does not have.
  if (layer === 0 || ((second >> 3) & 3) === 1) return 0;
  if (third >> 4 === 15 || ((third >> 2) & 3) === 3) return 0;
  return 4 - layer;
}

/** A stream of bare frames: AAC as ADTS (with or without its checksum) or MPEG layer III; `null` for neither. */
function framesAt(bytes: Uint8Array, at: number): SoundFormat | null {
  if (bytes[at] === 0xff && ((bytes[at + 1] ?? 0) & 0xf6) === 0xf0) return "aac";
  return mpegLayer(bytes, at) === 3 ? "mp3" : null;
}

/** Which codec an Ogg file carries: its first page holds the codec's own head. */
function oggCodec(bytes: Uint8Array): SoundFormat {
  const segments = bytes[26];
  if (segments === undefined) return "ogg";
  const at = 27 + segments;
  if (has(bytes, at, "OpusHead")) return "ogg-opus";
  if (has(bytes, at, "\u0001vorbis")) return "ogg-vorbis";
  if (has(bytes, at, "\u007fFLAC")) return "ogg-flac";
  return "ogg";
}

/**
 * What lies behind an ID3 tag. Nearly always that is an MP3, and it is called
 * one where the tag (a cover picture can be large) runs past what was given.
 * FLAC and AAC files are tagged this way now and then; anything else behind a
 * tag is nothing a browser plays.
 */
function behindTag(bytes: Uint8Array, tags = 1): SoundFormat {
  if (bytes.length < 10) return "mp3";
  // The tag's length is four bytes of seven bits each, so that it can never look like the start of a frame.
  const size = (((bytes[6] ?? 0) & 0x7f) << 21) | (((bytes[7] ?? 0) & 0x7f) << 14) | (((bytes[8] ?? 0) & 0x7f) << 7) | ((bytes[9] ?? 0) & 0x7f);
  let at = 10 + size + ((bytes[5] ?? 0) & 0x10 ? 10 : 0);
  // Some taggers leave a stretch of nothing behind the tag.
  while (bytes[at] === 0) at += 1;
  if (at + 4 > bytes.length) return "mp3";
  if (has(bytes, at, "fLaC")) return "flac";
  // A second tag behind the first happens; a file that is tags all the way down is no sound.
  if (has(bytes, at, "ID3")) return tags < 4 ? behindTag(bytes.subarray(at), tags + 1) : "unknown";
  return framesAt(bytes, at) ?? "unknown";
}

function formatOf(bytes: Uint8Array): SoundFormat {
  // RF64 is a WAV for more than four gigabytes: it is one by name, though nothing here reads it.
  if ((has(bytes, 0, "RIFF") || has(bytes, 0, "RF64")) && has(bytes, 8, "WAVE")) return "wav";
  if (has(bytes, 0, "FORM") && (has(bytes, 8, "AIFF") || has(bytes, 8, "AIFC"))) return "aiff";
  if (has(bytes, 0, "OggS")) return oggCodec(bytes);
  if (has(bytes, 0, "fLaC")) return "flac";
  if (has(bytes, 0, "ID3")) return behindTag(bytes);
  if (has(bytes, 4, "ftyp")) return "mp4";
  if (has(bytes, 0, "\u001aEß£")) return "webm";
  if (has(bytes, 0, "caff")) return "caf";
  if (has(bytes, 0, "MThd")) return "midi";
  return framesAt(bytes, 0) ?? "unknown";
}

/** What a file is by its first bytes. `label` is what the page calls it ("WAV", "AIFF", "MP3", "Ogg Vorbis", "Opus", "FLAC", "AAC (M4A)", "AAC", "WebM", "CAF", "a MIDI file", "not a sound I know"). */
export function sniff(bytes: Uint8Array): { format: SoundFormat; label: string } {
  const format = formatOf(bytes);
  return { format, label: LABELS[format] };
}

/** The endings of sound files, lower case, with their dots (".wav", ".wave", ".aif", ".aiff", ".aifc", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".mp4", ".aac", ".webm", ".weba", ".caf"). */
export const ENDINGS: readonly string[] = [".wav", ".wave", ".aif", ".aiff", ".aifc", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".mp4", ".aac", ".webm", ".weba", ".caf"];

/** The value for a file input's `accept`: every kind of sound file, by type and by ending. */
export const ACCEPT: string = ["audio/*", ...ENDINGS].join(",");

/** Whether a dropped or pasted file may be a sound, by its name and the type the browser gives it (either is enough; an empty type with a known ending counts). */
export function soundLike(name: string, type: string): boolean {
  const kind = type.trim().toLowerCase();
  if (kind.startsWith("audio/") || kind === "application/ogg") return true;
  const lower = name.trim().toLowerCase();
  return ENDINGS.some((ending) => lower.endsWith(ending));
}

/** The most characters a sample's name has. */
const NAME_LENGTH = 24;

/** A name for a sample from a file's name: without its ending and its folders, control characters and the characters `. , | # & = ? %` and slashes turned into spaces, runs of spaces made one, trimmed, at most 24 characters (cut at a space where one is near); "sample" if nothing is left. (The name travels in a link as plain text between dots, so a dot may not be in it.) */
export function sampleName(fileName: string): string {
  const file = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  // An ending is a few letters and digits behind the last dot; "take.2" has none, its 2 belongs to the name.
  const bare = file.replace(/\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,5}$/i, "");
  // Put together the way most systems write it: a Mac hands over "ü" as a "u" and two dots, which would count as two.
  const clean = bare.normalize("NFC").replace(/[\p{Cc}.,|#&=?%/\\]/gu, " ").replace(/\s+/g, " ").trim();
  const letters = Array.from(clean);
  if (letters.length <= NAME_LENGTH) return clean || "sample";
  let end = NAME_LENGTH;
  // Rather a whole word less than half a word: back to the last space, if it is in the last third.
  if (letters[NAME_LENGTH] !== " ") {
    const space = letters.lastIndexOf(" ", NAME_LENGTH - 1);
    if (space >= (NAME_LENGTH * 2) / 3) end = space;
  }
  return letters.slice(0, end).join("").trim() || "sample";
}

/** PCM as the sampler takes it: one Float32Array a channel (at most the first two channels are kept), samples in −1..1. */
export interface Pcm {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

/** How a file lays its samples out. */
interface Layout {
  channels: number;
  sampleRate: number;
  /** Bytes a sample. */
  width: number;
  coding: "signed" | "unsigned" | "float";
  little: boolean;
}

/** A float that is no number (a damaged file) is silence. */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/** A function that reads one sample at a byte, as −1..1 (a float file may go beyond that, and is left as it is); `null` for a layout nothing here reads. */
function reader(view: DataView, layout: Layout): ((at: number) => number) | null {
  const { width, little } = layout;
  if (layout.coding === "float") {
    if (width === 4) return (at) => finite(view.getFloat32(at, little));
    if (width === 8) return (at) => finite(view.getFloat64(at, little));
    return null;
  }
  if (layout.coding === "unsigned") return width === 1 ? (at) => (view.getUint8(at) - 128) / 128 : null;
  if (width === 1) return (at) => view.getInt8(at) / 128;
  if (width === 2) return (at) => view.getInt16(at, little) / 32_768;
  // Three bytes: the highest carries the sign.
  if (width === 3) return little ? (at) => ((view.getInt8(at + 2) << 16) | view.getUint16(at, true)) / 8_388_608 : (at) => ((view.getInt8(at) << 16) | view.getUint16(at + 1, false)) / 8_388_608;
  if (width === 4) return (at) => view.getInt32(at, little) / 2_147_483_648;
  return null;
}

/**
 * The sound between two bytes of a file, channel by channel. A file that says
 * it is longer than it is (a recording that was cut off) is read as far as it
 * goes; `stated` is how many frames the file says it has, where it says so.
 */
function readSound(view: DataView, from: number, to: number, layout: Layout, stated = Number.POSITIVE_INFINITY): Pcm | null {
  const read = reader(view, layout);
  const stride = layout.channels * layout.width;
  if (!read || layout.channels < 1 || !(layout.sampleRate >= 1) || !Number.isFinite(layout.sampleRate)) return null;
  const frames = Math.min(stated, Math.floor((Math.min(to, view.byteLength) - from) / stride));
  if (!(frames > 0)) return null;
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let channel = 0; channel < Math.min(2, layout.channels); channel += 1) {
    const samples = new Float32Array(frames);
    let at = from + channel * layout.width;
    for (let frame = 0; frame < frames; frame += 1) {
      samples[frame] = read(at);
      at += stride;
    }
    channels.push(samples);
  }
  return { channels, sampleRate: layout.sampleRate };
}

/** A number of 80 bits, as AIFF writes its sample rate: a sign and an exponent in 16 bits, then 64 bits of digits with the leading one written out. */
function extended(view: DataView, at: number): number {
  const head = view.getUint16(at);
  const digits = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6);
  const value = digits * 2 ** ((head & 0x7fff) - 16_383 - 63);
  return head & 0x8000 ? -value : value;
}

/** How an AIFF's samples are written, by the four letters of its type. Plain AIFF is always the first. */
function aiffCoding(type: string, bits: number): Pick<Layout, "width" | "coding" | "little"> | null {
  // Floats say what they are by their name alone.
  if (type === "fl32" || type === "FL32") return { width: 4, coding: "float", little: false };
  if (type === "fl64" || type === "FL64") return { width: 8, coding: "float", little: false };
  if (bits < 1 || bits > 32) return null;
  // A sample of, say, 12 bits sits at the top of two bytes: it is read as one of 16.
  const width = Math.ceil(bits / 8);
  if (type === "NONE" || type === "twos") return { width, coding: "signed", little: false };
  if (type === "sowt") return { width, coding: "signed", little: true };
  if (type === "raw ") return { width, coding: "unsigned", little: false };
  // Plain samples of 24 and 32 bits under the names some programs give them, either way round.
  if (type === "in24" || type === "in32") return { width, coding: "signed", little: false };
  if (type === "23ni" || type === "42ni") return { width, coding: "signed", little: true };
  return null;
}

/** Reads an AIFF or AIFF-C file: big-endian PCM of 8, 16, 24 or 32 bits, AIFF-C "NONE", "twos", "sowt" (little-endian), "fl32"/"FL32" (float) and "raw " (unsigned 8-bit), and besides those "fl64"/"FL64", "in24", "in32", "23ni" and "42ni". `null` for anything else (compressed AIFF-C, a damaged file, no sound data); a file whose sound was cut off is read as far as it goes. The sample rate is an 80-bit extended float in the COMM chunk. */
export function decodeAiff(bytes: Uint8Array): Pcm | null {
  const typed = has(bytes, 8, "AIFC");
  if (!has(bytes, 0, "FORM") || (!typed && !has(bytes, 8, "AIFF"))) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let layout: Layout | null = null;
  let stated = 0;
  let sound: { from: number; to: number } | null = null;
  // The chunks come in any order; each is four letters, its length, its body, and a byte of nothing after an odd length.
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4);
    const body = at + 8;
    if (has(bytes, at, "COMM") && !layout) {
      if (size < 18 || body + 18 > bytes.length) return null;
      const bits = view.getInt16(body + 6);
      const type = typed && size >= 22 && body + 22 <= bytes.length ? String.fromCharCode(...bytes.subarray(body + 18, body + 22)) : "NONE";
      const coding = aiffCoding(type, bits);
      if (!coding) return null;
      layout = { channels: view.getInt16(body), sampleRate: extended(view, body + 8), ...coding };
      stated = view.getUint32(body + 2);
    } else if (has(bytes, at, "SSND") && !sound && body + 8 <= bytes.length) {
      // The sound begins behind two numbers, the first of which says how many bytes to skip.
      sound = { from: body + 8 + view.getUint32(body), to: body + size };
    }
    at = body + size + (size & 1);
  }
  if (!layout || !sound) return null;
  return readSound(view, sound.from, sound.to, layout, stated);
}

/** The numbers by which a WAV says how its samples are written: as whole numbers, or as floats. */
const WAV_PCM = 1;
const WAV_FLOAT = 3;
/** With this one it says "see further down", and names one of the two there, behind the layout of its speakers. */
const WAV_EXTENSIBLE = 0xfffe;

/** What a WAV's `fmt ` chunk says; `null` where its sound is packed (ADPCM, MP3 in a WAV, a telephone's logarithms). */
function wavLayout(view: DataView, at: number, size: number): Layout | null {
  if (size < 16 || at + 16 > view.byteLength) return null;
  let tag = view.getUint16(at, true);
  const bits = view.getUint16(at + 14, true);
  if (tag === WAV_EXTENSIBLE) {
    if (size < 26 || at + 26 > view.byteLength) return null;
    tag = view.getUint16(at + 24, true);
  }
  const shared = { channels: view.getUint16(at + 2, true), sampleRate: view.getUint32(at + 4, true), little: true };
  if (tag === WAV_FLOAT) return bits === 32 || bits === 64 ? { ...shared, width: bits / 8, coding: "float" } : null;
  if (tag !== WAV_PCM || bits < 1 || bits > 32) return null;
  // Up to eight bits a WAV counts from zero upwards, above that around zero.
  const width = Math.ceil(bits / 8);
  return { ...shared, width, coding: width === 1 ? "unsigned" : "signed" };
}

/** Reads a WAV: PCM of 8 (unsigned), 16, 24, 32 bits and float of 32 and 64 bits, plain and WAVE_FORMAT_EXTENSIBLE, RIFF chunks in any order, odd-length chunks padded, a `data` chunk whose stated length runs past the end of the file (read what is there). `null` for anything else (ADPCM, MP3 in WAV, RF64). */
export function decodeWav(bytes: Uint8Array): Pcm | null {
  if (!has(bytes, 0, "RIFF") || !has(bytes, 8, "WAVE")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let layout: Layout | null = null;
  let sound: { from: number; to: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (has(bytes, at, "fmt ") && !layout) {
      layout = wavLayout(view, body, size);
      if (!layout) return null;
    } else if (has(bytes, at, "data") && !sound) {
      sound = { from: body, to: body + size };
    }
    at = body + size + (size & 1);
  }
  if (!layout || !sound) return null;
  return readSound(view, sound.from, sound.to, layout);
}

/** A WAV file of 16-bit PCM from PCM (for keeping a recording): interleaved, little-endian, values clipped to −1..1. */
export function encodeWav16(pcm: Pcm): Uint8Array<ArrayBuffer> {
  const channels = Math.max(1, pcm.channels.length);
  const frames = pcm.channels.reduce((most, channel) => Math.max(most, channel.length), 0);
  const stride = channels * 2;
  const rate = Math.max(1, Math.round(pcm.sampleRate) || 0);
  const bytes = new Uint8Array(44 + frames * stride);
  const view = new DataView(bytes.buffer);
  const letters = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(at + index, text.charCodeAt(index));
  };
  letters(0, "RIFF");
  view.setUint32(4, 36 + frames * stride, true);
  letters(8, "WAVE");
  letters(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, WAV_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * stride, true);
  view.setUint16(32, stride, true);
  view.setUint16(34, 16, true);
  letters(36, "data");
  view.setUint32(40, frames * stride, true);
  pcm.channels.forEach((samples, channel) => {
    let at = 44 + channel * 2;
    for (let frame = 0; frame < frames; frame += 1) {
      // By 32768, as a reader divides: so what comes back is what went in, to half a step. Only a full +1 has no step of its own.
      view.setInt16(at, Math.max(-32_768, Math.min(32_767, Math.round((samples[frame] ?? 0) * 32_768) || 0)), true);
      at += stride;
    }
  });
  return bytes;
}
