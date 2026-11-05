-- The tip titles added with the bigger skill trees (`SKILL_REWARD_ITEMS` in
-- `src/data/skill-trees.ts`): skill-only, never sold, granted by unlocking
-- each pathway's title tip. Re-runnable: existing ids are left alone.
INSERT INTO "shop_items" ("id", "name", "description", "category", "price", "cosmetic_kind", "cosmetic_value", "available", "skill_only", "sort_order") VALUES
	('skill-title-lost-my-marbles', 'Title: Lost My Marbles', 'Stormbrewer skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Lost My Marbles', true, true, 910),
	('skill-title-10x-engineer', 'Title: 10x Engineer', 'Elite Hacker skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', '10x Engineer', true, true, 911),
	('skill-title-hype-squad', 'Title: Hype Squad', 'Friendkeeper skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Hype Squad', true, true, 912),
	('skill-title-head-prefect', 'Title: Head Prefect', 'Overachiever skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Head Prefect', true, true, 913),
	('skill-title-star-elephant', 'Title: Star Elephant', 'Elephant Cartographer skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Star Elephant', true, true, 914)
ON CONFLICT ("id") DO NOTHING;
