/**
 * Start the regeneration queue with the process.
 *
 * Next calls register() once per server process, before the first request. That is what
 * makes a deploy invisible to a running batch: jobs are rows, so the new worker finds them
 * and carries on without anyone reopening the page that queued them.
 *
 * Both pm2 workers run this, and so would any other process pointed at the same
 * DATABASE_URL - a one-off `next start` against production included. The advisory lock in
 * leader.ts is what makes that safe rather than catastrophic: they contend, one wins.
 */
import type { Worker } from "@/lib/generation/worker";

const key = Symbol.for("wow-voiceover.queue-worker");
type Holder = { [key]?: Worker };

/** The running worker, for the enqueue route to nudge. Null on the edge runtime. */
export function queueWorker(): Worker | null {
  return (globalThis as Holder)[key] ?? null;
}

export async function register(): Promise<void> {
  // register() also runs for the edge runtime, where there is no pg and no pool.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startLeader } = await import("@/lib/generation/leader");
  const { startWorker } = await import("@/lib/generation/worker");

  const leader = startLeader();
  const worker = startWorker(leader.held);
  (globalThis as Holder)[key] = worker;

  /**
   * Stand down cleanly.
   *
   * The in-flight requests are awaited rather than abandoned - they are already at
   * ElevenLabs and will be billed - and the lock is released only afterwards, so during a
   * `pm2 reload` the incoming worker waits rather than draining alongside this one.
   *
   * This is why deploy/ecosystem.config.js sets kill_timeout: 30000. pm2's default is
   * 1600 ms, which is shorter than a single ElevenLabs call, so without it every reload
   * SIGKILLs mid-generation and the handover degrades to lease reclaim.
   */
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        await worker.stop().catch(() => {});
        await leader.stop().catch(() => {});
        process.exit(0);
      })();
    });
  }
}
