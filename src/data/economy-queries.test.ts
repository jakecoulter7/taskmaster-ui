import { describe, expect, it, vi } from "vitest";
import type { CompetitionData } from "../types";
import { createCoinQueries } from "./coin-queries";
import { createEconomyQueries, ukWeekStart } from "./economy-queries";
import {
  at,
  coinData,
  competitionData,
  player,
  shopItem,
} from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const NOW = at("2026-10-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const duck = shopItem({ id: "duck", name: "Duck", price: 10, stock: 3 });
const robot = shopItem({ id: "robot", name: "Robot", price: 4 });
const retired = shopItem({ id: "old", name: "Old", available: false });
const eggOnly = shopItem({ id: "egg-pet", name: "Egg Pet", crateOnly: true });

function data(): CompetitionData {
  return competitionData({
    players: [player("ann", "Ann"), player("bob", "Bob"), player("cat", "Cat")],
    features: { ...competitionData().features, bounties: true },
    coins: coinData({
      items: [duck, robot, retired, eggOnly],
      adjustments: [
        // Week of Mon 5 Oct.
        {
          id: 1,
          playerId: "ann",
          amount: 30,
          reason: "seed",
          actorName: "TM",
          at: "2026-10-06T10:00:00.000Z",
        },
        {
          id: 2,
          playerId: "bob",
          amount: 20,
          reason: "seed",
          actorName: "TM",
          at: "2026-10-06T10:00:00.000Z",
        },
        // Week of Mon 12 Oct.
        {
          id: 3,
          playerId: "bob",
          amount: -2,
          reason: "fine",
          actorName: "TM",
          at: "2026-10-13T10:00:00.000Z",
        },
      ],
      purchases: [
        {
          id: 1,
          playerId: "ann",
          itemId: "duck",
          price: 10,
          at: iso(NOW - DAY),
        },
        {
          id: 2,
          playerId: "bob",
          itemId: "robot",
          price: 4,
          at: iso(NOW - DAY),
        },
        // An egg's zero-price copy isn't a shop sale.
        { id: 3, playerId: "bob", itemId: "egg-pet", price: 0, at: iso(NOW) },
      ],
      crateOpens: [
        {
          id: 1,
          purchaseId: 3,
          playerId: "bob",
          crateId: "mystery-egg",
          price: 6,
          itemId: "egg-pet",
          rarity: "common",
          at: iso(NOW - DAY),
        },
      ],
      gifts: [
        {
          id: 1,
          fromPlayerId: "ann",
          toPlayerId: "cat",
          amount: 3,
          at: iso(NOW - DAY),
        },
      ],
      bounties: {
        bounties: [
          {
            id: 1,
            posterId: "ann",
            title: "Dare",
            reward: 5,
            status: "open",
            at: iso(NOW - DAY),
          },
        ],
        claims: [],
      },
    }),
  });
}

const report = (d: CompetitionData = data()) =>
  createEconomyQueries(d, {
    getWallet: createCoinQueries(d).getWallet,
  }).getEconomyReport(NOW);

describe("ukWeekStart", () => {
  it("finds the UK Monday, across midnight and the clocks changing", () => {
    expect(ukWeekStart("2026-10-21T12:00:00Z")).toBe("2026-10-19");
    expect(ukWeekStart("2026-10-19T00:30:00+01:00")).toBe("2026-10-19");
    // 23:30 UTC on Sunday 25 Oct is still Sunday in London (GMT).
    expect(ukWeekStart("2026-10-25T23:30:00Z")).toBe("2026-10-19");
    // 23:30 UTC on Sunday 18 Oct is Monday 00:30 in London (BST).
    expect(ukWeekStart("2026-10-18T23:30:00Z")).toBe("2026-10-19");
  });
});

describe("getEconomyReport", () => {
  it("totals what came in, went out and moved between players", () => {
    const r = report();
    // In: 50 granted. Out: 2 deducted + 14 shop + 6 egg. Moved: a 3 gift.
    expect(r).toMatchObject({ minted: 50, burned: 22, moved: 3 });
    expect(r.circulating).toBe(28);
    // Ann's open bounty holds 5 of them.
    expect(r.held).toBe(5);
  });

  it("agrees with every player's wallet", () => {
    const d = data();
    const { getWallet } = createCoinQueries(d);
    const wallets = ["ann", "bob", "cat"].map((id) => getWallet(id, NOW));
    expect(report(d).circulating).toBe(
      wallets.reduce((sum, w) => sum + w.balance + w.held, 0),
    );
  });

  it("breaks coins down by source, in by flow and biggest first", () => {
    expect(
      report().sources.map((s) => [s.source, s.flow, s.amount, s.count]),
    ).toEqual([
      ["grants", "granted", 50, 2],
      ["shop", "spent", 14, 2],
      ["crates", "spent", 6, 1],
      ["deductions", "spent", 2, 1],
      ["gifts", "moved", 3, 1],
    ]);
  });

  it("charts the supply week by week", () => {
    expect(report().weeks).toEqual([
      { weekStart: "2026-10-05", minted: 50, burned: 0, circulating: 50 },
      { weekStart: "2026-10-12", minted: 0, burned: 2, circulating: 48 },
      { weekStart: "2026-10-19", minted: 0, burned: 20, circulating: 28 },
    ]);
  });

  it("ranks holders by what they hold, held coins included", () => {
    expect(
      report().holders.map((h) => [h.player.id, h.balance, h.held]),
    ).toEqual([
      ["ann", 12, 5],
      ["bob", 8, 0],
      ["cat", 3, 0],
    ]);
  });

  it("reports shop sales and stock, skipping egg exclusives", () => {
    expect(
      report().shop.map((s) => [s.item.id, s.sold, s.revenue, s.stockLeft]),
    ).toEqual([
      ["duck", 1, 10, 2],
      ["robot", 1, 4, undefined],
    ]);
    expect(report().crates).toEqual([
      { crateId: "mystery-egg", name: "Mystery Egg", opened: 1, revenue: 6 },
    ]);
  });

  it("is empty for a season with no coin activity", () => {
    const r = report(
      competitionData({ players: [player("ann")], coins: coinData() }),
    );
    expect(r).toMatchObject({ circulating: 0, minted: 0, burned: 0 });
    expect(r.weeks).toEqual([]);
    expect(r.sources).toEqual([]);
  });
});
