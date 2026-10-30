import { notificationService } from "./service";

/** Database-backed delivery also observes writes from workers and other pods.
 * Pull-based production bounds buffering to one page for a slow consumer. */
export function notificationStream(
  req: Request,
  since: string | undefined,
  list = notificationService.list,
) {
  let cursor = since;
  let stopped = false;
  let cancelled = false;
  let first = true;
  let immediate = true;
  let wake: (() => void) | undefined;
  const started = Date.now();
  const encoder = new TextEncoder();
  const stop = () => {
    stopped = true;
    wake?.();
  };
  req.signal.addEventListener("abort", stop, { once: true });
  const cleanup = () => {
    stop();
    req.signal.removeEventListener("abort", stop);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!immediate && !stopped)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1000);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        wake = undefined;
        if (stopped || req.signal.aborted || Date.now() - started > 55_000) {
          cleanup();
          if (!cancelled) controller.close();
          return;
        }
        const page = await list({ ...(cursor === undefined ? {} : { since: cursor }), limit: 200 });
        if (stopped) {
          if (!cancelled) controller.close();
          return;
        }
        cursor = page.cursor;
        immediate = page.has_more;
        // Heartbeats prevent Bun/nginx idle timeouts, even with no changes.
        controller.enqueue(
          encoder.encode(
            first || page.items.length
              ? `id: ${cursor}\nevent: notifications\ndata: ${JSON.stringify(page)}\n\n`
              : ": heartbeat\n\n",
          ),
        );
        first = false;
      } catch (error) {
        cleanup();
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
