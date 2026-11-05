import { z } from "zod";

export const playerID = z.string().regex(/^media_player\.[a-z0-9_]+$/);
export const mediaReference = z.object({
  id: z.string().max(2048),
  type: z.string().min(1).max(100),
});
const mediaItem = mediaReference.extend({
  title: z.string(),
  kind: z.string(),
  playable: z.boolean(),
  expandable: z.boolean(),
});
export const librarySchema = z.object({ title: z.string(), items: z.array(mediaItem) });
export const spotifyStateSchema = z.object({
  configured: z.boolean(),
  accounts: z.array(z.object({ id: playerID, name: z.string() })),
  rooms: z.array(
    z.object({
      id: playerID,
      name: z.string(),
      coordinator: playerID,
      available: z.boolean(),
      playing: z.boolean(),
      title: z.string().nullable(),
      artist: z.string().nullable(),
    }),
  ),
});
export type SpotifyState = z.infer<typeof spotifyStateSchema>;
export type MediaReference = z.infer<typeof mediaReference>;
