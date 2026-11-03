import type { APIRoute } from "astro";
import type { DailyBonusOutcome } from "../../types";
import { loadFreshPlayerCompetition } from "../../data/competition";
import {
  DAILY_BONUS_OWNED_ITEM_COINS,
  deriveDailyBonusStreak,
} from "../../data/daily-bonus";
import { ukToday } from "../../data/mini-tasks";
import { claimDailyBonus } from "../../data/shop";
import { withBase } from "../../lib/url";

// Claiming the daily sign-in bonus. Living under `/account` means the
// middleware has already required a signed-in player and purges the cached
// rows after; Astro's origin check rejects cross-site posts. The streak is
// worked out from fresh rows, and the write's unique key stops a second
// claim on the same day.

const back = (outcome: DailyBonusOutcome) =>
  withBase(`/account?daily=${outcome}#daily-bonus`);

export const GET: APIRoute = ({ redirect }) =>
  redirect(withBase("/account#daily-bonus"));

export const POST: APIRoute = async ({ locals, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const reply = (outcome: DailyBonusOutcome) => redirect(back(outcome), 303);

  const data = await loadFreshPlayerCompetition(player.playerId);
  if (!data) return reply("invalid");
  if (!data.features.daily_bonus) return reply("disabled");
  if (data.season.status === "closed") return reply("season-closed");

  const today = ukToday();
  const streak = deriveDailyBonusStreak(
    data.coins.dailyBonusClaims,
    player.playerId,
    today,
  );
  if (streak.claimedToday) return reply("already-claimed");
  const reward = data.coins.dailyBonusRewards.find((r) => r.day === streak.day);
  if (!reward) return reply("invalid");

  const claimed = await claimDailyBonus(
    player.playerId,
    data.season.id,
    today,
    reward,
    DAILY_BONUS_OWNED_ITEM_COINS,
  );
  return reply(claimed ? "claimed" : "already-claimed");
};
