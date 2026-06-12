import type { Plugin } from "@opencode-ai/plugin";

const BEADS_TICKET_RE = /^([A-Z]+-[a-z0-9]+(\.[0-9]+)*)/;

const BeadsGuard: Plugin = async (ctx) => {
  const { directory } = ctx;

  return {
    "tool.execute.before": async (input) => {
      const modifyingTools = ["edit", "write", "apply_patch"];
      if (!modifyingTools.includes(input.tool)) return;

      const branch = await getCurrentBranch(directory);
      if (!branch) return;

      if (branch === "main") {
        throw new Error(
          "Edits are not allowed on the main branch.\n\n" +
            "Create a worktree with a beads ticket:\n" +
            "  worktree_create({ branch: 'www-xxx-short-description' })\n" +
            "Then switch to the worktree to make your changes.",
        );
      }

      if (branch.startsWith("dependabot/") || branch.startsWith("renovate/")) return;

      const ticketId = extractTicketId(branch);
      if (!ticketId) {
        throw new Error(
          `Branch "${branch}" has no beads ticket ID in its name.\n\n` +
            "To start work:\n" +
            '  1. bd create --title="short description" --type=feature\n' +
            "  2. worktree_create({ branch: 'www-xxx-short-description' })",
        );
      }

      if (!Bun.which("bd")) {
        console.warn(`[beads-guard] 'bd' not on PATH; skipping ticket check for ${ticketId}`);
        return;
      }

      const { exists, closed } = await checkTicket(ticketId);
      if (!exists) {
        throw new Error(
          `Beads ticket "${ticketId}" not found.\n\n` +
            `  Check: bd show ${ticketId}\n` +
            '  Create: bd create --title="..." --type=feature',
        );
      }
      if (closed) {
        throw new Error(
          `Beads ticket "${ticketId}" is already closed.\n\n` +
            `  Reopen: bd reopen ${ticketId}\n` +
            '  Create new: bd create --title="..." --type=feature',
        );
      }
    },
  };
};

async function getCurrentBranch(directory: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) return null;
    return stdout.trim();
  } catch {
    return null;
  }
}

function extractTicketId(branch: string): string | null {
  const match = branch.match(BEADS_TICKET_RE);
  return match ? match[1] : null;
}

async function checkTicket(ticketId: string): Promise<{ exists: boolean; closed: boolean }> {
  try {
    const proc = Bun.spawn(["bd", "show", ticketId], { stdout: "pipe", stderr: "pipe" });
    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return { exists: false, closed: false };

    const lower = stdout.toLowerCase();
    const hasStatus = lower.includes("status:");
    const isClosed = lower.includes("closed") || lower.includes("done");
    return { exists: true, closed: hasStatus && isClosed };
  } catch {
    return { exists: false, closed: false };
  }
}

export default BeadsGuard;
