import type { BoardData, Comment } from "./types";

export async function fetchBoard(): Promise<BoardData> {
  const res = await fetch("/api/board-data");
  if (!res.ok) throw new Error(`board-data: ${res.status}`);
  return res.json() as Promise<BoardData>;
}

export async function fetchComments(id: string): Promise<Comment[]> {
  const res = await fetch(`/api/comments/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`comments: ${res.status}`);
  return res.json() as Promise<Comment[]>;
}

export async function triggerSync(): Promise<void> {
  await fetch("/api/sync", { method: "POST" });
}
