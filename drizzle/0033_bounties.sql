CREATE TYPE "public"."bounty_status" AS ENUM('open', 'awarded', 'cancelled');--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bounties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"poster_id" text NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"reward" integer NOT NULL,
	"status" "bounty_status" DEFAULT 'open' NOT NULL,
	"winner_id" text,
	"resolved_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "bounties_reward_range" CHECK ("bounties"."reward" between 1 and 10000),
	CONSTRAINT "bounties_title_length" CHECK (char_length("bounties"."title") between 1 and 80),
	CONSTRAINT "bounties_details_length" CHECK ("bounties"."details" is null or char_length("bounties"."details") <= 500),
	CONSTRAINT "bounties_winner_when_awarded" CHECK (("bounties"."status" = 'awarded') = ("bounties"."winner_id" is not null)),
	CONSTRAINT "bounties_closed_when_not_open" CHECK (("bounties"."status" = 'open') = ("bounties"."closed_at" is null)),
	CONSTRAINT "bounties_winner_not_poster" CHECK ("bounties"."winner_id" <> "bounties"."poster_id")
);
--> statement-breakpoint
CREATE TABLE "bounty_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bounty_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bounty_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounty_claims_one_per_player" UNIQUE("bounty_id","player_id"),
	CONSTRAINT "bounty_claims_note_length" CHECK ("bounty_claims"."note" is null or char_length("bounty_claims"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_poster_season_fk" FOREIGN KEY ("poster_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_winner_season_fk" FOREIGN KEY ("winner_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bounties_season_id_idx" ON "bounties" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "bounties_poster_id_idx" ON "bounties" USING btree ("poster_id");--> statement-breakpoint
CREATE INDEX "bounties_winner_id_idx" ON "bounties" USING btree ("winner_id");--> statement-breakpoint
CREATE INDEX "bounty_claims_player_id_idx" ON "bounty_claims" USING btree ("player_id");