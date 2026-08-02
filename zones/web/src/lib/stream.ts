import "server-only";

import { createReadStream } from "node:fs";

// Wraps a file read in a web ReadableStream, so a route can return it as a body.
//
// The cancel() handler is load-bearing: without it, a seek that abandons the response
// leaves the read running to completion against a client that stopped listening.
// Scrubbing through a 60-second clip fires several of those a second.
export function streamOf(file: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const node = createReadStream(file, start === undefined ? undefined : { start, end });

  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      node.destroy();
    },
  });
}
