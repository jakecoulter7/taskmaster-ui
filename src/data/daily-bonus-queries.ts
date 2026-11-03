import type {
  CompetitionData,
  DailyBonusDayView,
  DailyBonusPanel,
} from "../types";
import { getCrate } from "./coin-rules";
import { deriveDailyBonusStreak } from "./daily-bonus";
import { ukToday } from "./mini-tasks";

/** Daily sign-in bonus selectors (spread into `createQueries`). */
export function createDailyBonusQueries(data: CompetitionData) {
  const { coins } = data;
  const itemById = new Map(coins.items.map((i) => [i.id, i]));

  /**
   * `playerId`'s daily bonus: the cycle with today's day marked, their
   * streak, and what today's claim gave once claimed. `undefined` while
   * the flag is off or for someone not on the season's roster.
   */
  function getDailyBonusPanel(
    playerId: string,
    now: number = Date.now(),
  ): DailyBonusPanel | undefined {
    if (!data.features.daily_bonus) return undefined;
    if (!data.players.some((p) => p.id === playerId)) return undefined;
    const today = ukToday(now);
    const streak = deriveDailyBonusStreak(
      coins.dailyBonusClaims,
      playerId,
      today,
    );
    const days = coins.dailyBonusRewards.map((reward): DailyBonusDayView => {
      const item = reward.itemId ? itemById.get(reward.itemId) : undefined;
      const crate = reward.crateId ? getCrate(reward.crateId) : undefined;
      const state =
        reward.day === streak.day
          ? streak.claimedToday
            ? "claimed"
            : "today"
          : reward.day < streak.day
            ? "claimed"
            : "upcoming";
      return {
        reward,
        ...(item && { item }),
        ...(crate && { crate }),
        state,
      };
    });
    const claim = streak.claimedToday
      ? coins.dailyBonusClaims.find(
          (c) => c.playerId === playerId && c.claimedOn === today,
        )
      : undefined;
    const itemGift =
      claim?.itemGiftId === undefined
        ? undefined
        : coins.itemGifts.find((g) => g.id === claim.itemGiftId);
    const eggGift =
      claim?.eggGiftId === undefined
        ? undefined
        : coins.eggGifts.find((g) => g.id === claim.eggGiftId);
    const claimedItem = itemGift && itemById.get(itemGift.itemId);
    const claimedCrate = eggGift && getCrate(eggGift.crateId);
    return {
      streak,
      days,
      ...(claim && {
        claimed: {
          coins: claim.coins,
          ...(claimedItem && { item: claimedItem }),
          ...(claimedCrate && { crate: claimedCrate }),
        },
      }),
      ...(data.season.status === "closed" && {
        blocked: "season-closed" as const,
      }),
    };
  }

  return { getDailyBonusPanel };
}
