import { describe, expect, it } from "vitest";
import { ACCEPT, decodeAiff, decodeWav, encodeWav16, ENDINGS, sampleName, sniff, soundLike, type Pcm } from "../src/sample-files";

// ---- files, written by hand -------------------------------------------------------------

type Bytes = readonly number[] | Uint8Array;

const letters = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
const join = (...parts: Bytes[]): Uint8Array => Uint8Array.from(parts.flatMap((part) => [...part]));

/** A whole number as `size` bytes, the lowest first or the highest first; a negative one the way a file writes it. */
const whole = (value: number, size: number, little: boolean): number[] => {
  const room = 256 ** size;
  const positive = ((value % room) + room) % room;
  const bytes = Array.from({ length: size }, (_, index) => Math.floor(positive / 256 ** index) % 256);
  return little ? bytes : bytes.reverse();
};

const float = (value: number, size: 4 | 8, little: boolean): number[] => {
  const view = new DataView(new ArrayBuffer(size));
  if (size === 4) view.setFloat32(0, value, little);
  else view.setFloat64(0, value, little);
  return [...new Uint8Array(view.buffer)];
};

/** A chunk as RIFF (little) and IFF (big) have them: four letters, the length, the body, and a byte of nothing after an odd length. */
const chunk = (id: string, body: Bytes, little: boolean): Uint8Array => join(letters(id), whole(body.length, 4, little), body, body.length % 2 ? [0] : []);

/** The 80-bit number AIFF writes its sample rate as: an exponent, then 64 bits of digits with the leading one written out. */
const extended = (value: number): number[] => {
  const exponent = Math.floor(Math.log2(value));
  const digits = value / 2 ** (exponent - 31);
  const high = Math.floor(digits);
  return [...whole(16_383 + exponent, 2, false), ...whole(high, 4, false), ...whole(Math.round((digits - high) * 2 ** 32), 4, false)];
};

interface Aiff {
  channels: number;
  bits: number;
  rate: number;
  /** How many frames the file says it has. */
  frames: number;
  sound: Bytes;
  /** The four letters of an AIFF-C; without them the file is a plain AIFF. */
  type?: string;
  /** Chunks between COMM and SSND. */
  between?: Uint8Array[];
  /** Bytes to skip in front of the sound. */
  skip?: number;
}

const common = (file: Aiff): Uint8Array =>
  chunk("COMM", [...whole(file.channels, 2, false), ...whole(file.frames, 4, false), ...whole(file.bits, 2, false), ...extended(file.rate), ...(file.type ? [...letters(file.type), 0, 0] : [])], false);
const soundData = (file: Aiff): Uint8Array => chunk("SSND", [...whole(file.skip ?? 0, 4, false), ...whole(0, 4, false), ...new Array<number>(file.skip ?? 0).fill(99), ...file.sound], false);
const form = (kind: string, ...chunks: Uint8Array[]): Uint8Array => {
  const body = join(...chunks);
  return join(letters("FORM"), whole(4 + body.length, 4, false), letters(kind), body);
};
const aiff = (file: Aiff): Uint8Array => form(file.type ? "AIFC" : "AIFF", common(file), ...(file.between ?? []), soundData(file));

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/** A WAV's `fmt ` chunk; with `inner` it is the long form that names the kind of samples further down. */
const fmt = (tag: number, channels: number, rate: number, bits: number, inner?: number): Uint8Array => {
  const stride = (channels * bits) / 8;
  const plain = [...whole(tag, 2, true), ...whole(channels, 2, true), ...whole(rate, 4, true), ...whole(rate * stride, 4, true), ...whole(stride, 2, true), ...whole(bits, 2, true)];
  if (inner === undefined) return chunk("fmt ", plain, true);
  return chunk("fmt ", [...plain, ...whole(22, 2, true), ...whole(bits, 2, true), ...whole(3, 4, true), ...whole(inner, 2, true), 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], true);
};
const riff = (...chunks: Uint8Array[]): Uint8Array => {
  const body = join(...chunks);
  return join(letters("RIFF"), whole(4 + body.length, 4, true), letters("WAVE"), body);
};
const wav = (format: Uint8Array, sound: Bytes): Uint8Array => riff(format, chunk("data", sound, true));

/** The first page of an Ogg file around a codec's head. */
const oggPage = (head: Bytes): Uint8Array => join(letters("OggS"), [0, 2], whole(0, 8, true), whole(7, 4, true), whole(0, 4, true), whole(0, 4, true), [1, head.length], head);

/** The first four bytes of an MP3's frame: MPEG 1, layer III, 128 kbit/s, 44.1 kHz. */
const MP3_FRAME = [0xff, 0xfb, 0x90, 0x64];
/** An ID3 tag of `size` bytes behind its ten bytes of head. */
const id3 = (size: number, body: Bytes = new Array<number>(size).fill(0x41)): Uint8Array => join(letters("ID3"), [3, 0, 0], [(size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127], body);

const samplesOf = (pcm: Pcm | null, channel = 0): number[] => [...(pcm?.channels[channel] ?? [])];

// ---- what a file is ---------------------------------------------------------------------

describe("What a file is", () => {
  it("is told from its first bytes, and called by its name", () => {
    const files: [Uint8Array, string, string][] = [
      [wav(fmt(PCM, 1, 44_100, 16), [0, 0]), "wav", "WAV"],
      [aiff({ channels: 1, bits: 16, rate: 44_100, frames: 1, sound: [0, 0] }), "aiff", "AIFF"],
      [aiff({ channels: 1, bits: 16, rate: 44_100, frames: 1, sound: [0, 0], type: "sowt" }), "aiff", "AIFF"],
      [join(letters("fLaC"), [0, 0, 0, 34]), "flac", "FLAC"],
      [join([0, 0, 0, 32], letters("ftypM4A "), [0, 0, 0, 0]), "mp4", "AAC (M4A)"],
      [join([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc]), "aac", "AAC"],
      [join([0xff, 0xf9, 0x50, 0x80, 0x02, 0x1f, 0xfc]), "aac", "AAC"],
      [join([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]), "webm", "WebM"],
      [join(letters("caff"), [0, 1, 0, 0], letters("desc")), "caf", "CAF"],
      [join(letters("MThd"), [0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0]), "midi", "a MIDI file"],
    ];
    for (const [bytes, format, label] of files) expect(sniff(bytes)).toEqual({ format, label });
  });

  it("looks into an Ogg file's first page for what it carries", () => {
    expect(sniff(oggPage([...letters("OpusHead"), 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]))).toEqual({ format: "ogg-opus", label: "Opus" });
    expect(sniff(oggPage([1, ...letters("vorbis"), 0, 0, 0, 0, 2]))).toEqual({ format: "ogg-vorbis", label: "Ogg Vorbis" });
    expect(sniff(oggPage([0x7f, ...letters("FLAC"), 1, 0, 0, 1, ...letters("fLaC")]))).toEqual({ format: "ogg-flac", label: "FLAC" });
    // Something else in an Ogg (speech, a film), and a page that was cut off before its head.
    expect(sniff(oggPage(letters("Speex   1.2")))).toEqual({ format: "ogg", label: "Ogg" });
    expect(sniff(oggPage(letters("OpusHead")).subarray(0, 30)).format).toBe("ogg");
    expect(sniff(Uint8Array.from(letters("OggS"))).format).toBe("ogg");
  });

  it("knows an MP3 by its first frame, and behind a tag of any length", () => {
    expect(sniff(join(MP3_FRAME, [0, 0, 0, 0]))).toEqual({ format: "mp3", label: "MP3" });
    // MPEG 2 and 2.5, layer III.
    expect(sniff(join([0xff, 0xf3, 0x90, 0x64])).format).toBe("mp3");
    expect(sniff(join([0xff, 0xe3, 0x90, 0x64])).format).toBe("mp3");
    expect(sniff(join(id3(20), MP3_FRAME)).format).toBe("mp3");
    // A stretch of nothing some taggers leave behind the tag.
    expect(sniff(join(id3(20), [0, 0, 0, 0, 0, 0], MP3_FRAME)).format).toBe("mp3");
    // A tag with a picture in it, of which only the beginning was read.
    expect(sniff(join(id3(200_000, new Array<number>(500).fill(0x41)))).format).toBe("mp3");
    expect(sniff(Uint8Array.from(letters("ID3"))).format).toBe("mp3");
  });

  it("looks behind a tag for the other files that carry one", () => {
    expect(sniff(join(id3(20), letters("fLaC"), [0, 0, 0, 34])).format).toBe("flac");
    expect(sniff(join(id3(20), [0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc])).format).toBe("aac");
    expect(sniff(join(id3(20), letters("this is no sound"))).format).toBe("unknown");
  });

  it("calls everything else not a sound, and never trips over a short or an empty file", () => {
    const nothing = { format: "unknown", label: "not a sound I know" };
    expect(sniff(new Uint8Array(0))).toEqual(nothing);
    expect(sniff(new Uint8Array(64))).toEqual(nothing);
    expect(sniff(Uint8Array.from(letters("RIF")))).toEqual(nothing);
    expect(sniff(Uint8Array.from([0xff]))).toEqual(nothing);
    expect(sniff(Uint8Array.from(letters("Hello, I am a text file.\n")))).toEqual(nothing);
    // A film in a RIFF; a picture; MPEG audio of layer II, which no browser plays; frames with a bit rate or a sample rate there is none of.
    expect(sniff(join(letters("RIFF"), [0, 1, 0, 0], letters("AVI LIST")))).toEqual(nothing);
    expect(sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual(nothing);
    expect(sniff(Uint8Array.from([0xff, 0xfd, 0x90, 0x64]))).toEqual(nothing);
    expect(sniff(Uint8Array.from([0xff, 0xfb, 0xf0, 0x64]))).toEqual(nothing);
    expect(sniff(Uint8Array.from([0xff, 0xfb, 0x9c, 0x64]))).toEqual(nothing);
    expect(sniff(Uint8Array.from([0xff, 0xff, 0xff, 0xff]))).toEqual(nothing);
    // Every beginning of every kind of file, however short, gets an answer.
    const beginnings = [
      wav(fmt(PCM, 2, 48_000, 16), [1, 2, 3, 4]),
      aiff({ channels: 2, bits: 16, rate: 48_000, frames: 1, sound: [1, 2, 3, 4], type: "NONE" }),
      oggPage([...letters("OpusHead"), 1, 2]),
      join(id3(12), MP3_FRAME),
      join([0, 0, 0, 32], letters("ftypM4A ")),
    ];
    for (const file of beginnings) for (let length = 0; length <= file.length; length += 1) {
      expect(typeof sniff(file.subarray(0, length)).label).toBe("string");
      expect(() => decodeWav(file.subarray(0, length))).not.toThrow();
      expect(() => decodeAiff(file.subarray(0, length))).not.toThrow();
    }
  });

  it("calls a WAV for more than four gigabytes a WAV, though it is not read here", () => {
    const large = join(letters("RF64"), [0xff, 0xff, 0xff, 0xff], letters("WAVE"), chunk("ds64", new Array<number>(28).fill(0), true));
    expect(sniff(large).format).toBe("wav");
    expect(decodeWav(large)).toBeNull();
  });
});

describe("Which files are let in", () => {
  it("names every ending, lower case and with its dot, and offers each of them to the file dialog", () => {
    expect(ENDINGS).toEqual([".wav", ".wave", ".aif", ".aiff", ".aifc", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".mp4", ".aac", ".webm", ".weba", ".caf"]);
    const offered = ACCEPT.split(",");
    for (const ending of ENDINGS) {
      expect(ending).toMatch(/^\.[a-z0-9]+$/);
      expect(offered).toContain(ending);
    }
    expect(offered).toContain("audio/*");
    expect(ACCEPT).not.toMatch(/\s/);
  });

  it("takes a file for a sound by its type or by its ending, whichever says so", () => {
    expect(soundLike("kick.wav", "audio/wav")).toBe(true);
    expect(soundLike("kick", "audio/x-aiff")).toBe(true);
    expect(soundLike("take", "audio/webm;codecs=opus")).toBe(true);
    expect(soundLike("old", "application/ogg")).toBe(true);
    // A browser that does not know AIFF hands it over without a type; Firefox calls an .ogg a film.
    expect(soundLike("Loop 01.AIF", "")).toBe(true);
    expect(soundLike("chords.ogg", "video/ogg")).toBe(true);
    expect(soundLike("voice memo.m4a", "application/octet-stream")).toBe(true);
    for (const ending of ENDINGS) expect(soundLike(`a${ending.toUpperCase()}`, "")).toBe(true);
    expect(soundLike("cover.png", "image/png")).toBe(false);
    expect(soundLike("notes.txt", "text/plain")).toBe(false);
    expect(soundLike("wav", "")).toBe(false);
    expect(soundLike("song.mid", "")).toBe(false);
    expect(soundLike("", "")).toBe(false);
  });
});

describe("A sample's name", () => {
  it("is the file's name without its folders and its ending", () => {
    expect(sampleName("kick.wav")).toBe("kick");
    expect(sampleName("drums/loops/Amen Break.aiff")).toBe("Amen Break");
    expect(sampleName("C:\\Samples\\909\\Clap.WAV")).toBe("Clap");
    expect(sampleName("Rimshot")).toBe("Rimshot");
    expect(sampleName("take.2")).toBe("take 2");
    expect(sampleName("Grüße übers Tal.flac")).toBe("Grüße übers Tal");
    // As a Mac writes it: the dots apart from their letter.
    expect(sampleName("Gru\u0308n.wav")).toBe("Grün");
  });

  it("has nothing in it that a link could not carry between its dots", () => {
    expect(sampleName("kick.v2.final.wav")).toBe("kick v2 final");
    expect(sampleName("100% bass & more=yes?.mp3")).toBe("100 bass more yes");
    expect(sampleName("a,b|c#d.ogg")).toBe("a b c d");
    expect(sampleName("snare\t01\u0000\u0007.wav")).toBe("snare 01");
    expect(sampleName("  spaced    out  .wav")).toBe("spaced out");
    for (const name of ["x.y.z.wav", "a/b\\c.d", "tab\there", "50%.off", "q?a=b&c#d|e,f"]) expect(sampleName(name)).not.toMatch(/[.,|#&=?%/\\\p{Cc}]/u);
  });

  it("is cut to 24 characters, at a space where one is near", () => {
    expect(sampleName("Super Long Sample Name That Goes On And On.wav")).toBe("Super Long Sample Name");
    expect(sampleName("abcdefghijklmnopqrstuvwxyz0123456789.wav")).toBe("abcdefghijklmnopqrstuvwx");
    // The cut falls between two words: nothing more is taken away.
    expect(sampleName("abcdefghijkl mnopqrstuvw xyz.wav")).toBe("abcdefghijkl mnopqrstuvw");
    // A space far from the end is no place to cut: most of the name would go.
    expect(sampleName("Kick abcdefghijklmnopqrstuvwxyz.wav")).toBe("Kick abcdefghijklmnopqrs");
    // Characters, not the two halves some of them are stored as.
    const drums = sampleName(`${"🥁".repeat(30)}.wav`);
    expect(Array.from(drums)).toHaveLength(24);
    expect(drums).toBe("🥁".repeat(24));
    for (const name of ["Super Long Sample Name That Goes On And On.wav", "x".repeat(300), "a b ".repeat(40)]) expect(Array.from(sampleName(name)).length).toBeLessThanOrEqual(24);
  });

  it("is \"sample\" where nothing is left", () => {
    for (const name of ["", ".wav", "...", "folder/", " \t ", "%&?.mp3"]) expect(sampleName(name)).toBe("sample");
  });
});

// ---- AIFF ---------------------------------------------------------------------------------

describe("An AIFF", () => {
  it("writes its sample rate as a number of 80 bits", () => {
    // The two rates as every AIFF has them, so that the test writes what real files do.
    expect(extended(44_100)).toEqual([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
    expect(extended(22_050)).toEqual([0x40, 0x0d, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
    const sound = [0, 0, 0x40, 0];
    expect(decodeAiff(aiff({ channels: 1, bits: 16, rate: 44_100, frames: 2, sound }))?.sampleRate).toBe(44_100);
    expect(decodeAiff(aiff({ channels: 1, bits: 16, rate: 22_050, frames: 2, sound }))?.sampleRate).toBe(22_050);
    expect(decodeAiff(aiff({ channels: 1, bits: 16, rate: 48_000, frames: 2, sound }))?.sampleRate).toBe(48_000);
    expect(decodeAiff(aiff({ channels: 1, bits: 16, rate: 96_000, frames: 2, sound }))?.sampleRate).toBe(96_000);
    expect(decodeAiff(aiff({ channels: 1, bits: 16, rate: 11_127.5, frames: 2, sound }))?.sampleRate).toBe(11_127.5);
  });

  it("is read at 8, 16, 24 and 32 bits, the highest byte first", () => {
    const values = (bits: number): number[] => [0, 2 ** (bits - 2), -(2 ** (bits - 2)), 2 ** (bits - 1) - 1, -(2 ** (bits - 1))];
    for (const bits of [8, 16, 24, 32]) {
      const sound = values(bits).flatMap((value) => whole(value, bits / 8, false));
      const pcm = decodeAiff(aiff({ channels: 1, bits, rate: 44_100, frames: 5, sound }));
      expect(pcm?.channels).toHaveLength(1);
      const read = samplesOf(pcm);
      expect(read.slice(0, 3)).toEqual([0, 0.5, -0.5]);
      expect(read[3]).toBeCloseTo(1, bits === 8 ? 1 : 4);
      expect(read[3]).toBeLessThanOrEqual(1);
      expect(read[4]).toBe(-1);
    }
  });

  it("keeps the first two of its channels", () => {
    const stereo = [1000, -1000, 2000, -2000, 3000, -3000].flatMap((value) => whole(value, 2, false));
    const two = decodeAiff(aiff({ channels: 2, bits: 16, rate: 48_000, frames: 3, sound: stereo }));
    expect(samplesOf(two, 0)).toEqual([1000, 2000, 3000].map((value) => value / 32_768));
    expect(samplesOf(two, 1)).toEqual([-1000, -2000, -3000].map((value) => value / 32_768));
    const three = decodeAiff(aiff({ channels: 3, bits: 16, rate: 48_000, frames: 2, sound: stereo }));
    expect(three?.channels).toHaveLength(2);
    expect(samplesOf(three, 0)).toEqual([1000, -2000].map((value) => value / 32_768));
    expect(samplesOf(three, 1)).toEqual([-1000, 3000].map((value) => value / 32_768));
  });

  it("is read as AIFF-C where that is not packed: the lowest byte first, floats, bytes that count from zero", () => {
    const little = [0, 16_384, -16_384, -32_768].flatMap((value) => whole(value, 2, true));
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 16, rate: 44_100, frames: 4, sound: little, type: "sowt" })))).toEqual([0, 0.5, -0.5, -1]);
    const big = [0, 16_384, -16_384, -32_768].flatMap((value) => whole(value, 2, false));
    for (const type of ["NONE", "twos"]) expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 16, rate: 44_100, frames: 4, sound: big, type })))).toEqual([0, 0.5, -0.5, -1]);
    const floats = [0, 0.5, -0.25, 1, -1].flatMap((value) => float(value, 4, false));
    for (const type of ["fl32", "FL32"]) expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 32, rate: 48_000, frames: 5, sound: floats, type })))).toEqual([0, 0.5, -0.25, 1, -1]);
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 8, rate: 22_050, frames: 4, sound: [128, 192, 64, 0], type: "raw " })))).toEqual([0, 0.5, -0.5, -1]);
    // A little-endian file of 24 bits.
    const wide = [4_194_304, -8_388_608].flatMap((value) => whole(value, 3, true));
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 24, rate: 44_100, frames: 2, sound: wide, type: "sowt" })))).toEqual([0.5, -1]);
    // The same plain samples under the names some programs give them, and floats of 64 bits.
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 24, rate: 44_100, frames: 2, sound: wide, type: "23ni" })))).toEqual([0.5, -1]);
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 24, rate: 44_100, frames: 2, sound: wide.slice().reverse(), type: "in24" })))).toEqual([-1, 0.5]);
    const widest = [1_073_741_824, -2_147_483_648];
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 32, rate: 44_100, frames: 2, sound: widest.flatMap((value) => whole(value, 4, false)), type: "in32" })))).toEqual([0.5, -1]);
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 32, rate: 44_100, frames: 2, sound: widest.flatMap((value) => whole(value, 4, true)), type: "42ni" })))).toEqual([0.5, -1]);
    for (const type of ["fl64", "FL64"]) expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 64, rate: 48_000, frames: 3, sound: [0.5, -0.25, 1].flatMap((value) => float(value, 8, false)), type })))).toEqual([0.5, -0.25, 1]);
  });

  it("is read past chunks of an odd length, with its chunks in any order and its sound behind a gap", () => {
    const sound = [8192, -8192].flatMap((value) => whole(value, 2, false));
    const file: Aiff = { channels: 1, bits: 16, rate: 44_100, frames: 2, sound };
    const named = aiff({ ...file, between: [chunk("NAME", letters("Clap!"), false), chunk("ANNO", letters("odd"), false)] });
    expect(samplesOf(decodeAiff(named))).toEqual([0.25, -0.25]);
    // An AIFF-C says which edition of the format it is, in a chunk of its own.
    const little = [8192, -8192].flatMap((value) => whole(value, 2, true));
    expect(samplesOf(decodeAiff(aiff({ ...file, type: "sowt", sound: little, between: [chunk("FVER", [0xa2, 0x80, 0x51, 0x40], false)] })))).toEqual([0.25, -0.25]);
    expect(samplesOf(decodeAiff(form("AIFF", chunk("NAME", letters("x"), false), soundData(file), common(file))))).toEqual([0.25, -0.25]);
    expect(samplesOf(decodeAiff(aiff({ ...file, skip: 6 })))).toEqual([0.25, -0.25]);
    // Read from the middle of a larger buffer, as a file slice may be.
    const padded = join([1, 2, 3], named, [4, 5]);
    expect(samplesOf(decodeAiff(padded.subarray(3, 3 + named.length)))).toEqual([0.25, -0.25]);
  });

  it("is read as far as it goes when it was cut off in its sound, and no further than it says", () => {
    const sound = [100, 200, 300, 400].flatMap((value) => whole(value, 2, false));
    const full = aiff({ channels: 1, bits: 16, rate: 44_100, frames: 4, sound });
    expect(samplesOf(decodeAiff(full.subarray(0, full.length - 3)))).toEqual([100, 200].map((value) => value / 32_768));
    // More bytes than frames: what the file says counts.
    expect(samplesOf(decodeAiff(aiff({ channels: 1, bits: 16, rate: 44_100, frames: 3, sound })))).toHaveLength(3);
  });

  it("is turned down when it is packed, damaged or empty", () => {
    const sound = [100, 200, 300, 400].flatMap((value) => whole(value, 2, false));
    const file: Aiff = { channels: 1, bits: 16, rate: 44_100, frames: 4, sound };
    for (const type of ["ima4", "ulaw", "alaw", "MAC3", "GSM "]) expect(decodeAiff(aiff({ ...file, type }))).toBeNull();
    const good = aiff(file);
    expect(decodeAiff(good)).not.toBeNull();
    // Cut off in its head, in front of its sound, and just where the sound would begin.
    expect(decodeAiff(good.subarray(0, 24))).toBeNull();
    expect(decodeAiff(good.subarray(0, 38))).toBeNull();
    expect(decodeAiff(good.subarray(0, good.length - sound.length))).toBeNull();
    expect(decodeAiff(good.subarray(0, good.length - sound.length + 1))).toBeNull();
    // No frames, no channels, no rate, bits there are none of, no head at all.
    expect(decodeAiff(aiff({ ...file, frames: 0 }))).toBeNull();
    expect(decodeAiff(aiff({ ...file, sound: [] }))).toBeNull();
    expect(decodeAiff(aiff({ ...file, channels: 0 }))).toBeNull();
    expect(decodeAiff(aiff({ ...file, bits: 0 }))).toBeNull();
    expect(decodeAiff(aiff({ ...file, bits: 64 }))).toBeNull();
    expect(decodeAiff(aiff({ ...file, bits: 16, type: "raw " }))).toBeNull();
    expect(decodeAiff(form("AIFF", soundData(file)))).toBeNull();
    expect(decodeAiff(form("AIFF", common(file)))).toBeNull();
    const rateless = aiff(file);
    rateless.fill(0, 28, 38);
    expect(decodeAiff(rateless)).toBeNull();
    expect(decodeAiff(wav(fmt(PCM, 1, 44_100, 16), sound))).toBeNull();
    expect(decodeAiff(form("8SVX", common(file), soundData(file)))).toBeNull();
    expect(decodeAiff(new Uint8Array(0))).toBeNull();
  });
});

// ---- WAV ----------------------------------------------------------------------------------

describe("A WAV", () => {
  it("is read at 8 bits counted from zero, and at 16, 24 and 32 bits around zero", () => {
    expect(samplesOf(decodeWav(wav(fmt(PCM, 1, 22_050, 8), [128, 192, 64, 0, 255])))).toEqual([0, 0.5, -0.5, -1, 127 / 128]);
    for (const bits of [16, 24, 32]) {
      const values = [0, 2 ** (bits - 2), -(2 ** (bits - 2)), 2 ** (bits - 1) - 1, -(2 ** (bits - 1))];
      const pcm = decodeWav(wav(fmt(PCM, 1, 44_100, bits), values.flatMap((value) => whole(value, bits / 8, true))));
      expect(pcm?.sampleRate).toBe(44_100);
      const read = samplesOf(pcm);
      expect(read.slice(0, 3)).toEqual([0, 0.5, -0.5]);
      expect(read[3]).toBeCloseTo(1, 4);
      expect(read[3]).toBeLessThanOrEqual(1);
      expect(read[4]).toBe(-1);
    }
  });

  it("is read as floats of 32 and of 64 bits, which may go beyond full scale", () => {
    const values = [0, 0.5, -0.25, 1, -1, 1.5];
    expect(samplesOf(decodeWav(wav(fmt(FLOAT, 1, 48_000, 32), values.flatMap((value) => float(value, 4, true)))))).toEqual(values);
    expect(samplesOf(decodeWav(wav(fmt(FLOAT, 1, 96_000, 64), values.flatMap((value) => float(value, 8, true)))))).toEqual(values);
    // What is no number at all in a damaged file is silence, not a noise that never ends.
    expect(samplesOf(decodeWav(wav(fmt(FLOAT, 1, 48_000, 32), [...float(Number.NaN, 4, true), ...float(Number.POSITIVE_INFINITY, 4, true), ...float(0.5, 4, true)])))).toEqual([0, 0, 0.5]);
  });

  it("keeps the first two of its channels", () => {
    const sound = [1000, -1000, 7, 2000, -2000, 8].flatMap((value) => whole(value, 2, true));
    const two = decodeWav(wav(fmt(PCM, 2, 48_000, 16), sound));
    expect(samplesOf(two, 0)).toEqual([1000, 7, -2000].map((value) => value / 32_768));
    expect(samplesOf(two, 1)).toEqual([-1000, 2000, 8].map((value) => value / 32_768));
    const three = decodeWav(wav(fmt(PCM, 3, 48_000, 16), sound));
    expect(three?.channels).toHaveLength(2);
    expect(samplesOf(three, 0)).toEqual([1000, 2000].map((value) => value / 32_768));
    expect(samplesOf(three, 1)).toEqual([-1000, -2000].map((value) => value / 32_768));
  });

  it("is read in its long form, which names the kind of its samples further down", () => {
    const wide = [4_194_304, -8_388_608].flatMap((value) => whole(value, 3, true));
    expect(samplesOf(decodeWav(wav(fmt(EXTENSIBLE, 1, 48_000, 24, PCM), wide)))).toEqual([0.5, -1]);
    const floats = [0.5, -0.125].flatMap((value) => float(value, 4, true));
    expect(samplesOf(decodeWav(wav(fmt(EXTENSIBLE, 1, 48_000, 32, FLOAT), floats)))).toEqual([0.5, -0.125]);
    // A long form that names something packed.
    expect(decodeWav(wav(fmt(EXTENSIBLE, 1, 48_000, 16, 2), [0, 0, 0, 0]))).toBeNull();
  });

  it("is read with its chunks in any order and past chunks of an odd length", () => {
    const sound = [8192, -8192].flatMap((value) => whole(value, 2, true));
    const info = letters("INFOISFT\u0003\u0000\u0000\u0000ab\u0000");
    expect(info.length % 2).toBe(1);
    const list = chunk("LIST", info, true);
    expect(samplesOf(decodeWav(riff(list, fmt(PCM, 1, 44_100, 16), chunk("data", sound, true))))).toEqual([0.25, -0.25]);
    expect(samplesOf(decodeWav(riff(chunk("JUNK", [1, 2, 3], true), fmt(PCM, 1, 44_100, 16), chunk("fact", [2, 0, 0, 0], true), chunk("data", sound, true), chunk("cue ", [0, 0, 0], true))))).toEqual([0.25, -0.25]);
    expect(samplesOf(decodeWav(riff(chunk("data", sound, true), fmt(PCM, 1, 44_100, 16))))).toEqual([0.25, -0.25]);
    // Sound of an odd number of bytes, and a chunk behind it.
    expect(samplesOf(decodeWav(riff(fmt(PCM, 1, 8000, 8), chunk("data", [128, 192, 64], true), chunk("LIST", letters("INFO"), true))))).toEqual([0, 0.5, -0.5]);
  });

  it("is read as far as it goes when its sound says it is longer than the file", () => {
    const sound = [100, 200, 300].flatMap((value) => whole(value, 2, true));
    const cut = join(letters("RIFF"), whole(100_000, 4, true), letters("WAVE"), fmt(PCM, 1, 44_100, 16), letters("data"), whole(99_000, 4, true), sound, [7]);
    expect(samplesOf(decodeWav(cut))).toEqual([100, 200, 300].map((value) => value / 32_768));
    // A recording that was streamed never learned its length.
    const streamed = join(letters("RIFF"), whole(0xffff_ffff, 4, true), letters("WAVE"), fmt(PCM, 1, 44_100, 16), letters("data"), whole(0xffff_ffff, 4, true), sound);
    expect(samplesOf(decodeWav(streamed))).toHaveLength(3);
  });

  it("is turned down when it is packed, damaged or empty", () => {
    const sound = [0, 0, 0, 0];
    // ADPCM of two makes, a telephone's logarithms, MP3 in a WAV.
    for (const tag of [2, 0x11, 6, 7, 0x55]) expect(decodeWav(wav(fmt(tag, 1, 44_100, 16), sound))).toBeNull();
    expect(decodeWav(wav(fmt(FLOAT, 1, 44_100, 16), sound))).toBeNull();
    expect(decodeWav(wav(fmt(PCM, 1, 44_100, 0), sound))).toBeNull();
    expect(decodeWav(wav(fmt(PCM, 1, 44_100, 64), [0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(decodeWav(wav(fmt(PCM, 0, 44_100, 16), sound))).toBeNull();
    expect(decodeWav(wav(fmt(PCM, 1, 0, 16), sound))).toBeNull();
    expect(decodeWav(riff(fmt(PCM, 1, 44_100, 16)))).toBeNull();
    expect(decodeWav(riff(chunk("data", sound, true)))).toBeNull();
    expect(decodeWav(wav(fmt(PCM, 1, 44_100, 16), []))).toBeNull();
    expect(decodeWav(wav(fmt(PCM, 2, 44_100, 16), [1, 2, 3]))).toBeNull();
    expect(decodeWav(riff(chunk("fmt ", [1, 0, 1, 0], true), chunk("data", sound, true)))).toBeNull();
    expect(decodeWav(aiff({ channels: 1, bits: 16, rate: 44_100, frames: 2, sound }))).toBeNull();
    expect(decodeWav(new Uint8Array(0))).toBeNull();
    expect(decodeWav(Uint8Array.from(letters("RIFF")))).toBeNull();
  });
});

describe("A recording kept as a WAV", () => {
  it("comes back as it went in, to a step of 16 bits", () => {
    const left = Float32Array.from({ length: 2000 }, (_, index) => Math.sin(index * 0.37) * 0.9);
    const right = Float32Array.from({ length: 2000 }, (_, index) => ((index * 7919) % 2001) / 1000 - 1);
    const file = encodeWav16({ channels: [left, right], sampleRate: 44_100 });
    expect(file).toHaveLength(44 + 2000 * 4);
    expect(sniff(file).format).toBe("wav");
    const back = decodeWav(file);
    expect(back?.sampleRate).toBe(44_100);
    expect(back?.channels).toHaveLength(2);
    [left, right].forEach((samples, channel) => {
      const read = back!.channels[channel]!;
      expect(read).toHaveLength(2000);
      let worst = 0;
      samples.forEach((value, index) => (worst = Math.max(worst, Math.abs(value - read[index]!))));
      expect(worst).toBeLessThanOrEqual(1 / 32_767);
    });
    // Mono, and another rate.
    const mono = decodeWav(encodeWav16({ channels: [Float32Array.from([0, 0.5, -0.5, 0.25])], sampleRate: 22_050 }));
    expect([mono?.sampleRate, mono?.channels.length]).toEqual([22_050, 1]);
    expect(samplesOf(mono)).toEqual([0, 0.5, -0.5, 0.25]);
  });

  it("is clipped where it went over, and silent where a channel is shorter or no number", () => {
    const loud = decodeWav(encodeWav16({ channels: [Float32Array.from([2, -2, 1, -1, Number.NaN, 0.5])], sampleRate: 48_000 }));
    expect(samplesOf(loud)).toEqual([32_767 / 32_768, -1, 32_767 / 32_768, -1, 0, 0.5]);
    const uneven = decodeWav(encodeWav16({ channels: [Float32Array.from([0.5, 0.5, 0.5]), Float32Array.from([0.25])], sampleRate: 48_000 }));
    expect(samplesOf(uneven, 0)).toEqual([0.5, 0.5, 0.5]);
    expect(samplesOf(uneven, 1)).toEqual([0.25, 0, 0]);
  });

  it("is a whole file even of nothing", () => {
    const empty = encodeWav16({ channels: [], sampleRate: 48_000 });
    expect(empty).toHaveLength(44);
    expect(sniff(empty).format).toBe("wav");
    expect(decodeWav(empty)).toBeNull();
    const header = new DataView(encodeWav16({ channels: [new Float32Array(10), new Float32Array(10)], sampleRate: 48_000 }).buffer);
    // Its own length, the two lengths of a frame and a second, and the length of the sound.
    expect([header.getUint32(4, true), header.getUint16(22, true), header.getUint32(24, true), header.getUint32(28, true), header.getUint16(32, true), header.getUint16(34, true), header.getUint32(40, true)]).toEqual([76, 2, 48_000, 192_000, 4, 16, 40]);
  });
});
