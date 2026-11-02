// Display config for Clim Coin: class names and copy keyed by the domain
// unions, so pages and components map variants through one typed table.
import type {
  AvatarFrame,
  BundleBlock,
  CoinOutcome,
  CrateBlock,
  CrateTierKind,
  GiftBlock,
  GiftWrapBlock,
  NameColour,
  PowerUpBlock,
  PowerUpKind,
  ProfileTheme,
  PurchaseBlock,
  RaffleBlock,
  RenameBlock,
  ShopItem,
  ShopTab,
} from "../types";
import { withBase } from "./url";

/** Text colour utility (or effect class, in `global.css`) per name colour. */
export const NAME_COLOUR_CLASS: Record<NameColour, string> = {
  acid: "text-acid",
  amber: "text-amber",
  magenta: "text-magenta",
  cyan: "text-cyan",
  gold: "name-gold",
  pumpkin: "text-pumpkin",
  glitch: "name-glitch",
  rainbow: "name-rainbow",
  storm: "name-storm",
  hacker: "name-hacker",
  friendship: "name-friendship",
  platinum: "name-platinum",
  cartographer: "name-cartographer",
};

export const PROFILE_THEME_INFO: Record<
  ProfileTheme,
  { label: string; class: string; swatch: string }
> = {
  phosphor: {
    label: "Phosphor",
    class: "profile-theme-phosphor",
    swatch: "border-acid text-acid",
  },
  amber: {
    label: "Amber CRT",
    class: "profile-theme-amber",
    swatch: "border-amber text-amber",
  },
  synthwave: {
    label: "Synthwave",
    class: "profile-theme-synthwave",
    swatch: "border-magenta text-magenta",
  },
  ice: {
    label: "Ice",
    class: "profile-theme-ice",
    swatch: "border-cyan text-cyan",
  },
  matrix: {
    label: "Matrix",
    class: "profile-theme-matrix",
    swatch: "border-acid text-acid profile-theme-matrix",
  },
  vaporwave: {
    label: "Vaporwave",
    class: "profile-theme-vaporwave",
    swatch: "border-magenta text-cyan profile-theme-vaporwave",
  },
  blueprint: {
    label: "Blueprint",
    class: "profile-theme-blueprint",
    swatch: "border-cyan text-cyan profile-theme-blueprint",
  },
};

/** What the buy button says instead when an item can't be bought. */
export const PURCHASE_BLOCK_LABEL: Record<PurchaseBlock, string> = {
  guest: "sign in to buy",
  owned: "owned",
  used: "used this season",
  "crate-only": "eggs only",
  "skill-only": "skill tree reward",
  unaffordable: "not enough coins",
  unavailable: "retired",
  "sold-out": "sold out",
  "season-closed": "season closed",
};

export const POWER_UP_BLOCK_LABEL: Record<PowerUpBlock, string> = {
  "no-charge": "already used this season",
  "not-live": "no live week",
  "already-used": "you've used a power-up this week",
  "no-prediction": "call the winner first",
  "no-hint": "no hint set for this week",
  "season-closed": "season closed",
  frozen: "you've been frozen this week",
  "nothing-to-copy": "nobody used a power-up it can copy last week",
  "no-targets": "nobody left to aim it at this week",
};

/** The notice shown after a wallet or shop action redirects back. */
export const COIN_OUTCOME_NOTICE: Record<
  CoinOutcome,
  { tone: "success" | "error"; message: string }
> = {
  bought: { tone: "success", message: "Purchase complete. Enjoy!" },
  opened: { tone: "success", message: "Egg cracked!" },
  "crate-empty": {
    tone: "error",
    message: "You already own everything that egg can hatch.",
  },
  owned: {
    tone: "error",
    message: "You already own that. Power-ups can be bought once a season.",
  },
  unaffordable: {
    tone: "error",
    message: "You don't have enough Clim Coin for that.",
  },
  unavailable: { tone: "error", message: "That item isn't for sale." },
  "sold-out": {
    tone: "error",
    message: "Sold out: the shop's stock of that is gone for this season.",
  },
  "season-closed": {
    tone: "error",
    message: "This season is closed, so its wallets are frozen.",
  },
  equipped: { tone: "success", message: "Equipped." },
  unequipped: { tone: "success", message: "Taken off." },
  used: { tone: "success", message: "Power-up used. Good luck!" },
  invalid: { tone: "error", message: "That didn't work. Try again." },
  "already-used": {
    tone: "error",
    message: "You've already used a power-up this week.",
  },
  "already-sabotaged": {
    tone: "error",
    message:
      "That player has already been hit this week (or can't be targeted now).",
  },
  "no-prediction": {
    tone: "error",
    message: "Call this week's winner before doubling down.",
  },
  "no-hint": {
    tone: "error",
    message: "The Taskmaster hasn't left a hint for this week.",
  },
  "not-live": {
    tone: "error",
    message: "Power-ups can only be used on the live week.",
  },
  "no-charge": {
    tone: "error",
    message: "You don't hold that power-up, or you've used it this season.",
  },
  gifted: { tone: "success", message: "Gift sent. How generous!" },
  "gift-limit": {
    tone: "error",
    message: "That's over your weekly gift limit. Try a smaller amount.",
  },
  wished: {
    tone: "success",
    message:
      "Wish sent to the Taskmaster. You'll be notified when they decide.",
  },
  frozen: {
    tone: "error",
    message: "You've been frozen: no power-ups for you this week.",
  },
  "target-used": {
    tone: "error",
    message: "Too late: they've already used a power-up this week.",
  },
  "tickets-bought": {
    tone: "success",
    message: "Tickets bought. The draw is at the week's deadline. Good luck!",
  },
  "raffle-limit": {
    tone: "error",
    message: "That's more raffle tickets than you can hold this week.",
  },
  "raffle-closed": {
    tone: "error",
    message: "There's no raffle running right now.",
  },
  "token-bought": {
    tone: "success",
    message: "Rename token bought. Spend it on a pet below.",
  },
  renamed: { tone: "success", message: "Pet renamed. Say hello!" },
  "no-token": {
    tone: "error",
    message: "You need an unspent rename token (and to own that pet).",
  },
  wrapped: {
    tone: "success",
    message: "Gift wrapped and delivered. How thoughtful!",
  },
  "recipient-owns": {
    tone: "error",
    message: "They already have that one. Pick something else.",
  },
  "bundle-bought": {
    tone: "success",
    message: "Bundle bought. Everything's in your inventory.",
  },
  disabled: { tone: "error", message: "That isn't available right now." },
};

export const GIFT_BLOCK_LABEL: Record<GiftBlock, string> = {
  "season-closed": "This season is closed, so its wallets are frozen.",
  limit:
    "You've hit your gift limit for this week. It frees up as older gifts pass 7 days.",
  unaffordable: "You don't have any coins to give right now.",
  "no-recipients": "There's nobody else in your season to send coins to.",
};

/**
 * Each crate tier's label and colours: the rarities, and power-ups (always
 * shown with its name, never colour alone).
 */
export const RARITY_INFO: Record<
  CrateTierKind,
  { label: string; text: string; badge: string }
> = {
  common: {
    label: "Common",
    text: "text-ink-dim",
    badge: "border-grid bg-term-bg text-ink-dim",
  },
  rare: {
    label: "Rare",
    text: "text-cyan",
    badge: "border-cyan/40 bg-cyan/10 text-cyan",
  },
  epic: {
    label: "Epic",
    text: "text-magenta",
    badge: "border-magenta/40 bg-magenta/10 text-magenta",
  },
  legendary: {
    label: "Legendary",
    text: "text-amber",
    badge: "border-amber/50 bg-amber/10 text-amber",
  },
  power_up: {
    label: "Power-up",
    text: "text-acid",
    badge: "border-acid/50 bg-acid/10 text-acid",
  },
};

export const CRATE_BLOCK_LABEL: Record<CrateBlock, string> = {
  guest: "sign in to open",
  empty: "you own everything in it",
  unaffordable: "not enough coins",
  "season-closed": "season closed",
};

/** A chance out of 1 as a percentage, e.g. "2.5%" or "<0.1%". */
export function formatChance(chance: number): string {
  const pct = chance * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1).replace(/\.0$/, "")}%`;
}

const HOUR_MS = 60 * 60 * 1000;

/** How long until a sale ends, e.g. "3 days left" or "<1 hour left". */
export function timeLeftLabel(until: string, now: number = Date.now()): string {
  const ms = new Date(until).getTime() - now;
  if (ms < HOUR_MS) return "<1 hour left";
  if (ms < 48 * HOUR_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    return `${hours} hour${hours === 1 ? "" : "s"} left`;
  }
  return `${Math.floor(ms / (24 * HOUR_MS))} days left`;
}

const OUTCOMES = new Set(Object.keys(COIN_OUTCOME_NOTICE));

/** The outcome named in a `?coins=` param, if it's a real one. */
export function parseCoinOutcome(
  value: string | null,
): CoinOutcome | undefined {
  return value && OUTCOMES.has(value) ? (value as CoinOutcome) : undefined;
}

/** Each avatar frame's label and class (the frames live in `global.css`). */
export const AVATAR_FRAME_INFO: Record<
  AvatarFrame,
  { label: string; class: string }
> = {
  neon: { label: "Neon", class: "avatar-frame-neon" },
  glitch: { label: "Glitch", class: "avatar-frame-glitch" },
  gold: { label: "Gold", class: "avatar-frame-gold" },
  ascii: { label: "ASCII", class: "avatar-frame-ascii" },
  rainbow: { label: "Rainbow", class: "avatar-frame-rainbow" },
  pumpkin: { label: "Pumpkin", class: "avatar-frame-pumpkin" },
};

/** The shop's tabs, in order, with their labels and commands. */
export const SHOP_TAB_INFO: Record<
  ShopTab,
  { label: string; command: string }
> = {
  featured: { label: "featured", command: "ls ./featured" },
  eggs: { label: "eggs", command: "ls ./eggs --odds" },
  "power-ups": { label: "power-ups", command: "ls ./power-ups" },
  cosmetics: { label: "cosmetics", command: "ls ./flair" },
  pets: { label: "pets & avatars", command: "ls ./pets ./avatars" },
  extras: { label: "extras", command: "ls ./extras" },
};

export const SHOP_TABS = Object.keys(SHOP_TAB_INFO) as ShopTab[];

/** A `?tab=` value, if it names a tab. */
export const parseShopTab = (value: string | null | undefined) =>
  SHOP_TABS.find((tab) => tab === value);

/** The tab an item is shelved on (limited-time stock is featured). */
export function shopTabOf(item: ShopItem): ShopTab {
  if (item.availableUntil !== undefined && !item.crateOnly) return "featured";
  if (item.category === "power_up") return "power-ups";
  if (item.category === "cosmetic") return "cosmetics";
  return "pets";
}

/** A link into the shop: a tab, optional query params and a hash. */
export function shopHref(
  tab?: ShopTab,
  params: Record<string, string> = {},
  hash?: string,
): string {
  const query = new URLSearchParams({ ...(tab && { tab }), ...params });
  const search = query.size > 0 ? `?${query}` : "";
  return withBase(`/shop${search}${hash ? `#${hash}` : ""}`);
}

export const BUNDLE_BLOCK_LABEL: Record<BundleBlock, string> = {
  guest: "sign in to buy",
  owned: "you have one of these",
  unavailable: "not for sale",
  "sold-out": "sold out",
  unaffordable: "not enough coins",
  "season-closed": "season closed",
};

export const RAFFLE_BLOCK_LABEL: Record<RaffleBlock, string> = {
  guest: "Sign in as a player to buy tickets.",
  "no-week": "No week is live, so there's no raffle running. Back soon.",
  limit: "You've got as many tickets as you can hold this week.",
  unaffordable: "You don't have enough Clim Coin for a ticket.",
  "season-closed": "This season is closed, so its wallets are frozen.",
};

export const RENAME_BLOCK_LABEL: Record<RenameBlock, string> = {
  guest: "Sign in as a player to buy rename tokens.",
  unaffordable: "You don't have enough Clim Coin for a token.",
  "season-closed": "This season is closed, so its wallets are frozen.",
};

export const GIFT_WRAP_BLOCK_LABEL: Record<GiftWrapBlock, string> = {
  guest: "Sign in as a player to send gifts.",
  "no-recipients": "There's nobody else in your season to send a gift to.",
  "nothing-to-wrap": "There's nothing on the shelves to wrap right now.",
  "season-closed": "This season is closed, so its wallets are frozen.",
};

/** Each power-up's glyph and colour (always shown beside its name). */
export const POWER_UP_GLYPH: Record<
  PowerUpKind,
  { glyph: string; class: string }
> = {
  double_down: { glyph: "×2", class: "text-cyan" },
  hint: { glyph: "?", class: "text-acid" },
  golden_week: { glyph: "★", class: "text-amber" },
  sabotage: { glyph: "☠", class: "text-danger" },
  shield: { glyph: "◈", class: "text-cyan" },
  mirror: { glyph: "⇄", class: "text-magenta" },
  insurance: { glyph: "✚", class: "text-acid" },
  wish: { glyph: "✧", class: "text-magenta" },
  heist: { glyph: "$→", class: "text-amber" },
  freeze: { glyph: "❄", class: "text-cyan" },
  spyglass: { glyph: "◎", class: "text-acid" },
  coin_rush: { glyph: "¢×2", class: "text-amber" },
  copycat: { glyph: "⧉", class: "text-magenta" },
  bounty_badge: { glyph: "✪", class: "text-gold" },
  underdog: { glyph: "↑", class: "text-acid" },
};
