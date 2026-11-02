import type {
  BundlePurchase,
  RaffleData,
  RaffleDraw,
  RenameToken,
  ShopBundle,
  ShopDealOverride,
  ShopItem,
  Task,
  WrappedGift,
} from "../types";
import type {
  bundlePurchases as bundlePurchasesTable,
  raffleTickets as raffleTicketsTable,
  renameTokens as renameTokensTable,
  shopBundleItems as shopBundleItemsTable,
  shopBundles as shopBundlesTable,
  shopDeals as shopDealsTable,
  wrappedGifts as wrappedGiftsTable,
} from "../db/schema";
import { timestamptzToIso, ukWeekStart, wallClockToIso } from "../lib/time";
import {
  DEAL_DISCOUNT_PERCENT,
  DEAL_MIN_PRICE,
  inSaleWindow,
} from "./coin-rules";

// The shop's extras: the weekly raffle, rename tokens, gift wrap, bundles
// and the deal of the week. Mappers turn their rows into records; the raffle
// draw and the deal rotation are derived here, so nothing has to run when a
// week closes or a new deal week starts.

type RaffleTicketRow = typeof raffleTicketsTable.$inferSelect;
type RenameTokenRow = typeof renameTokensTable.$inferSelect;
type WrappedGiftRow = typeof wrappedGiftsTable.$inferSelect;
type BundleRow = typeof shopBundlesTable.$inferSelect;
type BundleItemRow = typeof shopBundleItemsTable.$inferSelect;
type BundlePurchaseRow = typeof bundlePurchasesTable.$inferSelect;
type DealRow = typeof shopDealsTable.$inferSelect;

/** cyrb53: a small, well-mixed 53-bit string hash. */
export function hash53(value: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Each closed week's raffle: one ticket wins the pot (every ticket's
 * price). The winning ticket comes from a hash of every ticket's secret
 * nonce, which never leaves the server, so it can't be known (or steered)
 * before the deadline, and never changes after it (tickets can't be bought
 * once the week closes).
 */
export function drawRaffles(
  rows: readonly Pick<
    RaffleTicketRow,
    "id" | "taskId" | "playerId" | "price" | "nonce"
  >[],
  tasks: readonly Pick<Task, "id" | "deadline">[],
  now: number = Date.now(),
): RaffleDraw[] {
  return tasks.flatMap((task): RaffleDraw[] => {
    if (new Date(task.deadline).getTime() > now) return [];
    const tickets = rows
      .filter((row) => row.taskId === task.id)
      .sort((a, b) => a.id - b.id);
    if (tickets.length === 0) return [];
    const seed = `${task.id}:${tickets.map((t) => t.nonce).join(":")}`;
    const winner = tickets[hash53(seed) % tickets.length];
    return [
      {
        taskId: task.id,
        winnerId: winner.playerId,
        pot: tickets.reduce((sum, t) => sum + t.price, 0),
        tickets: tickets.length,
        at: task.deadline,
      },
    ];
  });
}

/** The season's tickets (nonces dropped) and its closed weeks' draws. */
export function mapRaffle(
  rows: RaffleTicketRow[],
  tasks: readonly Pick<Task, "id" | "deadline">[],
  now: number = Date.now(),
): RaffleData {
  return {
    tickets: [...rows]
      .sort((a, b) => a.id - b.id)
      .map((row) => ({
        id: row.id,
        taskId: row.taskId,
        playerId: row.playerId,
        price: row.price,
        at: timestamptzToIso(row.createdAt),
      })),
    draws: drawRaffles(rows, tasks, now),
  };
}

export function mapRenameTokens(rows: RenameTokenRow[]): RenameToken[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      playerId: row.playerId,
      price: row.price,
      ...(row.itemId !== null && { itemId: row.itemId }),
      ...(row.name !== null && { name: row.name }),
      ...(row.usedAt !== null && { usedAt: timestamptzToIso(row.usedAt) }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapWrappedGifts(rows: WrappedGiftRow[]): WrappedGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      fromPlayerId: row.fromPlayerId,
      toPlayerId: row.toPlayerId,
      itemId: row.itemId,
      price: row.price,
      fee: row.fee,
      anonymous: row.anonymous,
      ...(row.message !== null && { message: row.message }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapBundles(
  rows: BundleRow[],
  itemRows: BundleItemRow[],
): ShopBundle[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      available: row.available,
      itemIds: itemRows
        .filter((item) => item.bundleId === row.id)
        .map((item) => item.itemId)
        .sort(),
      sortOrder: row.sortOrder,
    }));
}

export function mapBundlePurchases(
  rows: BundlePurchaseRow[],
): BundlePurchase[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      playerId: row.playerId,
      bundleId: row.bundleId,
      price: row.price,
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapDealOverrides(rows: DealRow[]): ShopDealOverride[] {
  return rows.map((row) => ({
    weekStart: row.weekStart,
    itemId: row.itemId,
    discountPercent: row.discountPercent,
    actorName: row.actorName,
  }));
}

// ── Deal of the week ──────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The Monday (UK date, YYYY-MM-DD) of the deal week `now` falls in. */
export const dealWeekStart = (now: number = Date.now()): string =>
  ukWeekStart(new Date(now).toISOString());

/** When a deal week starts and ends (ISO 8601; Monday midnight, UK time). */
export function dealWeekBounds(weekStart: string): {
  startsAt: string;
  endsAt: string;
} {
  return {
    startsAt: wallClockToIso(`${weekStart} 00:00`),
    endsAt: wallClockToIso(`${addDays(weekStart, 7)} 00:00`),
  };
}

/**
 * Items the automatic deal can pick: sold directly in the shop now, always
 * on the shelves (not limited-time), and pricey enough for the discount to
 * mean something.
 */
export function dealCandidates(
  items: readonly ShopItem[],
  now: number = Date.now(),
): ShopItem[] {
  return items
    .filter(
      (item) =>
        item.available &&
        inSaleWindow(item, now) &&
        !item.crateOnly &&
        !item.skillOnly &&
        item.availableUntil === undefined &&
        item.price >= DEAL_MIN_PRICE,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * This week's deal: the admin's pick for the week if they made one (and
 * the item is still sold directly), else a stable pick from the candidates
 * seeded by the week, so it rotates every Monday without anything stored.
 */
export function pickDeal(
  items: readonly ShopItem[],
  overrides: readonly ShopDealOverride[],
  now: number = Date.now(),
):
  | {
      item: ShopItem;
      discountPercent: number;
      weekStart: string;
      automatic: boolean;
    }
  | undefined {
  const weekStart = dealWeekStart(now);
  const override = overrides.find((o) => o.weekStart === weekStart);
  const picked = override
    ? items.find((i) => i.id === override.itemId)
    : undefined;
  if (
    override &&
    picked?.available &&
    inSaleWindow(picked, now) &&
    !picked.crateOnly &&
    !picked.skillOnly
  ) {
    return {
      item: picked,
      discountPercent: override.discountPercent,
      weekStart,
      automatic: false,
    };
  }
  const candidates = dealCandidates(items, now);
  if (candidates.length === 0) return undefined;
  return {
    item: candidates[hash53(`deal:${weekStart}`) % candidates.length],
    discountPercent: DEAL_DISCOUNT_PERCENT,
    weekStart,
    automatic: true,
  };
}
