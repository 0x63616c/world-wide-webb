import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The generated schema barrel (Track C, C7): the union of this app's base
  // schema with every folded feature's schema.ts. Repointed here from
  // ./src/db/schema.ts so drizzle-kit sees the portal_* tables at their new home
  // (features/guest-wifi/schema.ts) — the table SET is identical, so db:generate
  // emits no migration (no DROP). Re-run `bun run apps:gen` to regenerate it.
  schema: "../../features/_generated/schema.gen.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://cc:cc@localhost:5432/controlcenter",
  },
});
