import { describe, expect, it } from "vitest";
import { mapIssues, type RawIssue } from "./map";

describe("mapIssues", () => {
  it("maps bd issues into the design issue graph", () => {
    const raw: RawIssue[] = [
      {
        id: "www-epic",
        title: "Platform epic",
        status: "in_progress",
        priority: -1,
        issue_type: "epic",
        owner: "6991398+0x63616c@users.noreply.github.com",
        created_by: "alice@example.com",
        created_at: "2026-06-01T12:00:00Z",
      },
      {
        id: "www-a",
        title: "Ready child",
        status: "open",
        priority: 1,
        issue_type: "feature",
        owner: "bob@example.com",
        created_at: "not-a-date",
        updated_at: "2026-06-03T12:00:00Z",
        comments: [
          {
            id: "comment_1",
            author: "6991398+0x63616c@users.noreply.github.com",
            text: "## Builder summary\n\nBuilt it.",
            created_at: "2026-06-02T12:00:00Z",
          },
        ],
        dependencies: [{ issue_id: "www-a", depends_on_id: "www-epic", type: "parent-child" }],
      },
      {
        id: "www-b",
        title: "Blocked child",
        status: "blocked",
        priority: 99,
        issue_type: "bug",
        dependencies: [
          { issue_id: "www-b", depends_on_id: "www-epic", type: "parent-child" },
          { issue_id: "www-b", depends_on_id: "www-a", type: "blocks" },
          { issue_id: "www-b", depends_on_id: "www-missing", type: "blocks" },
        ],
      },
    ];

    const mapped = mapIssues(raw);

    expect(mapped).toEqual([
      expect.objectContaining({
        id: "www-epic",
        type: "epic",
        status: "in_progress",
        p: 0,
        assignee: "0x63616c",
        createdBy: "alice",
        children: ["www-a", "www-b"],
      }),
      expect.objectContaining({
        id: "www-a",
        type: "feature",
        status: "ready",
        p: 1,
        assignee: "bob",
        created: 0,
        updated: Date.parse("2026-06-03T12:00:00Z"),
        blockedBy: [],
        blocks: ["www-b"],
        comments: [
          {
            id: "comment_1",
            author: "0x63616c",
            text: "## Builder summary\n\nBuilt it.",
            created: Date.parse("2026-06-02T12:00:00Z"),
          },
        ],
      }),
      expect.objectContaining({
        id: "www-b",
        type: "bug",
        status: "blocked",
        p: 4,
        assignee: "",
        blockedBy: ["www-a"],
        blocks: [],
      }),
    ]);
  });
});
