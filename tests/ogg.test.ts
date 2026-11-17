import { describe, expect, it } from "vitest";
import { isOpusHead, muxOggOpus, oggCrc, opusHead, opusTags, packetSamples, PRE_SKIP, preSkipOf, readOggOpus } from "../src/ogg";

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};
/** A packet of 20 ms of CELT (the first byte says so), `size` bytes long. */
const packet = (size: number, fill = 7): Uint8Array => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes[0] = 0xf8;
  return bytes;
};

describe("an Opus file", () => {
  it("checks its pages the way Ogg does", () => {
    expect(oggCrc(new TextEncoder().encode("123456789"))).toBe(0x89a1_897f);
    expect(oggCrc(new Uint8Array(0))).toBe(0);
  });

  it("writes the head and the tags a player expects", () => {
    const head = opusHead(2);
    expect(head.length).toBe(19);
    expect(isOpusHead(head)).toBe(true);
    expect(preSkipOf(head)).toBe(PRE_SKIP);
    expect([...head.subarray(8, 10)]).toEqual([1, 2]);
    expect(new DataView(head.buffer).getUint32(12, true)).toBe(48_000);
    expect(isOpusHead(new Uint8Array(19))).toBe(false);
    expect(isOpusHead(null)).toBe(false);
    const tags = opusTags("Kreisel");
    expect(new TextDecoder().decode(tags.subarray(0, 8))).toBe("OpusTags");
    expect(new TextDecoder().decode(tags.subarray(12, 19))).toBe("Kreisel");
    expect(tags.length).toBe(23);
  });

  it("reads how long a packet is from its first byte", () => {
    expect(packetSamples(Uint8Array.of(0xf8))).toBe(960);
    expect(packetSamples(Uint8Array.of(0xf0))).toBe(480);
    expect(packetSamples(Uint8Array.of(0xe0))).toBe(120);
    expect(packetSamples(Uint8Array.of(0x08))).toBe(960);
    expect(packetSamples(Uint8Array.of(0x18))).toBe(2880);
    expect(packetSamples(Uint8Array.of(0x68))).toBe(960);
    // Two frames in one packet, and a packet that counts its frames itself.
    expect(packetSamples(Uint8Array.of(0xf9))).toBe(1920);
    expect(packetSamples(Uint8Array.of(0xfb, 3))).toBe(2880);
  });

  it("wraps packets into pages and says exactly how long the sound is", () => {
    // 2.5 seconds of sound: 125 packets and one more for what the encoder looks ahead.
    const packets = Array.from({ length: 127 }, (_, index) => packet(300 + (index % 5) * 100, index));
    const samples = 120_000;
    const pages = muxOggOpus(opusHead(2), packets, samples);
    const file = join(pages);
    const read = readOggOpus(file)!;
    expect(read).toEqual({ pages: pages.length, channels: 2, preSkip: PRE_SKIP, samples, ended: true, sound: true });
    // Head and tags have a page each; then at most fifty packets a page.
    expect(pages.length).toBe(2 + 3);
    expect(pages[0]![5]).toBe(2);
    expect(pages[pages.length - 1]![5]).toBe(4);
    // The packet that would only hold padding is left out: 126 packets cover 120000 + 312 samples.
    const sound = pages.slice(2).reduce((sum, bytes) => sum + bytes.length - 27 - bytes[26]!, 0);
    expect(sound).toBe(packets.slice(0, 126).reduce((sum, bytes) => sum + bytes.length, 0));
    // A page is numbered, and a flipped bit is noticed.
    expect(new DataView(pages[3]!.buffer).getUint32(18, true)).toBe(3);
    const broken = file.slice();
    broken[200] = (broken[200] ?? 0) ^ 1;
    expect(readOggOpus(broken)).toBeNull();
    expect(readOggOpus(file.subarray(0, file.length - 3))).toBeNull();
    // Read from the middle of a bigger stretch of memory (as a file read by Node is), it says the same.
    const room = new Uint8Array(file.length + 64);
    room.set(file, 40);
    expect(readOggOpus(room.subarray(40, 40 + file.length))).toEqual(read);
    expect(room.subarray(40, 40 + file.length)).toEqual(file);
  });

  it("laces packets of every length, also those of a multiple of 255 bytes", () => {
    const packets = [packet(255), packet(510), packet(1), packet(254), packet(1275)];
    const pages = muxOggOpus(opusHead(2), packets, 4800 - PRE_SKIP);
    const audio = pages[2]!;
    const laces = [...audio.subarray(27, 27 + audio[26]!)];
    expect(laces).toEqual([255, 0, 255, 255, 0, 1, 254, 255, 255, 255, 255, 255, 0]);
    expect(readOggOpus(join(pages))?.samples).toBe(4800 - PRE_SKIP);
  });

  it("starts a new page before one would hold more than 255 segments", () => {
    // Thirty packets of eleven segments each do not fit one page.
    const packets = Array.from({ length: 30 }, () => packet(2550));
    const pages = muxOggOpus(opusHead(2), packets, 30 * 960 - PRE_SKIP);
    for (const bytes of pages) expect(bytes[26]).toBeLessThanOrEqual(255);
    expect(pages.length).toBe(4);
    expect(readOggOpus(join(pages))?.ended).toBe(true);
  });
});
