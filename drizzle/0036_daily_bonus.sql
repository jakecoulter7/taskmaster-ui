CREATE TABLE "daily_bonus_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_bonus_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"player_id" text NOT NULL,
	"claimed_on" date NOT NULL,
	"day" integer NOT NULL,
	"coins" integer NOT NULL,
	"item_gift_id" integer,
	"egg_gift_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_bonus_claims_item_gift_id_unique" UNIQUE("item_gift_id"),
	CONSTRAINT "daily_bonus_claims_egg_gift_id_unique" UNIQUE("egg_gift_id"),
	CONSTRAINT "daily_bonus_claims_player_id_claimed_on_unique" UNIQUE("player_id","claimed_on"),
	CONSTRAINT "daily_bonus_claims_day_range" CHECK ("daily_bonus_claims"."day" between 1 and 7),
	CONSTRAINT "daily_bonus_claims_coins_positive" CHECK ("daily_bonus_claims"."coins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_bonus_rewards" (
	"season_id" text NOT NULL,
	"day" integer NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"item_id" text,
	"crate_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_bonus_rewards_season_id_day_pk" PRIMARY KEY("season_id","day"),
	CONSTRAINT "daily_bonus_rewards_day_range" CHECK ("daily_bonus_rewards"."day" between 1 and 7),
	CONSTRAINT "daily_bonus_rewards_coins_range" CHECK ("daily_bonus_rewards"."coins" between 0 and 100),
	CONSTRAINT "daily_bonus_rewards_one_extra" CHECK ("daily_bonus_rewards"."item_id" is null or "daily_bonus_rewards"."crate_id" is null),
	CONSTRAINT "daily_bonus_rewards_not_empty" CHECK ("daily_bonus_rewards"."coins" > 0 or "daily_bonus_rewards"."item_id" is not null or "daily_bonus_rewards"."crate_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_item_gift_id_item_gifts_id_fk" FOREIGN KEY ("item_gift_id") REFERENCES "public"."item_gifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_egg_gift_id_egg_gifts_id_fk" FOREIGN KEY ("egg_gift_id") REFERENCES "public"."egg_gifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_player_season_fk" FOREIGN KEY ("player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bonus_rewards" ADD CONSTRAINT "daily_bonus_rewards_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bonus_rewards" ADD CONSTRAINT "daily_bonus_rewards_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_bonus_rewards_item_id_idx" ON "daily_bonus_rewards" USING btree ("item_id");