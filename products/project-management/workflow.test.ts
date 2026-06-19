import { describe, expect, it } from "vitest";
import { workflowColumnsForIssues } from "./workflow";

describe("workflowColumnsForIssues", () => {
  it("groups issues into workflow columns without losing issue order", () => {
    const columns = workflowColumnsForIssues([
      { id: "www-a", status: "ready" },
      { id: "www-b", status: "blocked" },
      { id: "www-c", status: "ready" },
      { id: "www-d", status: "closed" },
      { id: "www-e", status: "in_progress" },
    ]);

    expect(columns).toEqual([
      { id: "ready", title: "Ready", issueIds: ["www-a", "www-c"] },
      { id: "in_progress", title: "In Progress", issueIds: ["www-e"] },
      { id: "blocked", title: "Blocked", issueIds: ["www-b"] },
      { id: "closed", title: "Closed", issueIds: ["www-d"] },
    ]);
  });
});
