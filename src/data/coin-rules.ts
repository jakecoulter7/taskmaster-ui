import type {
  ActivePowerUpKind,
  AvatarFrame,
  CoinRules,
  CopyablePowerUpKind,
  Crate,
  CrateTierKind,
  CosmeticKind,
  LoadoutSlot,
  NameColour,
  PassivePowerUpKind,
  PowerUpKind,
  TargetedPowerUpKind,
  WishPowerUpKind,
  ProfileTheme,
  Rarity,
  ShopCategory,
  ShopItem,
} from "../types";
import { wallClockToIso } from "../lib/time";

// Every Clim Coin number in one place, free of database imports so the
// score, prediction and notification derivations (and `/rules`) can share
// them. See `coins.ts` for how they're applied.

/** Coins paid out per published week, by finishing position. */
export const PLACEMENT_COINS = {
  first: 10,
  second: 7,
  third: 5,
  /** Everyone else with a recorded score that week. */
  scored: 2,
} as const;

/** Coins for submitting at least one entry on a week (paid at the deadline). */
export const ENTRY_COINS = 2;
/** Coins for voting in a poll (paid when it closes). */
export const POLL_VOTE_COINS = 1;
/** Coins for a People's Choice vote (paid when voting closes). */
export const PEOPLES_CHOICE_VOTE_COINS = 1;
/** Coins for calling a week's winner (paid when the call locks). */
export const PREDICTION_COINS = 1;

/** Golden Week multiplies the week's task score, rounded up. */
export const GOLDEN_WEEK_MULTIPLIER = 1.5;
/** A correct call backed with Double Down pays this instead of +1. */
export const DOUBLE_DOWN_POINTS = 2;
/** Points a Sabotage takes from its target (a deduction). */
export const SABOTAGE_POINTS = -5;
/** Points a Heist moves from its target to its user. */
export const HEIST_POINTS = 5;
/** Coin Rush multiplies the coins a week pays the player. */
export const COIN_RUSH_MULTIPLIER = 2;
/** Bounty Badge adds this share of the next bounty won (rounded up). */
export const BOUNTY_BADGE_SHARE = 0.5;
/** Underdog's bonus points, on the week after two bottom-half finishes. */
export const UNDERDOG_POINTS = 5;
/** How many weeks in a row in the bottom half trigger Underdog. */
export const UNDERDOG_STREAK = 2;

/** The most coins a player can gift in any rolling 7 days. */
export const GIFT_WEEKLY_CAP = 5;
export const GIFT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const GIFT_MESSAGE_MAX = 80;

// ── Shop extras ───────────────────────────────────────────────────────

/** A weekly raffle ticket's price, and how many one player can buy a week. */
export const RAFFLE_TICKET_PRICE = 2;
export const RAFFLE_MAX_TICKETS = 5;
/** A rename token's price (they can be bought any number of times). */
export const RENAME_TOKEN_PRICE = 3;
export const PET_NAME_MAX = 24;
/** Gift wrap's fee, on top of the item's price. */
export const GIFT_WRAP_FEE = 2;
/** The deal of the week's automatic discount. */
export const DEAL_DISCOUNT_PERCENT = 30;
/** The admin override's discount range, inclusive. */
export const DEAL_DISCOUNT_RANGE = { min: 5, max: 90 } as const;
/** The cheapest item the automatic deal picks (smaller discounts round away). */
export const DEAL_MIN_PRICE = 4;
/** The longest shell prompt template, in characters. */
export const SHELL_PROMPT_MAX = 40;

/** A deal's price: `discountPercent` off, rounded in the player's favour. */
export function dealPrice(price: number, discountPercent: number): number {
  return Math.floor((price * (100 - discountPercent)) / 100);
}

/** Bounty Badge's extra coins on a `reward` (rounded up). */
export function bountyBadgeBonus(reward: number): number {
  return Math.ceil(reward * BOUNTY_BADGE_SHARE);
}

/** A shell prompt template with the player's handle in place of `{name}`. */
export function renderShellPrompt(template: string, handle: string): string {
  return template.replaceAll("{name}", handle);
}

/** Golden Week's boost to a week's points, rounded up (never deepens a loss). */
export function goldenWeekPoints(points: number): number {
  return points > 0 ? Math.ceil(points * GOLDEN_WEEK_MULTIPLIER) : points;
}

export const COIN_RULES: CoinRules = {
  placement: { ...PLACEMENT_COINS },
  entry: ENTRY_COINS,
  pollVote: POLL_VOTE_COINS,
  peoplesChoiceVote: PEOPLES_CHOICE_VOTE_COINS,
  prediction: PREDICTION_COINS,
  goldenWeekMultiplier: GOLDEN_WEEK_MULTIPLIER,
  doubleDownPoints: DOUBLE_DOWN_POINTS,
  sabotagePoints: -SABOTAGE_POINTS,
  heistPoints: HEIST_POINTS,
  coinRushMultiplier: COIN_RUSH_MULTIPLIER,
  bountyBadgePercent: BOUNTY_BADGE_SHARE * 100,
  underdogPoints: UNDERDOG_POINTS,
  giftWeeklyCap: GIFT_WEEKLY_CAP,
};

export const SHOP_CATEGORIES = [
  "pet",
  "avatar",
  "cosmetic",
  "power_up",
] as const satisfies readonly ShopCategory[];

export const COSMETIC_KINDS = [
  "title",
  "name_colour",
  "theme",
  "shell_prompt",
  "avatar_frame",
] as const satisfies readonly CosmeticKind[];

export const LOADOUT_SLOTS = [
  "pet",
  "avatar",
  "title",
  "name_colour",
  "theme",
  "shell_prompt",
  "avatar_frame",
] as const satisfies readonly LoadoutSlot[];

/** Avatar frames an admin can sell in the shop. */
export const AVATAR_FRAMES = [
  "neon",
  "glitch",
  "gold",
  "ascii",
  "rainbow",
  "pumpkin",
] as const satisfies readonly AvatarFrame[];

/** Name colours an admin can sell in the shop. */
export const SHOP_NAME_COLOURS = [
  "acid",
  "amber",
  "magenta",
  "cyan",
  "gold",
  "pumpkin",
  "glitch",
  "rainbow",
] as const satisfies readonly NameColour[];

/** Name colours only skill tree capstones grant (see `skill-trees.ts`). */
export const SKILL_NAME_COLOURS = [
  "storm",
  "hacker",
  "friendship",
  "platinum",
  "cartographer",
] as const satisfies readonly NameColour[];

/** Every name colour a player can wear. */
export const NAME_COLOURS = [
  ...SHOP_NAME_COLOURS,
  ...SKILL_NAME_COLOURS,
] as const satisfies readonly NameColour[];

export const PROFILE_THEMES = [
  "phosphor",
  "amber",
  "synthwave",
  "ice",
  "matrix",
  "vaporwave",
  "blueprint",
] as const satisfies readonly ProfileTheme[];

/** Power-ups spent on a live week from the wallet. */
export const ACTIVE_POWER_UP_KINDS = [
  "double_down",
  "hint",
  "golden_week",
  "sabotage",
  "heist",
  "freeze",
  "spyglass",
  "coin_rush",
  "copycat",
] as const satisfies readonly ActivePowerUpKind[];

/** What Copycat can copy: every active power-up but itself. */
export const COPYABLE_POWER_UP_KINDS = ACTIVE_POWER_UP_KINDS.filter(
  (kind): kind is CopyablePowerUpKind => kind !== "copycat",
);

/** Active power-ups aimed at another player. */
export const TARGETED_POWER_UP_KINDS = [
  "sabotage",
  "heist",
  "freeze",
  "spyglass",
] as const satisfies readonly TargetedPowerUpKind[];

/** Power-ups that work by themselves once bought. */
export const PASSIVE_POWER_UP_KINDS = [
  "shield",
  "mirror",
  "insurance",
  "bounty_badge",
  "underdog",
] as const satisfies readonly PassivePowerUpKind[];

/** The One Wish Willow's effect: spent by making a wish, not on a week. */
export const WISH_POWER_UP: WishPowerUpKind = "wish";
/** The longest wish (and Taskmaster's reply), in characters. */
export const WISH_MAX = 200;

export const POWER_UP_KINDS = [
  ...ACTIVE_POWER_UP_KINDS,
  ...PASSIVE_POWER_UP_KINDS,
  WISH_POWER_UP,
] as const satisfies readonly PowerUpKind[];

export const isActivePowerUp = (kind: PowerUpKind): kind is ActivePowerUpKind =>
  ACTIVE_POWER_UP_KINDS.some((k) => k === kind);

export const isCopyablePowerUp = (
  kind: PowerUpKind,
): kind is CopyablePowerUpKind =>
  COPYABLE_POWER_UP_KINDS.some((k) => k === kind);

export const isTargetedPowerUp = (
  kind: PowerUpKind,
): kind is TargetedPowerUpKind =>
  TARGETED_POWER_UP_KINDS.some((k) => k === kind);

/** The effect a use has: a Copycat acts as what it copied. */
export const appliedEffect = (use: {
  effect: ActivePowerUpKind;
  copiedEffect?: CopyablePowerUpKind;
}): ActivePowerUpKind => use.copiedEffect ?? use.effect;

// ── Bounties (player-posted challenges) ──────────────────────────────

/** Open bounties lapse this long after posting, freeing their coins. */
export const BOUNTY_DAYS = 7;
export const BOUNTY_MS = BOUNTY_DAYS * 24 * 60 * 60 * 1000;
/** The rewards a bounty can offer, inclusive. */
export const BOUNTY_REWARD_RANGE = { min: 1, max: 50 } as const;
/** How many open bounties one player can have at once. */
export const BOUNTY_OPEN_LIMIT = 3;
export const BOUNTY_TITLE_MAX = 80;
export const BOUNTY_DETAILS_MAX = 500;
export const BOUNTY_NOTE_MAX = 200;

// ── Marketplace (player-to-player resale) ─────────────────────────────

/** Listings (and the offers on them) expire this long after listing. */
export const MARKET_LISTING_DAYS = 7;
export const MARKET_LISTING_MS = MARKET_LISTING_DAYS * 24 * 60 * 60 * 1000;
/** Price range as a share of the item's shop price. */
export const MARKET_MIN_SHARE = 0.5;
export const MARKET_MAX_SHARE = 3;
/** Crate exclusives are never sold in the shop, so they get a fixed range. */
export const MARKET_CRATE_ONLY_RANGE = { min: 5, max: 60 } as const;

/**
 * Power-ups that can be resold: the ones spent by a stored row (a week's
 * use or a wish), so a sale can check the charge is unused. Passive ones
 * (Shield, Mirror, Insurance, Bounty Badge, Underdog) are spent by derived
 * effects and stay put.
 */
export const MARKET_POWER_UP_KINDS = [
  ...ACTIVE_POWER_UP_KINDS,
  WISH_POWER_UP,
] as const satisfies readonly PowerUpKind[];

/** Whether an item may be listed at all (skill tree rewards never can). */
export function isTradeable(
  item: Pick<ShopItem, "skillOnly" | "category" | "powerUp">,
): boolean {
  if (item.skillOnly) return false;
  if (item.category !== "power_up") return true;
  return MARKET_POWER_UP_KINDS.some((k) => k === item.powerUp);
}

/** The prices `item` may be listed at (and offered for), inclusive. */
export function marketPriceRange(item: Pick<ShopItem, "price" | "crateOnly">): {
  min: number;
  max: number;
} {
  if (item.crateOnly || item.price <= 0) return { ...MARKET_CRATE_ONLY_RANGE };
  const min = Math.max(1, Math.ceil(item.price * MARKET_MIN_SHARE));
  return { min, max: Math.max(min, item.price * MARKET_MAX_SHARE) };
}

// ── Sale windows (limited-time stock and seasonal eggs) ───────────────

/** Whether a sale window (ISO instants, either end open) includes `now`. */
export function inSaleWindow(
  window: { availableFrom?: string; availableUntil?: string },
  now: number,
): boolean {
  const from = window.availableFrom
    ? new Date(window.availableFrom).getTime()
    : -Infinity;
  const until = window.availableUntil
    ? new Date(window.availableUntil).getTime()
    : Infinity;
  return from <= now && now < until;
}

// ── Crates (lootboxes, shown to players as eggs) ───────────────────────────────────────────────

export const RARITIES = [
  "common",
  "rare",
  "epic",
  "legendary",
] as const satisfies readonly Rarity[];

/** The lowest price of each rarity tier, from rarest down. */
const RARITY_FLOORS: [Rarity, number][] = [
  ["legendary", 20],
  ["epic", 15],
  ["rare", 8],
  ["common", 0],
];

/** An item's rarity, from its price: ≤7 common, 8–14 rare, 15–19 epic, 20+ legendary. */
export function rarityOf(price: number): Rarity {
  return RARITY_FLOORS.find(([, floor]) => price >= floor)?.[0] ?? "common";
}

/** Every tier a crate can roll, rarest wearables first, then power-ups. */
export const CRATE_TIER_KINDS = [
  ...RARITIES,
  "power_up",
] as const satisfies readonly CrateTierKind[];

/**
 * The shop categories in a crate's rarity tiers. Power-ups drop separately,
 * through the crate's small `powerUpChance`.
 */
export const CRATE_CATEGORIES = [
  "pet",
  "avatar",
  "cosmetic",
] as const satisfies readonly ShopCategory[];

/**
 * The crates on sale, which players see as eggs to crack open. With the
 * starter catalogue a Mystery Egg roll is worth about 9 coins and a
 * Fabergé one about 13, so the cheap egg is slightly better value than
 * buying outright, but you don't get to choose. Each egg's pixel art lives
 * in `public/shop/eggs/<id>.svg`, with `-top` / `-bottom` halves for the
 * cracking animation.
 */
export const CRATES: readonly Crate[] = [
  {
    id: "mystery-egg",
    name: "Mystery Egg",
    description:
      "Hatches a random pet, avatar or cosmetic you don't own yet. Anything can come out, very occasionally even a power-up.",
    price: 8,
    odds: { common: 0.6, rare: 0.28, epic: 0.1, legendary: 0.02 },
    powerUpChance: 0.02,
  },
  {
    id: "faberge-egg",
    name: "Fabergé Egg",
    description:
      "No commons: rare or better, with five times the legendary odds and a better shot at a power-up.",
    price: 15,
    odds: { rare: 0.55, epic: 0.35, legendary: 0.1 },
    powerUpChance: 0.05,
  },
  // Seasonal eggs: on sale for a limited time, and they hatch only their own
  // exclusives (items whose `crateId` names them), which no other egg drops.
  // Times are UK wall-clock.
  {
    id: "halloween-egg",
    name: "Haunted Egg",
    description:
      "Halloween only. Hatches spooky exclusives you can't get anywhere else, and it's gone after the 31st.",
    price: 10,
    odds: { common: 0.5, rare: 0.3, epic: 0.15, legendary: 0.05 },
    powerUpChance: 0.03,
    exclusive: true,
    availableFrom: wallClockToIso("2026-10-21 00:00"),
    availableUntil: wallClockToIso("2026-10-31 23:59:59"),
  },
];

/** The crates on sale at `now` (seasonal eggs only in their window). */
export const cratesOnSale = (now: number): Crate[] =>
  CRATES.filter((crate) => inSaleWindow(crate, now));

/** An egg's pixel art: whole, and the two halves it cracks into. */
export const eggArt = (crate: Pick<Crate, "id">) => ({
  whole: `/shop/eggs/${crate.id}.svg`,
  top: `/shop/eggs/${crate.id}-top.svg`,
  bottom: `/shop/eggs/${crate.id}-bottom.svg`,
});

export const getCrate = (id: string): Crate | undefined =>
  CRATES.find((crate) => crate.id === id);
