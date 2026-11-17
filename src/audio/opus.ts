import { isOpusHead, muxOggOpus, opusHead } from "../ogg";

/*
 * Saving sound as Opus. The browser's own encoder (WebCodecs) makes the
 * packets, faster than the sound plays; ogg.ts wraps them into a file. Opus
 * wants 48 kHz, so sound at another rate is brought there first. A browser
 * without the encoder gets a WAV, as before.
 */

export interface SoundFile {
  blob: Blob;
  kind: "opus" | "wav";
}

const RATE = 48_000;
const CONFIG: AudioEncoderConfig = { codec: "opus", sampleRate: RATE, numberOfChannels: 2, bitrate: 160_000 };

export async function opusSupported(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  try {
    return (await AudioEncoder.isConfigSupported(CONFIG)).supported === true;
  } catch {
    return false;
  }
}

async function at48k(left: Float32Array, right: Float32Array, sampleRate: number): Promise<[Float32Array, Float32Array]> {
  if (sampleRate === RATE || left.length === 0) return [left, right];
  const context = new OfflineAudioContext(2, Math.ceil((left.length * RATE) / sampleRate), RATE);
  const buffer = new AudioBuffer({ length: left.length, sampleRate, numberOfChannels: 2 });
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}

/** Stereo sound as an Opus file (Ogg). Throws where the browser cannot encode it. */
export async function encodeOpus(left: Float32Array, right: Float32Array, sampleRate: number): Promise<Blob> {
  const [one, two] = await at48k(left, right, sampleRate);
  const packets: Uint8Array[] = [];
  let head: Uint8Array | null = null;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push(bytes);
      const description = metadata?.decoderConfig?.description;
      if (!head && description) {
        const given = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
        if (isOpusHead(given)) head = given.slice();
      }
    },
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure(CONFIG);
  // A second at a time, and never far ahead of the encoder.
  for (let from = 0; from < one.length && !failure; from += RATE) {
    const frames = Math.min(RATE, one.length - from);
    const planar = new Float32Array(frames * 2);
    planar.set(one.subarray(from, from + frames), 0);
    planar.set(two.subarray(from, from + frames), frames);
    const data = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round((from / RATE) * 1_000_000), data: planar });
    encoder.encode(data);
    data.close();
    if (encoder.encodeQueueSize > 4) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure instanceof Error ? failure : new Error("Opus encoding failed");
  if (packets.length === 0) throw new Error("no sound to encode");
  const pages = muxOggOpus(head ?? opusHead(2), packets, one.length);
  return new Blob(pages as Uint8Array<ArrayBuffer>[], { type: "audio/ogg; codecs=opus" });
}

/** The sound as an Opus file, or as the WAV `wav` makes where this browser cannot write Opus. */
export async function soundFile(left: Float32Array, right: Float32Array, sampleRate: number, wav: () => ArrayBuffer): Promise<SoundFile> {
  if (await opusSupported()) {
    try {
      return { blob: await encodeOpus(left, right, sampleRate), kind: "opus" };
    } catch {
      // The encoder gave up: the WAV below is still a good file.
    }
  }
  return { blob: new Blob([wav()], { type: "audio/wav" }), kind: "wav" };
}
