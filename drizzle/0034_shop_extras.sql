ALTER TYPE "public"."cosmetic_kind" ADD VALUE 'shell_prompt';--> statement-breakpoint
ALTER TYPE "public"."cosmetic_kind" ADD VALUE 'avatar_frame';--> statement-breakpoint
ALTER TYPE "public"."loadout_slot" ADD VALUE 'shell_prompt';--> statement-breakpoint
ALTER TYPE "public"."loadout_slot" ADD VALUE 'avatar_frame';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'heist';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'freeze';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'spyglass';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'coin_rush';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'copycat';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'bounty_badge';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'underdog';--> statement-breakpoint
CREATE TABLE "bundle_purchases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bundle_purchases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_purchases_price_positive" CHECK ("bundle_purchases"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "raffle_tickets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "raffle_tickets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" text NOT NULL,
	"player_id" text NOT NULL,
	"price" integer NOT NULL,
	"nonce" text DEFAULT gen_random_uuid()::text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raffle_tickets_price_positive" CHECK ("raffle_tickets"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rename_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rename_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"price" integer NOT NULL,
	"item_id" text,
	"name" text,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rename_tokens_price_positive" CHECK ("rename_tokens"."price" >= 0),
	CONSTRAINT "rename_tokens_spent_fields" CHECK (("rename_tokens"."used_at" is null) = ("rename_tokens"."item_id" is null)
        and ("rename_tokens"."used_at" is null) = ("rename_tokens"."name" is null)),
	CONSTRAINT "rename_tokens_name_length" CHECK ("rename_tokens"."name" is null or char_length("rename_tokens"."name") between 1 and 24)
);
--> statement-breakpoint
CREATE TABLE "shop_bundle_items" (
	"bundle_id" text NOT NULL,
	"item_id" text NOT NULL,
	CONSTRAINT "shop_bundle_items_bundle_id_item_id_pk" PRIMARY KEY("bundle_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "shop_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_bundles_price_range" CHECK ("shop_bundles"."price" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "shop_deals" (
	"week_start" date PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"discount_percent" integer NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_deals_discount_range" CHECK ("shop_deals"."discount_percent" between 5 and 90),
	CONSTRAINT "shop_deals_week_starts_monday" CHECK (extract(isodow from "shop_deals"."week_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "wrapped_gifts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wrapped_gifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"from_player_id" text NOT NULL,
	"to_player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"purchase_id" integer NOT NULL,
	"price" integer NOT NULL,
	"fee" integer NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wrapped_gifts_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "wrapped_gifts_not_self" CHECK ("wrapped_gifts"."from_player_id" <> "wrapped_gifts"."to_player_id"),
	CONSTRAINT "wrapped_gifts_price_positive" CHECK ("wrapped_gifts"."price" >= 0 and "wrapped_gifts"."fee" >= 0),
	CONSTRAINT "wrapped_gifts_message_length" CHECK ("wrapped_gifts"."message" is null or char_length("wrapped_gifts"."message") <= 80)
);
--> statement-breakpoint
ALTER TABLE "power_up_uses" DROP CONSTRAINT "power_up_uses_target_when_sabotage";--> statement-breakpoint
ALTER TABLE "power_up_uses" DROP CONSTRAINT "power_up_uses_active_effect";--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD COLUMN "bundle_purchase_id" integer;--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD COLUMN "copied_effect" "power_up_kind";--> statement-breakpoint
ALTER TABLE "bundle_purchases" ADD CONSTRAINT "bundle_purchases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_purchases" ADD CONSTRAINT "bundle_purchases_bundle_id_shop_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."shop_bundles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_tickets" ADD CONSTRAINT "raffle_tickets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_tickets" ADD CONSTRAINT "raffle_tickets_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rename_tokens" ADD CONSTRAINT "rename_tokens_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rename_tokens" ADD CONSTRAINT "rename_tokens_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_bundle_items" ADD CONSTRAINT "shop_bundle_items_bundle_id_shop_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."shop_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_bundle_items" ADD CONSTRAINT "shop_bundle_items_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_deals" ADD CONSTRAINT "shop_deals_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_gifts" ADD CONSTRAINT "wrapped_gifts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_gifts" ADD CONSTRAINT "wrapped_gifts_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_gifts" ADD CONSTRAINT "wrapped_gifts_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_gifts" ADD CONSTRAINT "wrapped_gifts_from_player_season_fk" FOREIGN KEY ("from_player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_gifts" ADD CONSTRAINT "wrapped_gifts_to_player_season_fk" FOREIGN KEY ("to_player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bundle_purchases_player_id_idx" ON "bundle_purchases" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "raffle_tickets_task_id_idx" ON "raffle_tickets" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "raffle_tickets_player_id_idx" ON "raffle_tickets" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "rename_tokens_player_id_idx" ON "rename_tokens" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "shop_bundle_items_item_id_idx" ON "shop_bundle_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "wrapped_gifts_from_player_id_idx" ON "wrapped_gifts" USING btree ("from_player_id");--> statement-breakpoint
CREATE INDEX "wrapped_gifts_to_player_id_idx" ON "wrapped_gifts" USING btree ("to_player_id");--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_bundle_purchase_id_bundle_purchases_id_fk" FOREIGN KEY ("bundle_purchase_id") REFERENCES "public"."bundle_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_purchases_bundle_purchase_id_idx" ON "coin_purchases" USING btree ("bundle_purchase_id");--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_target_when_targeted" CHECK ((coalesce("power_up_uses"."copied_effect", "power_up_uses"."effect")::text in ('sabotage', 'heist', 'freeze', 'spyglass')) = ("power_up_uses"."target_player_id" is not null));--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_copied_when_copycat" CHECK (("power_up_uses"."effect"::text = 'copycat') = ("power_up_uses"."copied_effect" is not null));--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_copied_active" CHECK ("power_up_uses"."copied_effect" is null or "power_up_uses"."copied_effect"::text not in ('copycat', 'shield', 'mirror', 'insurance', 'wish', 'bounty_badge', 'underdog'));--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_active_effect" CHECK ("power_up_uses"."effect"::text not in ('shield', 'mirror', 'insurance', 'wish', 'bounty_badge', 'underdog'));