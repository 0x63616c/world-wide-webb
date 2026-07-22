CREATE TABLE "board_tile_placement" (
	"tile_id" text PRIMARY KEY NOT NULL,
	"world_col" integer NOT NULL,
	"world_row" integer NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
