import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_BONUS,
  dayBefore,
  deriveDailyBonusStreak,
  mapDailyBonusRewards,
} from "./daily-bonus";
import { deriveWallet } from "./coins";
import { createQueries } from "./queries";
import { parseDailyBonusForm } from "../lib/admin-forms";
import type { DailyBonusClaim, DailyBonusReward } from "../types";
import {
  at,
  coinData,
  competitionData,
  player,
  shopItem,
} from "../test/fixtures";

// Pure derivations; this only stops the db client's `astro:env` import
// loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const claim = (
  claimedOn: string,
  day: number,
  overrides: Partial<DailyBonusClaim> = {},
): DailyBonusClaim => ({
  id: day,
  playerId: "ann",
  claimedOn,
  day,
  coins: day,
  at: `${claimedOn}T09:00:00.000Z`,
  ...overrides,
});

describe("dayBefore", () => {
  it("steps back across months and years", () => {
    expect(dayBefore("2026-11-01")).toBe("2026-10-31");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  });
});

describe("deriveDailyBonusStreak", () => {
  it("starts at day 1 with no claims", () => {
    expect(deriveDailyBonusStreak([], "ann", "2026-11-03")).toEqual({
      day: 1,
      claimedToday: false,
      streak: 0,
    });
  });

  it("moves to the next day after claiming yesterday", () => {
    const claims = [claim("2026-11-01", 1), claim("2026-11-02", 2)];
    expect(deriveDailyBonusStreak(claims, "ann", "2026-11-03")).toEqual({
      day: 3,
      claimedToday: false,
      streak: 2,
    });
  });

  it("reports today's claim once made", () => {
    const claims = [claim("2026-11-02", 2), claim("2026-11-03", 3)];
    expect(deriveDailyBonusStreak(claims, "ann", "2026-11-03")).toEqual({
      day: 3,
      claimedToday: true,
      streak: 2,
    });
  });

  it("resets to day 1 after a missed day", () => {
    const claims = [claim("2026-11-01", 4)];
    expect(deriveDailyBonusStreak(claims, "ann", "2026-11-03")).toEqual({
      day: 1,
      claimedToday: false,
      streak: 0,
    });
  });

  it("wraps back to day 1 after day 7, keeping the streak", () => {
    const claims = [
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ].map((date, i) => claim(date, i + 1));
    expect(deriveDailyBonusStreak(claims, "ann", "2026-11-03")).toEqual({
      day: 1,
      claimedToday: false,
      streak: 7,
    });
  });

  it("only counts the player's own claims", () => {
    const claims = [claim("2026-11-02", 5, { playerId: "bob" })];
    expect(deriveDailyBonusStreak(claims, "ann", "2026-11-03").day).toBe(1);
  });
});

describe("mapDailyBonusRewards", () => {
  const row = (day: number, extra: Partial<DailyBonusReward> = {}) => ({
    seasonId: "s",
    day,
    coins: 10,
    itemId: extra.itemId ?? null,
    crateId: extra.crateId ?? null,
    createdAt: "2026-10-01 00:00:00+00",
    updatedAt: "2026-10-01 00:00:00+00",
  });

  it("fills unset days from the default schedule", () => {
    const rewards = mapDailyBonusRewards([row(7, { crateId: "mystery-egg" })]);
    expect(rewards).toHaveLength(7);
    expect(rewards[0]).toEqual(DEFAULT_DAILY_BONUS[0]);
    expect(rewards[6]).toEqual({ day: 7, coins: 10, crateId: "mystery-egg" });
  });
});

describe("daily bonus wallet and panel", () => {
  const hat = shopItem({ id: "hat", name: "Party Hat", category: "avatar" });
  const data = competitionData({
    players: [player("ann"), player("bob")],
    features: { ...competitionData().features, daily_bonus: true },
    coins: coinData({
      items: [hat],
      dailyBonusRewards: DEFAULT_DAILY_BONUS.map((r) =>
        r.day === 3 ? { ...r, itemId: "hat" } : r,
      ),
      purchases: [
        {
          id: 1,
          playerId: "ann",
          itemId: "hat",
          price: 0,
          at: "2026-11-03T09:00:00.000Z",
        },
      ],
      itemGifts: [
        {
          id: 9,
          purchaseId: 1,
          playerId: "ann",
          itemId: "hat",
          reason: "Daily bonus: day 3",
          actorName: "Daily bonus",
          at: "2026-11-03T09:00:00.000Z",
        },
      ],
      dailyBonusClaims: [
        claim("2026-11-02", 2, { coins: 1 }),
        claim("2026-11-03", 3, { coins: 2, itemGiftId: 9 }),
      ],
    }),
  });

  it("pays claims into the wallet on one line each", () => {
    const wallet = deriveWallet(data, "ann");
    expect(wallet.balance).toBe(3);
    expect(wallet.ledger.map((e) => [e.kind, e.amount, e.label])).toEqual([
      ["daily-bonus", 2, "Daily bonus: day 3 of 7 + Party Hat"],
      ["daily-bonus", 1, "Daily bonus: day 2 of 7"],
    ]);
  });

  it("marks the cycle and today's claim", () => {
    const panel = createQueries(data).getDailyBonusPanel(
      "ann",
      at("2026-11-03T12:00:00.000Z"),
    );
    expect(panel?.streak).toEqual({ day: 3, claimedToday: true, streak: 2 });
    expect(panel?.days.map((d) => d.state)).toEqual([
      "claimed",
      "claimed",
      "claimed",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(panel?.days[2].item?.id).toBe("hat");
    expect(panel?.claimed).toEqual({ coins: 2, item: hat });
  });

  it("is hidden while the flag is off", () => {
    const off = createQueries(
      competitionData({ ...data, features: competitionData().features }),
    );
    expect(off.getDailyBonusPanel("ann")).toBeUndefined();
  });
});

describe("parseDailyBonusForm", () => {
  const form = (overrides: Record<string, string> = {}) => {
    const data = new FormData();
    for (let day = 1; day <= 7; day++) {
      data.set(`coins${day}`, String(day));
      data.set(`extra${day}`, "");
    }
    for (const [key, value] of Object.entries(overrides)) data.set(key, value);
    return data;
  };

  it("parses a schedule with items and eggs", () => {
    const result = parseDailyBonusForm(
      form({ extra3: "item:hat", coins7: "0", extra7: "egg:mystery-egg" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[2]).toEqual({ day: 3, coins: 3, itemId: "hat" });
    expect(result.data[6]).toEqual({
      day: 7,
      coins: 0,
      crateId: "mystery-egg",
    });
  });

  it("rejects an empty day, unknown eggs and out-of-range coins", () => {
    const result = parseDailyBonusForm(
      form({ coins1: "0", extra2: "egg:nope", coins4: "101" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "coins1",
      "coins4",
      "extra2",
    ]);
  });
});
