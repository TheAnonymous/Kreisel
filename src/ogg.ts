/*
 * An Opus file is Opus packets in an Ogg container (RFC 7845): a page with
 * the stream's head, a page with its tags, then pages of sound. The browser
 * encodes the packets; this wraps them, so that what is saved is a file any
 * player knows. Plain arithmetic, no browser needed.
 */

const TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit += 1) value = value & 0x8000_0000 ? (value << 1) ^ 0x04c1_1db7 : value << 1;
  TABLE[index] = value >>> 0;
}

/** Ogg's checksum: CRC-32 with the polynomial 04C11DB7, starting at zero, bits not mirrored. */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ (TABLE[((crc >>> 24) ^ byte) & 255] ?? 0)) >>> 0;
  return crc;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** The samples the decoder has to drop at the start: what libopus looks ahead at 48 kHz. */
export const PRE_SKIP = 312;

/** The identification header: who this stream is. */
export function opusHead(channels: number, preSkip = PRE_SKIP, inputRate = 48_000): Uint8Array {
  const head = new Uint8Array(19);
  head.set(text("OpusHead"), 0);
  const view = new DataView(head.buffer);
  view.setUint8(8, 1);
  view.setUint8(9, channels);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputRate, true);
  view.setInt16(16, 0, true);
  view.setUint8(18, 0);
  return head;
}

/** A head as an encoder hands it over is used as it is, if it is one. */
export function isOpusHead(bytes: Uint8Array | null | undefined): bytes is Uint8Array {
  return !!bytes && bytes.length >= 19 && new TextDecoder().decode(bytes.subarray(0, 8)) === "OpusHead";
}

export const preSkipOf = (head: Uint8Array): number => new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);

/** The comment header: who made the file. */
export function opusTags(vendor: string): Uint8Array {
  const name = text(vendor);
  const tags = new Uint8Array(8 + 4 + name.length + 4);
  tags.set(text("OpusTags"), 0);
  const view = new DataView(tags.buffer);
  view.setUint32(8, name.length, true);
  tags.set(name, 12);
  view.setUint32(12 + name.length, 0, true);
  return tags;
}

/** How many samples (at 48 kHz) an Opus packet holds, read from its first byte. */
export function packetSamples(packet: Uint8Array): number {
  const toc = packet[0] ?? 0;
  const config = toc >> 3;
  const frame = config < 12 ? ([480, 960, 1920, 2880][config & 3] ?? 960) : config < 16 ? ([480, 960][config & 1] ?? 960) : ([120, 240, 480, 960][config & 3] ?? 960);
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 1) & 63 : 2;
  return frame * frames;
}

function page(packets: readonly Uint8Array[], granule: number, serial: number, sequence: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  let size = 0;
  for (const packet of packets) {
    for (let rest = packet.length; rest >= 255; rest -= 255) lacing.push(255);
    lacing.push(packet.length % 255);
    size += packet.length;
  }
  const bytes = new Uint8Array(27 + lacing.length + size);
  const view = new DataView(bytes.buffer);
  bytes.set(text("OggS"), 0);
  view.setUint8(4, 0);
  view.setUint8(5, flags);
  view.setUint32(6, granule >>> 0, true);
  view.setUint32(10, Math.floor(granule / 2 ** 32), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint8(26, lacing.length);
  bytes.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const packet of packets) {
    bytes.set(packet, at);
    at += packet.length;
  }
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

const segments = (packet: Uint8Array): number => Math.floor(packet.length / 255) + 1;

/**
 * The pages of an Opus file. `samples` is how long the sound really is (at
 * 48 kHz): the last page says so, and a player cuts the encoder's padding.
 */
export function muxOggOpus(head: Uint8Array, packets: readonly Uint8Array[], samples: number, serial = 0x4b72_6531, vendor = "Kreisel"): Uint8Array[] {
  const pages = [page([head], 0, serial, 0, 2), page([opusTags(vendor)], 0, serial, 1, 0)];
  const end = preSkipOf(head) + Math.max(0, Math.round(samples));
  let position = 0;
  let waiting: Uint8Array[] = [];
  let laces = 0;
  let sequence = 2;
  const flush = (last: boolean): void => {
    if (waiting.length === 0 && !last) return;
    pages.push(page(waiting, last ? Math.min(position, end) : position, serial, sequence, last ? 4 : 0));
    sequence += 1;
    waiting = [];
    laces = 0;
  };
  for (const packet of packets) {
    // Packets that hold nothing but padding past the end are left out.
    if (position >= end) break;
    if (waiting.length >= 50 || laces + segments(packet) > 255) flush(false);
    waiting.push(packet);
    laces += segments(packet);
    position += packetSamples(packet);
  }
  flush(true);
  return pages;
}

/** What a file of pages says about itself: for checking a written file. */
export function readOggOpus(bytes: Uint8Array): { pages: number; channels: number; preSkip: number; samples: number; ended: boolean; sound: boolean } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let pages = 0;
  let channels = 0;
  let preSkip = 0;
  let granule = 0;
  let ended = false;
  let payload = 0;
  while (at + 27 <= bytes.length) {
    if (new TextDecoder().decode(bytes.subarray(at, at + 4)) !== "OggS") return null;
    const count = view.getUint8(at + 26);
    let size = 0;
    for (let index = 0; index < count; index += 1) size += view.getUint8(at + 27 + index);
    const total = 27 + count + size;
    if (at + total > bytes.length) return null;
    // A copy of its own (a Node buffer's slice would only be another window on the same bytes).
    const copy = new Uint8Array(bytes.subarray(at, at + total));
    const stored = view.getUint32(at + 22, true);
    copy.fill(0, 22, 26);
    if (oggCrc(copy) !== stored) return null;
    const body = at + 27 + count;
    if (pages === 0) {
      if (!isOpusHead(bytes.subarray(body, body + size))) return null;
      channels = view.getUint8(body + 9);
      preSkip = view.getUint16(body + 10, true);
    } else if (pages > 1) {
      payload += size;
    }
    granule = view.getUint32(at + 6, true) + view.getUint32(at + 10, true) * 2 ** 32;
    ended = (view.getUint8(at + 5) & 4) !== 0;
    pages += 1;
    at += total;
  }
  if (pages < 3 || at !== bytes.length) return null;
  return { pages, channels, preSkip, samples: granule - preSkip, ended, sound: payload > 0 };
}
