import type {
  DailyBonusClaim,
  DailyBonusReward,
  DailyBonusStreak,
} from "../types";
import type {
  dailyBonusClaims as dailyBonusClaimsTable,
  dailyBonusRewards as dailyBonusRewardsTable,
} from "../db/schema";
import { timestamptzToIso } from "../lib/time";

type RewardRow = typeof dailyBonusRewardsTable.$inferSelect;
type ClaimRow = typeof dailyBonusClaimsTable.$inferSelect;

/** Days in the streak cycle; claiming day 7 starts again at day 1. */
export const DAILY_BONUS_DAYS = 7;

/** The most coins one day can pay (also a database check). */
export const DAILY_BONUS_MAX_COINS = 100;

/** Coins paid instead of a scheduled item the player already owns. */
export const DAILY_BONUS_OWNED_ITEM_COINS = 5;

/** What each day pays until an admin sets the season's schedule. */
export const DEFAULT_DAILY_BONUS: readonly DailyBonusReward[] = [
  { day: 1, coins: 1 },
  { day: 2, coins: 1 },
  { day: 3, coins: 2 },
  { day: 4, coins: 2 },
  { day: 5, coins: 3 },
  { day: 6, coins: 3 },
  { day: 7, coins: 5 },
];

/** Rows → the full 7-day schedule, with defaults for days without a row. */
export function mapDailyBonusRewards(
  rows: readonly RewardRow[],
): DailyBonusReward[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return DEFAULT_DAILY_BONUS.map((fallback) => {
    const row = byDay.get(fallback.day);
    if (!row) return fallback;
    return {
      day: row.day,
      coins: row.coins,
      ...(row.itemId && { itemId: row.itemId }),
      ...(row.crateId && { crateId: row.crateId }),
    };
  });
}

/** Rows → claims, oldest first. */
export function mapDailyBonusClaims(
  rows: readonly ClaimRow[],
): DailyBonusClaim[] {
  return rows
    .map((row) => ({
      id: row.id,
      playerId: row.playerId,
      claimedOn: row.claimedOn,
      day: row.day,
      coins: row.coins,
      ...(row.itemGiftId !== null && { itemGiftId: row.itemGiftId }),
      ...(row.eggGiftId !== null && { eggGiftId: row.eggGiftId }),
      at: timestamptzToIso(row.createdAt),
    }))
    .sort((a, b) => a.claimedOn.localeCompare(b.claimedOn) || a.id - b.id);
}

/** The calendar day before `date` (both YYYY-MM-DD). */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Where `playerId`'s streak stands on `today` (UK date): the cycle day
 * they're on, whether it's claimed, and how many days in a row they've
 * claimed. Missing a day starts the cycle again at day 1.
 */
export function deriveDailyBonusStreak(
  claims: readonly DailyBonusClaim[],
  playerId: string,
  today: string,
): DailyBonusStreak {
  const mine = claims
    .filter((c) => c.playerId === playerId && c.claimedOn <= today)
    .sort((a, b) => b.claimedOn.localeCompare(a.claimedOn));
  const last = mine[0];
  const yesterday = dayBefore(today);
  if (!last || (last.claimedOn !== today && last.claimedOn !== yesterday)) {
    return { day: 1, claimedToday: false, streak: 0 };
  }
  let streak = 1;
  for (let i = 1; i < mine.length; i++) {
    if (mine[i].claimedOn !== dayBefore(mine[i - 1].claimedOn)) break;
    streak++;
  }
  return last.claimedOn === today
    ? { day: last.day, claimedToday: true, streak }
    : { day: (last.day % DAILY_BONUS_DAYS) + 1, claimedToday: false, streak };
}
