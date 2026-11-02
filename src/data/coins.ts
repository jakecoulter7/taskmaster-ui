import type {
  ActivePowerUpKind,
  CoinAdjustment,
  CoinGift,
  CoinLedgerEntry,
  CoinLedgerKind,
  CoinPurchase,
  CompetitionData,
  Crate,
  CrateOpen,
  CrateTier,
  CrateTierKind,
  CosmeticKind,
  EggGift,
  EntryActivity,
  EquippedItem,
  ItemGift,
  LoadoutSlot,
  Player,
  PowerUpKind,
  PowerUpUse,
  SabotageResolution,
  ShopCategory,
  Score,
  ShopItem,
  SkillEarnSource,
  SkillPathPick,
  SkillUnlock,
  Task,
  Wallet,
  Wish,
} from "../types";
import type {
  coinAdjustments as coinAdjustmentsTable,
  coinGifts as coinGiftsTable,
  coinPurchases as coinPurchasesTable,
  crateOpens as crateOpensTable,
  eggGifts as eggGiftsTable,
  equippedItems as equippedItemsTable,
  itemGifts as itemGiftsTable,
  powerUpUses as powerUpUsesTable,
  shopItems as shopItemsTable,
  skillPaths as skillPathsTable,
  skillUnlocks as skillUnlocksTable,
  tasks as tasksTable,
  wishes as wishesTable,
} from "../db/schema";
import { timestamptzToIso, wallClockToIso } from "../lib/time";
import { peoplesChoiceClosesAt } from "./peoples-choice";
import { heldCoins } from "./market-mappers";
import { bountyHeldCoins } from "./bounty-mappers";
import type { DerivedBonusRow } from "./polls";
import {
  BOUNTY_BADGE_SHARE,
  COIN_RUSH_MULTIPLIER,
  DOUBLE_DOWN_POINTS,
  ENTRY_COINS,
  HEIST_POINTS,
  UNDERDOG_POINTS,
  UNDERDOG_STREAK,
  appliedEffect,
  bountyBadgeBonus,
  GIFT_WEEKLY_CAP,
  GIFT_WINDOW_MS,
  GOLDEN_WEEK_MULTIPLIER,
  PEOPLES_CHOICE_VOTE_COINS,
  PLACEMENT_COINS,
  POLL_VOTE_COINS,
  PREDICTION_COINS,
  SABOTAGE_POINTS,
  WISH_MAX,
  CRATE_CATEGORIES,
  CRATE_TIER_KINDS,
  RARITIES,
  getCrate,
  inSaleWindow,
  isActivePowerUp,
  isCopyablePowerUp,
  rarityOf,
} from "./coin-rules";
import {
  getSkillNode,
  getSkillPath,
  isSkillPathId,
  unlockedNodes,
} from "./skill-trees";

export {
  ACTIVE_POWER_UP_KINDS,
  AVATAR_FRAMES,
  COPYABLE_POWER_UP_KINDS,
  COSMETIC_KINDS,
  LOADOUT_SLOTS,
  NAME_COLOURS,
  PASSIVE_POWER_UP_KINDS,
  POWER_UP_KINDS,
  PROFILE_THEMES,
  SHOP_CATEGORIES,
  TARGETED_POWER_UP_KINDS,
  WISH_MAX,
  WISH_POWER_UP,
} from "./coin-rules";

// Clim Coin: a per-season wallet. Earnings are derived from the competition
// records (like the poll and prediction bonuses), so a corrected score or a
// withdrawn vote can never leave stale coins behind. Only purchases, power-up
// uses, equipped items, gifts, admin adjustments and admin item gifts are
// stored; the passive power-ups (Shield, Mirror, Insurance, Bounty Badge,
// Underdog) and Coin Rush are worked out from them here. The payout and power-up numbers live in `coin-rules.ts`.

export const CATEGORY_INFO: Record<
  ShopCategory,
  { label: string; command: string }
> = {
  pet: { label: "Pets", command: "ls ./pets" },
  avatar: { label: "Avatars", command: "ls ./avatars" },
  cosmetic: { label: "Cosmetics", command: "ls ./flair" },
  power_up: { label: "Power-ups", command: "ls ./power-ups" },
};

export const COSMETIC_KIND_LABELS: Record<CosmeticKind, string> = {
  title: "Title",
  name_colour: "Name colour",
  theme: "Profile theme",
  shell_prompt: "Shell prompt",
  avatar_frame: "Avatar frame",
};

export const POWER_UP_INFO: Record<
  PowerUpKind,
  { label: string; description: string; passive: boolean }
> = {
  double_down: {
    label: "Double Down",
    description: `A correct winner call this week pays +${DOUBLE_DOWN_POINTS} instead of +1. Call the winner first.`,
    passive: false,
  },
  hint: {
    label: "Taskmaster's Hint",
    description:
      "Reveals the Taskmaster's private hint for this week's task, for your eyes only.",
    passive: false,
  },
  golden_week: {
    label: "Golden Week",
    description: `Your task score this week is multiplied by ${GOLDEN_WEEK_MULTIPLIER} (rounded up) before positions are decided. On team tasks it boosts only your own points.`,
    passive: false,
  },
  sabotage: {
    label: "Sabotage",
    description: `Takes ${-SABOTAGE_POINTS} points from a rival this week. Everyone sees who did it, and each player can only be sabotaged once a week.`,
    passive: false,
  },
  shield: {
    label: "Shield",
    description:
      "Passive: blocks the next Sabotage against you. Nobody knows you have it until that week's results are out.",
    passive: true,
  },
  mirror: {
    label: "Mirror",
    description: `Passive: bounces the next Sabotage against you back onto the saboteur (they lose the ${-SABOTAGE_POINTS} points). Secret until that week's results are out.`,
    passive: true,
  },
  insurance: {
    label: "Insurance",
    description: `Passive: the first week you finish last after buying it, you're paid 3rd-place coins (${PLACEMENT_COINS.third}) instead of ${PLACEMENT_COINS.scored}.`,
    passive: true,
  },
  heist: {
    label: "Heist",
    description: `Steals ${HEIST_POINTS} points from a rival this week: they lose them and you gain them. A Shield blocks it and a Mirror bounces it back on you (secret until results). Each player can only be sabotaged or robbed once a week.`,
    passive: false,
  },
  freeze: {
    label: "Freeze",
    description:
      "Freezes a rival who hasn't used a power-up this week yet: they can't use one for the rest of the week. Everyone sees it, and Shields and Mirrors don't stop it.",
    passive: false,
  },
  spyglass: {
    label: "Spyglass",
    description:
      "Privately shows whether a rival holds an unspent Shield or Mirror right now. Everyone sees who you looked at; only you see the answer.",
    passive: false,
  },
  coin_rush: {
    label: "Coin Rush",
    description: `Multiplies every coin this week pays you by ${COIN_RUSH_MULTIPLIER}: placement, entry, winner call and People's Choice vote.`,
    passive: false,
  },
  copycat: {
    label: "Copycat",
    description:
      "Copies a power-up someone else used last week: you get its effect this week (pick your own target if it needs one). It can't copy Copycat.",
    passive: false,
  },
  bounty_badge: {
    label: "Bounty Badge",
    description: `Passive: the next bounty you win after buying it pays ${BOUNTY_BADGE_SHARE * 100}% extra (rounded up), on the house.`,
    passive: true,
  },
  underdog: {
    label: "Underdog",
    description: `Passive: finish in the bottom half ${UNDERDOG_STREAK} published weeks in a row (from the next deadline after you buy it) and you get +${UNDERDOG_POINTS} points on the week after.`,
    passive: true,
  },
  wish: {
    label: "One Wish Willow",
    description: `Make one wish to the Taskmaster (up to ${WISH_MAX} characters, within reason) from your wallet, any time. They'll grant it or not, entirely at their discretion; either way it's spent.`,
    passive: false,
  },
};

/** The slot an item is worn in; power-ups aren't worn. */
export function slotOf(item: ShopItem): LoadoutSlot | undefined {
  if (item.category === "pet" || item.category === "avatar") {
    return item.category;
  }
  return item.cosmetic?.kind;
}

/** `${taskId}:${playerId}` keys of uses with `effect` (Copycats included). */
export function powerUpKeys(
  uses: readonly Pick<
    PowerUpUse,
    "taskId" | "playerId" | "effect" | "copiedEffect"
  >[],
  effect: ActivePowerUpKind,
): Set<string> {
  return new Set(
    uses
      .filter((u) => appliedEffect(u) === effect)
      .map((u) => `${u.taskId}:${u.playerId}`),
  );
}

/** Whether a use attacks its target's points (Sabotage or Heist). */
export const isAttack = (use: Pick<PowerUpUse, "effect" | "copiedEffect">) => {
  const effect = appliedEffect(use);
  return effect === "sabotage" || effect === "heist";
};

const instant = (iso: string) => new Date(iso).getTime();

/**
 * How every Sabotage and Heist resolved, by use id. Each Shield or Mirror a
 * target bought is spent on the first attack against them used after they
 * bought it; a Mirror is spent before a Shield. A bounced attack can't
 * itself be blocked or bounced. Resolution never depends on results being
 * out (only whether it's shown does), so it can't change once decided.
 */
export function resolveSabotages(
  uses: readonly PowerUpUse[],
  purchases: readonly CoinPurchase[],
  items: readonly ShopItem[],
): Map<number, SabotageResolution> {
  const effectOf = new Map(items.map((i) => [i.id, i.powerUp]));
  const defences = [...purchases]
    .filter((p) => {
      const effect = effectOf.get(p.itemId);
      return effect === "shield" || effect === "mirror";
    })
    .sort((a, b) => a.id - b.id);
  const spent = new Set<number>();
  const result = new Map<number, SabotageResolution>();
  for (const use of [...uses].sort((a, b) => a.id - b.id)) {
    if (!isAttack(use) || !use.targetPlayerId) continue;
    const armed = (effect: PowerUpKind) =>
      defences.find(
        (p) =>
          p.playerId === use.targetPlayerId &&
          effectOf.get(p.itemId) === effect &&
          !spent.has(p.id) &&
          instant(p.at) < instant(use.at),
      );
    const mirror = armed("mirror");
    const shield = mirror ? undefined : armed("shield");
    const defence = mirror ?? shield;
    if (defence) spent.add(defence.id);
    result.set(use.id, {
      outcome: mirror ? "reflected" : shield ? "blocked" : "hit",
      ...(defence && { defencePurchaseId: defence.id }),
    });
  }
  return result;
}

/**
 * Every Sabotage as a deduction and every Heist as a transfer, in the order
 * they were used. Until a week's results are out (`revealedTaskIds`) each
 * lands on the target as usual, so Shields and Mirrors stay secret; after,
 * a blocked one is dropped and a bounced one turns on its user instead.
 */
export function deriveSabotageBonusRows(
  uses: readonly PowerUpUse[],
  players: readonly Player[],
  resolutions: ReadonlyMap<number, SabotageResolution> = new Map(),
  revealedTaskIds: ReadonlySet<string> = new Set(),
): DerivedBonusRow[] {
  const names = new Map(players.map((p) => [p.id, p.name]));
  return uses.flatMap((use): DerivedBonusRow[] => {
    if (!isAttack(use) || !use.targetPlayerId) return [];
    const outcome = revealedTaskIds.has(use.taskId)
      ? (resolutions.get(use.id)?.outcome ?? "hit")
      : "hit";
    if (outcome === "blocked") return [];
    if (appliedEffect(use) === "heist") {
      const user = names.get(use.playerId) ?? "a rival";
      const target = names.get(use.targetPlayerId) ?? "a rival";
      const [loser, winner] =
        outcome === "reflected"
          ? [use.playerId, use.targetPlayerId]
          : [use.targetPlayerId, use.playerId];
      return outcome === "reflected"
        ? [
            {
              taskId: use.taskId,
              playerId: loser,
              points: -HEIST_POINTS,
              reason: `Heist bounced off ${target}'s Mirror`,
            },
            {
              taskId: use.taskId,
              playerId: winner,
              points: HEIST_POINTS,
              reason: `Mirror turned ${user}'s Heist around`,
            },
          ]
        : [
            {
              taskId: use.taskId,
              playerId: loser,
              points: -HEIST_POINTS,
              reason: `Robbed by ${user}'s Heist`,
            },
            {
              taskId: use.taskId,
              playerId: winner,
              points: HEIST_POINTS,
              reason: `Heist on ${target}`,
            },
          ];
    }
    if (outcome === "reflected") {
      return [
        {
          taskId: use.taskId,
          playerId: use.playerId,
          points: SABOTAGE_POINTS,
          reason: `Sabotage bounced off ${names.get(use.targetPlayerId) ?? "a rival"}'s Mirror`,
        },
      ];
    }
    return [
      {
        taskId: use.taskId,
        playerId: use.targetPlayerId,
        points: SABOTAGE_POINTS,
        reason: `Sabotaged by ${names.get(use.playerId) ?? "a rival"}`,
      },
    ];
  });
}

/** Purchase ids of `effect` charges, oldest first, with their player. */
function chargesOf(
  purchases: readonly CoinPurchase[],
  items: readonly ShopItem[],
  effect: PowerUpKind,
): CoinPurchase[] {
  const effectOf = new Map(items.map((i) => [i.id, i.powerUp]));
  return purchases
    .filter((p) => effectOf.get(p.itemId) === effect)
    .sort((a, b) => a.id - b.id);
}

/** A week's Underdog bonus, and the charge it spent. */
export interface UnderdogClaim {
  purchaseId: number;
  playerId: string;
  /** The week the bonus points land on. */
  taskId: string;
}

/**
 * Every Underdog charge that's paid out. A charge watches the weeks whose
 * deadline was after it was bought, in week order: each week with results
 * where the player finished in the bottom half (below the top
 * `ceil(n / 2)` places) extends their run, any other result resets it, and
 * a week still waiting for results stops the scan. After
 * `UNDERDOG_STREAK` in a row, the bonus lands on the next week.
 */
export function underdogClaims(
  tasks: readonly Pick<Task, "id" | "weekNumber" | "deadline">[],
  scores: readonly Pick<Score, "taskId" | "playerId" | "position">[],
  purchases: readonly CoinPurchase[],
  items: readonly ShopItem[],
): UnderdogClaim[] {
  const charges = chargesOf(purchases, items, "underdog");
  if (charges.length === 0) return [];
  const weeks = [...tasks].sort((a, b) => a.weekNumber - b.weekNumber);
  const scored = new Map<string, number>();
  for (const s of scores) scored.set(s.taskId, (scored.get(s.taskId) ?? 0) + 1);
  const claims: UnderdogClaim[] = [];
  for (const charge of charges) {
    let run = 0;
    for (const [index, week] of weeks.entries()) {
      if (instant(week.deadline) <= instant(charge.at)) continue;
      const entrants = scored.get(week.id) ?? 0;
      if (entrants === 0) break;
      const mine = scores.find(
        (s) => s.taskId === week.id && s.playerId === charge.playerId,
      );
      run = mine && mine.position > Math.ceil(entrants / 2) ? run + 1 : 0;
      if (run < UNDERDOG_STREAK) continue;
      const next = weeks[index + 1];
      if (next) {
        claims.push({
          purchaseId: charge.id,
          playerId: charge.playerId,
          taskId: next.id,
        });
      }
      break;
    }
  }
  return claims;
}

/** Underdog's bonus points, from `underdogClaims`. */
export function deriveUnderdogBonusRows(
  claims: readonly UnderdogClaim[],
): DerivedBonusRow[] {
  return claims.map((claim) => ({
    taskId: claim.taskId,
    playerId: claim.playerId,
    points: UNDERDOG_POINTS,
    reason: `Underdog: ${UNDERDOG_STREAK} weeks in the bottom half`,
  }));
}

/**
 * What a Spyglass saw: whether its target held an unspent Shield and an
 * unspent Mirror at the moment it was used (bought before it, and not yet
 * used up by an attack made before it).
 */
export function spyglassFindings(
  use: Pick<PowerUpUse, "targetPlayerId" | "at">,
  uses: readonly PowerUpUse[],
  purchases: readonly CoinPurchase[],
  items: readonly ShopItem[],
  resolutions: ReadonlyMap<number, SabotageResolution>,
): { shield: boolean; mirror: boolean } {
  const spentBefore = new Set(
    uses.flatMap((u) => {
      const defence = resolutions.get(u.id)?.defencePurchaseId;
      return defence !== undefined && instant(u.at) < instant(use.at)
        ? [defence]
        : [];
    }),
  );
  const holds = (effect: PowerUpKind) =>
    chargesOf(purchases, items, effect).some(
      (p) =>
        p.playerId === use.targetPlayerId &&
        instant(p.at) < instant(use.at) &&
        !spentBefore.has(p.id),
    );
  return { shield: holds("shield"), mirror: holds("mirror") };
}

/**
 * The bounty each Bounty Badge charge paid out on, as purchase id → bounty
 * id: the first bounty its owner won (awarded) after buying it.
 */
export function bountyBadgeClaims(
  data: Pick<WalletData, "coins">,
  playerId: string,
): Map<number, number> {
  const charges = chargesOf(
    data.coins.purchases.filter((p) => p.playerId === playerId),
    data.coins.items,
    "bounty_badge",
  );
  const claims = new Map<number, number>();
  if (charges.length === 0) return claims;
  const won = data.coins.bounties.bounties
    .filter(
      (b) => b.status === "awarded" && b.winnerId === playerId && b.closedAt,
    )
    .sort((a, b) => instant(a.closedAt ?? a.at) - instant(b.closedAt ?? b.at));
  const used = new Set<number>();
  for (const charge of charges) {
    const bounty = won.find(
      (b) =>
        !used.has(b.id) && instant(b.closedAt ?? b.at) > instant(charge.at),
    );
    if (!bounty) continue;
    used.add(bounty.id);
    claims.set(charge.id, bounty.id);
  }
  return claims;
}

// ── Mappers ───────────────────────────────────────────────────────────

type ShopItemRow = typeof shopItemsTable.$inferSelect;
type PurchaseRow = typeof coinPurchasesTable.$inferSelect;
type UseRow = typeof powerUpUsesTable.$inferSelect;
type EquippedRow = typeof equippedItemsTable.$inferSelect;
type AdjustmentRow = typeof coinAdjustmentsTable.$inferSelect;
type CrateOpenRow = typeof crateOpensTable.$inferSelect;
type GiftRow = typeof coinGiftsTable.$inferSelect;
type ItemGiftRow = typeof itemGiftsTable.$inferSelect;
type EggGiftRow = typeof eggGiftsTable.$inferSelect;
type WishRow = typeof wishesTable.$inferSelect;
type TaskRow = typeof tasksTable.$inferSelect;
type SkillPathRow = typeof skillPathsTable.$inferSelect;
type SkillUnlockRow = typeof skillUnlocksTable.$inferSelect;

export function mapShopItems(rows: ShopItemRow[]): ShopItem[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      price: row.price,
      ...(row.imageUrl !== null && { imageUrl: row.imageUrl }),
      ...(row.cosmeticKind !== null &&
        row.cosmeticValue !== null && {
          cosmetic: { kind: row.cosmeticKind, value: row.cosmeticValue },
        }),
      ...(row.powerUp !== null && { powerUp: row.powerUp }),
      available: row.available,
      crateOnly: row.crateOnly,
      ...(row.crateId !== null && { crateId: row.crateId }),
      skillOnly: row.skillOnly,
      ...(row.availableFrom !== null && {
        availableFrom: wallClockToIso(row.availableFrom),
      }),
      ...(row.availableUntil !== null && {
        availableUntil: wallClockToIso(row.availableUntil),
      }),
      ...(row.stock !== null && { stock: row.stock }),
      sortOrder: row.sortOrder,
    }));
}

export function mapPurchases(rows: PurchaseRow[]): CoinPurchase[] {
  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    itemId: row.itemId,
    price: row.price,
    ...(row.bundlePurchaseId !== null && {
      bundlePurchaseId: row.bundlePurchaseId,
    }),
    at: timestamptzToIso(row.createdAt),
  }));
}

export function mapPowerUpUses(rows: UseRow[]): PowerUpUse[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .flatMap((row): PowerUpUse[] => {
      // Passive power-ups are never used (the database refuses them too),
      // and a Copycat always names what it copied.
      const effect = row.effect;
      if (!isActivePowerUp(effect)) return [];
      const copied =
        row.copiedEffect !== null && isCopyablePowerUp(row.copiedEffect)
          ? row.copiedEffect
          : undefined;
      if ((effect === "copycat") !== (copied !== undefined)) return [];
      return [
        {
          id: row.id,
          purchaseId: row.purchaseId,
          playerId: row.playerId,
          taskId: row.taskId,
          effect,
          ...(copied && { copiedEffect: copied }),
          ...(row.targetPlayerId !== null && {
            targetPlayerId: row.targetPlayerId,
          }),
          at: timestamptzToIso(row.createdAt),
        },
      ];
    });
}

export function mapEquipped(rows: EquippedRow[]): EquippedItem[] {
  return rows.map(({ playerId, slot, itemId }) => ({ playerId, slot, itemId }));
}

export function mapAdjustments(rows: AdjustmentRow[]): CoinAdjustment[] {
  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    amount: row.amount,
    reason: row.reason,
    actorName: row.actorName,
    at: timestamptzToIso(row.createdAt),
  }));
}

export function mapCrateOpens(rows: CrateOpenRow[]): CrateOpen[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      crateId: row.crateId,
      price: row.price,
      itemId: row.itemId,
      rarity:
        CRATE_TIER_KINDS.find((r) => r === row.rarity) ?? rarityOf(row.price),
      at: timestamptzToIso(row.createdAt),
    }));
}

/** Each week's Taskmaster's Hint, by task id (weeks without one omitted). */
export function mapHints(rows: Pick<TaskRow, "id" | "hint">[]) {
  return Object.fromEntries(
    rows.flatMap((row) => (row.hint ? [[row.id, row.hint] as const] : [])),
  );
}

export function mapGifts(rows: GiftRow[]): CoinGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      fromPlayerId: row.fromPlayerId,
      toPlayerId: row.toPlayerId,
      amount: row.amount,
      ...(row.message !== null && { message: row.message }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapItemGifts(rows: ItemGiftRow[]): ItemGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      itemId: row.itemId,
      reason: row.reason,
      actorName: row.actorName,
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapEggGifts(rows: EggGiftRow[]): EggGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      playerId: row.playerId,
      crateId: row.crateId,
      reason: row.reason,
      actorName: row.actorName,
      ...(row.crateOpenId !== null && { crateOpenId: row.crateOpenId }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapWishes(rows: WishRow[]): Wish[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      wish: row.wish,
      status: row.status,
      ...(row.response !== null && { response: row.response }),
      ...(row.decidedAt !== null && {
        decidedAt: timestamptzToIso(row.decidedAt),
      }),
      ...(row.deciderName !== null && { deciderName: row.deciderName }),
      at: timestamptzToIso(row.createdAt),
    }));
}

/** Pathway picks for pathways that still exist in the catalogue. */
export function mapSkillPaths(rows: SkillPathRow[]): SkillPathPick[] {
  return rows.flatMap((row): SkillPathPick[] =>
    isSkillPathId(row.pathId)
      ? [
          {
            playerId: row.playerId,
            pathId: row.pathId,
            at: timestamptzToIso(row.createdAt),
          },
        ]
      : [],
  );
}

/** Unlocks of nodes that still exist in the catalogue, oldest first. */
export function mapSkillUnlocks(rows: SkillUnlockRow[]): SkillUnlock[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .flatMap((row): SkillUnlock[] =>
      isSkillPathId(row.pathId) && getSkillNode(row.nodeId)
        ? [
            {
              id: row.id,
              playerId: row.playerId,
              pathId: row.pathId,
              nodeId: row.nodeId,
              price: row.price,
              ...(row.purchaseId !== null && { purchaseId: row.purchaseId }),
              at: timestamptzToIso(row.createdAt),
            },
          ]
        : [],
    );
}

export function mapEntries(rows: EntryActivity[]): EntryActivity[] {
  return rows.map(({ taskId, playerId }) => ({ taskId, playerId }));
}

// ── Wallet ────────────────────────────────────────────────────────────

const weekLabel = (weekNumber: number) =>
  `Week ${String(weekNumber).padStart(2, "0")}`;

const PLACE_LABELS = ["1st", "2nd", "3rd"];

/** Coins a finishing position pays. */
export function placementCoins(position: number): number {
  return (
    [PLACEMENT_COINS.first, PLACEMENT_COINS.second, PLACEMENT_COINS.third][
      position - 1
    ] ?? PLACEMENT_COINS.scored
  );
}

type WalletData = Pick<
  CompetitionData,
  | "tasks"
  | "scores"
  | "polls"
  | "peoplesChoiceVotes"
  | "predictions"
  | "resultsPostedAt"
  | "coins"
  | "players"
>;

/**
 * The week each of a player's Insurance charges paid out on, as task id →
 * purchase id. A charge covers the first week (in week order) whose deadline
 * was after it was bought where the player finished last and their place
 * paid less than 3rd. Results only count once they're out.
 */
export function insuranceClaims(
  data: Pick<WalletData, "tasks" | "scores" | "coins">,
  playerId: string,
): Map<string, number> {
  const effectOf = new Map(data.coins.items.map((i) => [i.id, i.powerUp]));
  const charges = data.coins.purchases
    .filter(
      (p) => p.playerId === playerId && effectOf.get(p.itemId) === "insurance",
    )
    .sort((a, b) => a.id - b.id);
  const claims = new Map<string, number>();
  if (charges.length === 0) return claims;

  const lastPlace = new Map<string, number>();
  for (const s of data.scores) {
    lastPlace.set(s.taskId, Math.max(lastPlace.get(s.taskId) ?? 0, s.position));
  }
  const weeks = [...data.tasks].sort((a, b) => a.weekNumber - b.weekNumber);
  for (const charge of charges) {
    const week = weeks.find((task) => {
      if (claims.has(task.id)) return false;
      if (instant(task.deadline) <= instant(charge.at)) return false;
      const score = data.scores.find(
        (s) => s.taskId === task.id && s.playerId === playerId,
      );
      return (
        score !== undefined &&
        score.position === lastPlace.get(task.id) &&
        placementCoins(score.position) < PLACEMENT_COINS.third
      );
    });
    if (week) claims.set(week.id, charge.id);
  }
  return claims;
}

/**
 * The coins a player has earned, newest first. Results pay once they're
 * published; activity pays once it locks in (entries and calls at the
 * deadline, votes when voting closes), so withdrawing can't be farmed.
 */
export function deriveEarnings(
  data: WalletData,
  playerId: string,
  now: number = Date.now(),
): CoinLedgerEntry[] {
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const insured = insuranceClaims(data, playerId);
  const entries: CoinLedgerEntry[] = [];

  for (const score of data.scores) {
    if (score.playerId !== playerId) continue;
    const task = taskById.get(score.taskId);
    if (!task) continue;
    const place = PLACE_LABELS[score.position - 1];
    entries.push({
      kind: "placement",
      ...(insured.has(task.id)
        ? {
            amount: PLACEMENT_COINS.third,
            label: `${weekLabel(task.weekNumber)}: last place, Insurance paid 3rd-place coins`,
          }
        : {
            amount: placementCoins(score.position),
            label: `${weekLabel(task.weekNumber)}: ${place ? `${place} place` : "scored"}`,
          }),
      at: data.resultsPostedAt[task.id] ?? task.deadline,
      taskId: task.id,
    });
  }

  const enteredTaskIds = new Set(
    data.coins.entries
      .filter((e) => e.playerId === playerId)
      .map((e) => e.taskId),
  );
  for (const taskId of enteredTaskIds) {
    const task = taskById.get(taskId);
    if (task?.status !== "completed") continue;
    entries.push({
      kind: "entry",
      amount: ENTRY_COINS,
      label: `${weekLabel(task.weekNumber)}: entry submitted`,
      at: task.deadline,
      taskId,
    });
  }

  for (const poll of data.polls) {
    if (!poll.published || poll.status !== "closed") continue;
    if (!poll.votes.some((v) => v.playerId === playerId)) continue;
    entries.push({
      kind: "poll-vote",
      amount: POLL_VOTE_COINS,
      label: `Voted: "${poll.question}"`,
      at: poll.closesAt,
    });
  }

  for (const vote of data.peoplesChoiceVotes) {
    // A vote for an entry an admin hid doesn't count, so it doesn't pay.
    if (vote.playerId !== playerId || vote.entryHidden) continue;
    const task = taskById.get(vote.taskId);
    if (!task) continue;
    const closesAt = peoplesChoiceClosesAt(task);
    if (new Date(closesAt).getTime() > now) continue;
    entries.push({
      kind: "peoples-choice-vote",
      amount: PEOPLES_CHOICE_VOTE_COINS,
      label: `${weekLabel(task.weekNumber)}: People's Choice vote`,
      at: closesAt,
      taskId: task.id,
    });
  }

  for (const call of data.predictions) {
    if (call.playerId !== playerId) continue;
    const task = taskById.get(call.taskId);
    if (task?.status !== "completed") continue;
    entries.push({
      kind: "prediction",
      amount: PREDICTION_COINS,
      label: `${weekLabel(task.weekNumber)}: called a winner`,
      at: task.deadline,
      taskId: task.id,
    });
  }

  const miniTasks = new Map(data.coins.miniTasks.map((t) => [t.id, t]));
  for (const done of data.coins.miniTaskCompletions) {
    if (done.playerId !== playerId) continue;
    const miniTask = miniTasks.get(done.miniTaskId);
    if (!miniTask) continue;
    entries.push({
      kind: "mini-task",
      amount: miniTask.reward,
      label: `Mini-task: ${miniTask.title}`,
      at: done.at,
    });
  }

  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const badges = bountyBadgeClaims(data, playerId);
  const bountyById = new Map(
    data.coins.bounties.bounties.map((b) => [b.id, b]),
  );
  for (const bountyId of badges.values()) {
    const bounty = bountyById.get(bountyId);
    if (!bounty) continue;
    entries.push({
      kind: "bounty-badge",
      amount: bountyBadgeBonus(bounty.reward),
      label: `Bounty Badge: extra on ${names.get(bounty.posterId) ?? "someone"}'s bounty "${bounty.title}"`,
      at: bounty.closedAt ?? bounty.at,
    });
  }

  for (const draw of data.coins.raffle.draws) {
    if (draw.winnerId !== playerId) continue;
    const task = taskById.get(draw.taskId);
    entries.push({
      kind: "raffle-win",
      amount: draw.pot,
      label: `${task ? weekLabel(task.weekNumber) : "Raffle"}: won the raffle (${draw.tickets} ticket${draw.tickets === 1 ? "" : "s"} in the draw)`,
      at: draw.at,
      taskId: draw.taskId,
    });
  }

  return [
    ...entries,
    ...coinRushEarnings(data, playerId, entries),
    ...skillPerkEarnings(data, playerId, entries),
  ];
}

/** Earnings Coin Rush multiplies: what a week pays for taking part. */
const COIN_RUSH_SOURCES: ReadonlySet<CoinLedgerKind> = new Set([
  "placement",
  "entry",
  "prediction",
  "peoples-choice-vote",
]);

/**
 * Coin Rush's extra coins: for each week a player used it on, the coins
 * that week has paid them so far (placement, entry, winner call and
 * People's Choice vote) times the multiplier, less what was already paid.
 */
function coinRushEarnings(
  data: WalletData,
  playerId: string,
  earnings: readonly CoinLedgerEntry[],
): CoinLedgerEntry[] {
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  return data.coins.uses.flatMap((use): CoinLedgerEntry[] => {
    if (use.playerId !== playerId || appliedEffect(use) !== "coin_rush") {
      return [];
    }
    const paid = earnings.filter(
      (e) => e.taskId === use.taskId && COIN_RUSH_SOURCES.has(e.kind),
    );
    const base = paid.reduce((sum, e) => sum + e.amount, 0);
    const task = taskById.get(use.taskId);
    if (base <= 0 || !task) return [];
    const at = paid.reduce(
      (latest, e) => (instant(e.at) > instant(latest) ? e.at : latest),
      paid[0].at,
    );
    return [
      {
        kind: "coin-rush",
        amount: base * (COIN_RUSH_MULTIPLIER - 1),
        label: `${weekLabel(task.weekNumber)}: Coin Rush ×${COIN_RUSH_MULTIPLIER}`,
        at,
        taskId: task.id,
      },
    ];
  });
}

const SKILL_EARN_SOURCE: Partial<Record<CoinLedgerKind, SkillEarnSource>> = {
  placement: "placement",
  entry: "entry",
  prediction: "prediction",
  "poll-vote": "poll-vote",
  "peoples-choice-vote": "peoples-choice-vote",
};

/**
 * The extra coins a player's skill tree earning perks pay on `earnings`
 * (and, for Lightning Rod, on power-ups they used on finished weeks). A
 * perk only pays on coins that landed after its node was unlocked.
 */
function skillPerkEarnings(
  data: WalletData,
  playerId: string,
  earnings: readonly CoinLedgerEntry[],
): CoinLedgerEntry[] {
  const unlocks = data.coins.skillUnlocks;
  if (!unlocks.some((u) => u.playerId === playerId)) return [];
  const perkLines = (
    source: SkillEarnSource,
    earning: Pick<CoinLedgerEntry, "label" | "at" | "taskId">,
  ): CoinLedgerEntry[] =>
    unlockedNodes(unlocks, playerId, instant(earning.at)).flatMap((node) =>
      node.perks.flatMap((perk): CoinLedgerEntry[] =>
        perk.kind === "earn_bonus" && perk.source === source
          ? [
              {
                kind: "skill-perk",
                amount: perk.amount,
                label: `${node.name}: ${earning.label}`,
                at: earning.at,
                ...(earning.taskId && { taskId: earning.taskId }),
              },
            ]
          : [],
      ),
    );

  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const powerUpUses = data.coins.uses.flatMap((use) => {
    const task = taskById.get(use.taskId);
    if (use.playerId !== playerId || task?.status !== "completed") return [];
    return [
      {
        label: `${weekLabel(task.weekNumber)}: used ${POWER_UP_INFO[use.effect].label}`,
        at: task.deadline,
        taskId: task.id,
      },
    ];
  });
  return [
    ...earnings.flatMap((earning) => {
      const source = SKILL_EARN_SOURCE[earning.kind];
      return source ? perkLines(source, earning) : [];
    }),
    ...powerUpUses.flatMap((use) => perkLines("power-up-use", use)),
  ];
}

/** A player's balance and full history (earnings, grants and spending). */
export function deriveWallet(
  data: WalletData,
  playerId: string,
  now: number = Date.now(),
): Wallet {
  const itemNames = new Map(data.coins.items.map((i) => [i.id, i.name]));
  const earnings = deriveEarnings(data, playerId, now);
  const adjustments: CoinLedgerEntry[] = data.coins.adjustments
    .filter((a) => a.playerId === playerId)
    .map((a) => ({
      kind: "adjustment",
      amount: a.amount,
      label: a.reason,
      at: a.at,
    }));
  // Crate wins, admin item gifts, gift-wrapped items and bundle copies are
  // owned through a zero-price purchase; their own lines say where the item
  // came from.
  const freeItems = new Set([
    ...data.coins.crateOpens.map((o) => o.purchaseId),
    ...data.coins.itemGifts.map((g) => g.purchaseId),
    ...data.coins.skillUnlocks.flatMap((u) => u.purchaseId ?? []),
    ...data.coins.market.sales.map((sale) => sale.buyerPurchaseId),
    ...data.coins.wrappedGifts.map((g) => g.purchaseId),
    ...data.coins.purchases.flatMap((p) =>
      p.bundlePurchaseId === undefined ? [] : [p.id],
    ),
  ]);
  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const purchases: CoinLedgerEntry[] = [
    ...data.coins.purchases
      .filter((p) => p.playerId === playerId && !freeItems.has(p.id))
      .map(
        (p): CoinLedgerEntry => ({
          kind: "purchase",
          amount: -p.price,
          label: `Bought ${itemNames.get(p.itemId) ?? p.itemId}`,
          at: p.at,
        }),
      ),
    ...data.coins.crateOpens
      .filter((o) => o.playerId === playerId)
      .map(
        (o): CoinLedgerEntry => ({
          kind: "crate",
          amount: -o.price,
          label: `${getCrate(o.crateId)?.name ?? "Crate"} → ${
            itemNames.get(o.itemId) ?? o.itemId
          } (${o.rarity === "power_up" ? "power-up" : o.rarity})`,
          at: o.at,
        }),
      ),
    ...data.coins.skillUnlocks
      .filter((u) => u.playerId === playerId)
      .map((u): CoinLedgerEntry => {
        const node = getSkillNode(u.nodeId);
        const path = getSkillPath(u.pathId);
        const reward = node?.rewardItemId
          ? ` → ${itemNames.get(node.rewardItemId) ?? node.rewardItemId}`
          : "";
        return {
          kind: "skill",
          amount: -u.price,
          label: `Unlocked ${node?.name ?? u.nodeId} (${path?.name ?? u.pathId})${reward}`,
          at: u.at,
        };
      }),
    ...raffleSpending(data, playerId, taskById),
    ...data.coins.renameTokens
      .filter((t) => t.playerId === playerId)
      .map(
        (t): CoinLedgerEntry => ({
          kind: "rename",
          amount: -t.price,
          label: "Bought a rename token",
          at: t.at,
        }),
      ),
    ...data.coins.wrappedGifts
      .filter((g) => g.fromPlayerId === playerId)
      .map(
        (g): CoinLedgerEntry => ({
          kind: "gift-wrap-out",
          amount: -(g.price + g.fee),
          label: `Gift-wrapped ${itemNames.get(g.itemId) ?? g.itemId} for ${names.get(g.toPlayerId) ?? "someone"}${g.anonymous ? " (anonymously)" : ""}`,
          at: g.at,
        }),
      ),
    ...data.coins.bundlePurchases
      .filter((b) => b.playerId === playerId)
      .map((b): CoinLedgerEntry => {
        const bundle = data.coins.bundles.find((x) => x.id === b.bundleId);
        return {
          kind: "bundle",
          amount: -b.price,
          label: `Bought the ${bundle?.name ?? b.bundleId} bundle`,
          at: b.at,
        };
      }),
  ];
  const quoted = (message?: string) => (message ? `: "${message}"` : "");
  const gifts: CoinLedgerEntry[] = data.coins.gifts.flatMap(
    (g): CoinLedgerEntry[] => {
      if (g.toPlayerId === playerId) {
        return [
          {
            kind: "gift-in",
            amount: g.amount,
            label: `Gift from ${names.get(g.fromPlayerId) ?? "someone"}${quoted(g.message)}`,
            at: g.at,
          },
        ];
      }
      if (g.fromPlayerId === playerId) {
        return [
          {
            kind: "gift-out",
            amount: -g.amount,
            label: `Gift to ${names.get(g.toPlayerId) ?? "someone"}${quoted(g.message)}`,
            at: g.at,
          },
        ];
      }
      return [];
    },
  );
  const trades: CoinLedgerEntry[] = data.coins.market.sales.flatMap(
    (sale): CoinLedgerEntry[] => {
      const item = itemNames.get(sale.itemId) ?? sale.itemId;
      if (sale.sellerId === playerId) {
        return [
          {
            kind: "market-sale",
            amount: sale.price,
            label: `Sold ${item} to ${names.get(sale.buyerId) ?? "someone"} on the market`,
            at: sale.at,
          },
        ];
      }
      if (sale.buyerId === playerId) {
        return [
          {
            kind: "market-buy",
            amount: -sale.price,
            label: `Bought ${item} from ${names.get(sale.sellerId) ?? "someone"} on the market`,
            at: sale.at,
          },
        ];
      }
      return [];
    },
  );
  const bounties: CoinLedgerEntry[] = data.coins.bounties.bounties.flatMap(
    (bounty): CoinLedgerEntry[] => {
      if (bounty.status !== "awarded" || !bounty.winnerId) return [];
      const at = bounty.closedAt ?? bounty.at;
      if (bounty.posterId === playerId) {
        return [
          {
            kind: "bounty-paid",
            amount: -bounty.reward,
            label: `Bounty "${bounty.title}" won by ${names.get(bounty.winnerId) ?? "someone"}`,
            at,
          },
        ];
      }
      if (bounty.winnerId === playerId) {
        return [
          {
            kind: "bounty-won",
            amount: bounty.reward,
            label: `Won ${names.get(bounty.posterId) ?? "someone"}'s bounty "${bounty.title}"`,
            at,
          },
        ];
      }
      return [];
    },
  );
  const itemGifts: CoinLedgerEntry[] = data.coins.itemGifts
    .filter((g) => g.playerId === playerId)
    .map((g) => ({
      kind: "item-gift",
      amount: 0,
      label: `Gifted ${itemNames.get(g.itemId) ?? g.itemId}: ${g.reason}`,
      at: g.at,
    }));
  const eggGifts: CoinLedgerEntry[] = data.coins.eggGifts
    .filter((g) => g.playerId === playerId)
    .map((g) => ({
      kind: "item-gift",
      amount: 0,
      label: `Gifted ${getCrate(g.crateId)?.name ?? "an egg"}: ${g.reason}`,
      at: g.at,
    }));
  const wrappedIn: CoinLedgerEntry[] = data.coins.wrappedGifts
    .filter((g) => g.toPlayerId === playerId)
    .map((g) => ({
      kind: "gift-wrap-in",
      amount: 0,
      label: `Gift-wrapped ${itemNames.get(g.itemId) ?? g.itemId} from ${
        g.anonymous
          ? "a secret admirer"
          : (names.get(g.fromPlayerId) ?? "someone")
      }${quoted(g.message)}`,
      at: g.at,
    }));
  const sum = (list: CoinLedgerEntry[]) =>
    list.reduce((total, e) => total + e.amount, 0);
  const earned = sum(earnings);
  const adjusted = sum(adjustments);
  const spent = -sum(purchases);
  const gifted = sum(gifts);
  const traded = sum(trades);
  const bountied = sum(bounties);
  // Pending marketplace offers and open bounties hold coins until they're
  // decided or lapse.
  const held =
    heldCoins(data.coins.market, playerId, now) +
    bountyHeldCoins(data.coins.bounties, playerId, now);
  return {
    playerId,
    balance: earned + adjusted - spent + gifted + traded + bountied - held,
    earned,
    adjusted,
    spent,
    gifted,
    traded,
    bountied,
    held,
    ledger: [
      ...earnings,
      ...adjustments,
      ...purchases,
      ...gifts,
      ...trades,
      ...bounties,
      ...itemGifts,
      ...eggGifts,
      ...wrappedIn,
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
  };
}

/** A player's raffle tickets, one line per week (tickets bought together). */
function raffleSpending(
  data: WalletData,
  playerId: string,
  taskById: ReadonlyMap<string, Task>,
): CoinLedgerEntry[] {
  const byWeek = new Map<
    string,
    { count: number; price: number; at: string }
  >();
  for (const ticket of data.coins.raffle.tickets) {
    if (ticket.playerId !== playerId) continue;
    const week = byWeek.get(ticket.taskId);
    byWeek.set(ticket.taskId, {
      count: (week?.count ?? 0) + 1,
      price: (week?.price ?? 0) + ticket.price,
      at: week && instant(week.at) > instant(ticket.at) ? week.at : ticket.at,
    });
  }
  return [...byWeek].map(([taskId, week]) => {
    const task = taskById.get(taskId);
    return {
      kind: "raffle",
      amount: -week.price,
      label: `${task ? weekLabel(task.weekNumber) : "Raffle"}: ${week.count} raffle ticket${week.count === 1 ? "" : "s"}`,
      at: week.at,
      taskId,
    };
  });
}

/**
 * How many coins a player can still gift now: the weekly cap less what
 * they've sent in the last 7 days.
 */
export function giftAllowance(
  gifts: readonly CoinGift[],
  playerId: string,
  now: number = Date.now(),
  cap: number = GIFT_WEEKLY_CAP,
): number {
  const sent = gifts
    .filter(
      (g) =>
        g.fromPlayerId === playerId && now - instant(g.at) < GIFT_WINDOW_MS,
    )
    .reduce((total, g) => total + g.amount, 0);
  return Math.max(0, cap - sent);
}

// ── Crates ────────────────────────────────────────────────────────────

/** Whether an item is for sale (or droppable) at `now`. */
export function isOnSale(item: ShopItem, now: number): boolean {
  return item.available && inSaleWindow(item, now);
}

/**
 * A crate's odds for one player: every pet, avatar and cosmetic on sale
 * now that they don't own yet, grouped by rarity. A seasonal egg drops only
 * its own exclusives, and no other egg drops them. A tier with nothing left
 * in it has its chance shared out among the others in proportion, and items
 * in a tier are equally likely. Returns no tiers when there's nothing left.
 *
 * On top, the crate's small `powerUpChance` drops a power-up whose effect
 * the player hasn't had this season (`ownedEffects`). That chance is never
 * scaled up: with no power-ups left it goes to the other tiers, and a crate
 * with only power-ups left counts as empty, so it can't become a cheap
 * power-up vending machine.
 */
export function crateOdds(
  crate: Crate,
  items: readonly ShopItem[],
  ownedItemIds: ReadonlySet<string>,
  now: number = Date.now(),
  ownedEffects: ReadonlySet<PowerUpKind> = new Set(),
): CrateTier[] {
  const pool = items.filter(
    (item) =>
      isOnSale(item, now) &&
      !item.skillOnly &&
      CRATE_CATEGORIES.some((c) => c === item.category) &&
      (crate.exclusive ? item.crateId === crate.id : !item.crateId) &&
      !ownedItemIds.has(item.id),
  );
  const byTier = RARITIES.map((rarity) => ({
    rarity,
    weight: crate.odds[rarity] ?? 0,
    items: pool.filter((item) => rarityOf(item.price) === rarity),
  })).filter((tier) => tier.weight > 0 && tier.items.length > 0);
  if (byTier.length === 0) return [];
  const powerUps = items.filter(
    (item) =>
      item.powerUp !== undefined &&
      !item.skillOnly &&
      isOnSale(item, now) &&
      !ownedEffects.has(item.powerUp),
  );
  const powerUpChance =
    powerUps.length > 0
      ? Math.min(Math.max(crate.powerUpChance ?? 0, 0), 1)
      : 0;
  const total = byTier.reduce((sum, tier) => sum + tier.weight, 0);
  const tier = (
    rarity: CrateTierKind,
    chance: number,
    drops: readonly ShopItem[],
  ): CrateTier => ({
    rarity,
    chance,
    drops: drops.map((item) => ({ item, chance: chance / drops.length })),
  });
  return [
    ...byTier.map(({ rarity, weight, items: drops }) =>
      tier(rarity, (weight / total) * (1 - powerUpChance), drops),
    ),
    ...(powerUpChance > 0 ? [tier("power_up", powerUpChance, powerUps)] : []),
  ];
}

/** The average shop value of one roll, in coins. */
export function crateAverageValue(tiers: readonly CrateTier[]): number {
  return tiers.reduce(
    (sum, tier) =>
      sum + tier.drops.reduce((s, d) => s + d.chance * d.item.price, 0),
    0,
  );
}

/**
 * Picks an item with the odds in `tiers`. `random` is a number in [0, 1);
 * the server passes a cryptographically random one.
 */
export function rollCrate(
  tiers: readonly CrateTier[],
  random: number,
): { item: ShopItem; rarity: CrateTierKind } | undefined {
  let remaining = random;
  let last: { item: ShopItem; rarity: CrateTierKind } | undefined;
  for (const tier of tiers) {
    for (const drop of tier.drops) {
      last = { item: drop.item, rarity: tier.rarity };
      if (remaining < drop.chance) return last;
      remaining -= drop.chance;
    }
  }
  // Floating-point slack at the very top of the range lands on the last item.
  return last;
}
