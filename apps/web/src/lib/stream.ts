/**
 * Streaming a file off disk as a web ReadableStream.
 *
 * Shared by the audio archive and the voice clips: both serve whole files and byte ranges,
 * and both are read by an <audio> element, so both need the same cancel handling — a
 * seek abandons the previous response, and without destroying the node stream the read
 * would run to completion against a client that stopped listening.
 */
import fs from "node:fs";

export function streamOf(file: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(file, { start, end });
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      node.on("end", () => controller.close());
      node.on("error", (error) => controller.error(error));
    },
    cancel() {
      node.destroy();
    },
  });
}
