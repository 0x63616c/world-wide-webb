// A web boot can fail without the WebView reporting any error: a stale cached
// entry naming a bundle a deploy removed, a bundle request bounced by
// Cloudflare Access, a crash before first render, or the WebContent process
// dying. Each leaves only the shell's dark background. The shell reloads until
// the board has actually rendered; these are the pure decisions behind that.

const SHELL_CHANNEL = "control-center-shell";

// How long the page has, after its document has loaded, to put anything into
// #root before it reports itself blank.
export const RENDER_DEADLINE_MS = 15_000;

// How long a load may go without any report from the page at all (a hung
// load, or a document the report script never ran in). Grows per attempt so a
// genuinely slow network still gets to finish a load.
export function bootTimeoutMs(attempt: number): number {
  return 30_000 * Math.min(attempt + 1, 4);
}

// Backoff before reloading: 1s, 2s, 4s, ... capped at 30s, so a panel that
// boots while the network or the server is down keeps retrying without
// hammering either.
export function recoveryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

// Bypass cached HTML on the FIRST navigation too. Older installed shells have
// already cached entries from before nginx sent no-cache; new response headers
// cannot repair an entry WebKit never revalidates. Waiting for recovery first
// costs the 15s render deadline on every cold start. Keep the launch stamp stable
// across React renders, but distinct across launches and recovery generations.
// Only the document URL changes: immutable /assets/ URLs still reuse their cache.
export function bootUrl(serverUrl: string, generation: number, launchedAt: number): string {
  const url = new URL(serverUrl);
  url.searchParams.set("shellBoot", `${launchedAt}-${generation}`);
  return url.toString();
}

export type BootReport = { channel: typeof SHELL_CHANNEL; rendered: boolean };

export function parseBootReport(data: string): BootReport | null {
  try {
    const value = JSON.parse(data) as Partial<BootReport>;
    if (value.channel !== SHELL_CHANNEL || typeof value.rendered !== "boolean") return null;
    return { channel: SHELL_CHANNEL, rendered: value.rendered };
  } catch {
    return null;
  }
}

// Runs in the page after its document loads: reports `rendered: true` as soon
// as #root has content, or `rendered: false` at the deadline.
export const bootReportScript = `
  (function () {
    var deadline = Date.now() + ${RENDER_DEADLINE_MS};
    function report(rendered) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ channel: "${SHELL_CHANNEL}", rendered: rendered })
      );
    }
    (function check() {
      var root = document.getElementById("root");
      if (root && root.childElementCount > 0) return report(true);
      if (Date.now() >= deadline) return report(false);
      setTimeout(check, 250);
    })();
  })();
  true;
`;
