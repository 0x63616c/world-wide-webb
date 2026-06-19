import { describe, expect, it } from "vitest";
import {
  buildTicketBuilderPrompt,
  startTicketBuilder,
  TICKET_BUILDER_AGENT,
  TICKET_BUILDER_MODEL,
  type TicketBuilderPrompt,
} from "./agent-activities";
import type { ActivityCommand, ActivityCommandRunner } from "./command-activities";

describe("ticket builder activity", () => {
  it("builds a prompt that forbids ticket closure and requires ticket context", () => {
    const prompt = buildTicketBuilderPrompt(baseInput());

    expect(prompt.promptPath).toBe("/cache/logs/ticket_www-3agy.9_build_1.prompt.md");
    expect(prompt.prompt).toContain("Run `bd show www-3agy.9` before editing");
    expect(prompt.prompt).toContain("- [ ] Builder uses explicit OpenCode agent/model");
    expect(prompt.prompt).toContain("Never close Beads tickets");
    expect(prompt.prompt).toContain("Do not run `bd close`");
    expect(prompt.prompt).toContain("Commit and push the ticket branch");
  });

  it("archives the prompt and starts opencode in tmux with explicit agent and model", async () => {
    const prompts: TicketBuilderPrompt[] = [];
    const commands: ActivityCommand[] = [];
    const result = await startTicketBuilder(
      baseInput(),
      async (prompt) => {
        prompts.push(prompt);
      },
      fakeRunner(commands),
    );

    expect(prompts).toHaveLength(1);
    expect(result).toEqual(
      expect.objectContaining({
        agent: TICKET_BUILDER_AGENT,
        model: TICKET_BUILDER_MODEL,
        sessionName: "ticket_www-3agy.9_build_1",
        promptPath: "/cache/logs/ticket_www-3agy.9_build_1.prompt.md",
      }),
    );
    expect(commands[1]).toEqual({
      command: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "ticket_www-3agy.9_build_1",
        "-c",
        "/repo/.worktrees/tickets/www-3agy.9-builder",
        "'opencode' 'run' '--agent' 'ticket-builder' '--model' 'openai/gpt-5.5' '--prompt-file' '/cache/logs/ticket_www-3agy.9_build_1.prompt.md' > '/cache/logs/ticket_www-3agy.9_build_1.stdout.log' 2> '/cache/logs/ticket_www-3agy.9_build_1.stderr.log'",
      ],
    });
  });
});

function baseInput() {
  return {
    ticketId: "www-3agy.9",
    title: "Implement OpenCode builder Activity",
    worktreePath: "/repo/.worktrees/tickets/www-3agy.9-builder",
    attempt: 1,
    acceptanceCriteria: "- [ ] Builder uses explicit OpenCode agent/model",
    comments: ["Previous reviewer asked for more tests."],
    runtimeLogRoot: "/cache/logs",
  };
}

function fakeRunner(commands: ActivityCommand[]): ActivityCommandRunner {
  return async (command) => {
    commands.push(command);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}
