import { join } from "node:path";
import {
  type ActivityCommandRunner,
  type StartTmuxCommandResult,
  startTmuxCommand,
} from "./command-activities";

export const TICKET_BUILDER_AGENT = "ticket-builder";
export const TICKET_BUILDER_MODEL = "openai/gpt-5.5";

export type TicketBuilderInput = {
  readonly ticketId: string;
  readonly title: string;
  readonly worktreePath: string;
  readonly attempt: number;
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
  readonly runtimeLogRoot?: string;
};

export type TicketBuilderPrompt = {
  readonly prompt: string;
  readonly promptPath: string;
};

export type TicketBuilderActivityResult = StartTmuxCommandResult & {
  readonly agent: typeof TICKET_BUILDER_AGENT;
  readonly model: typeof TICKET_BUILDER_MODEL;
  readonly promptPath: string;
};

export async function startTicketBuilderActivity(
  input: TicketBuilderInput,
): Promise<TicketBuilderActivityResult> {
  return startTicketBuilder(input, defaultPromptWriter, undefined);
}

export async function startTicketBuilder(
  input: TicketBuilderInput,
  writePrompt: (prompt: TicketBuilderPrompt) => Promise<void>,
  runCommand?: ActivityCommandRunner,
): Promise<TicketBuilderActivityResult> {
  const prompt = buildTicketBuilderPrompt(input);
  await writePrompt(prompt);
  const tmuxResult = await startTmuxCommand(
    {
      ticketId: input.ticketId,
      kind: "build",
      attempt: input.attempt,
      cwd: input.worktreePath,
      runtimeLogRoot: input.runtimeLogRoot,
      command: [
        "opencode",
        "run",
        "--agent",
        TICKET_BUILDER_AGENT,
        "--model",
        TICKET_BUILDER_MODEL,
        "--prompt-file",
        prompt.promptPath,
      ],
    },
    runCommand ?? defaultActivityCommandRunner,
  );

  return {
    ...tmuxResult,
    agent: TICKET_BUILDER_AGENT,
    model: TICKET_BUILDER_MODEL,
    promptPath: prompt.promptPath,
  };
}

export function buildTicketBuilderPrompt(input: TicketBuilderInput): TicketBuilderPrompt {
  const promptPath = join(
    input.runtimeLogRoot ?? ".tickets/logs",
    `ticket_${input.ticketId}_build_${input.attempt}.prompt.md`,
  );
  const commentBlock =
    input.comments.length > 0 ? input.comments.join("\n\n---\n\n") : "No comments.";

  return {
    promptPath,
    prompt: `# Ticket Builder\n\nTicket: ${input.ticketId} - ${input.title}\nAttempt: ${input.attempt}\n\n## Required Reading\n\nRun \`bd show ${input.ticketId}\` before editing. Read ticket comments and relevant project instructions before changing files.\n\n## Acceptance Criteria\n\n${input.acceptanceCriteria}\n\n## Existing Comments\n\n${commentBlock}\n\n## Hard Rules\n\n- Work only in this worktree: ${input.worktreePath}\n- Build the smallest correct implementation that satisfies the acceptance criteria.\n- Commit and push the ticket branch when implementation is complete.\n- Leave a Beads handoff comment with changed files and verification.\n- Never close Beads tickets. Do not run \`bd close\`, do not mark the ticket complete, and do not merge to main.\n`,
  };
}

async function defaultPromptWriter(prompt: TicketBuilderPrompt): Promise<void> {
  await Bun.write(prompt.promptPath, prompt.prompt);
}

async function defaultActivityCommandRunner(command: Parameters<ActivityCommandRunner>[0]) {
  const proc = Bun.spawn([command.command, ...command.args], {
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: command.env ? { ...Bun.env, ...command.env } : undefined,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
