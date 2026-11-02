import { describe, expect, it, vi } from "vitest";
import type {
  Bounty,
  BountyClaim,
  CoinAdjustment,
  CompetitionData,
} from "../types";
import { createCoinQueries } from "./coin-queries";
import { createBountyQueries } from "./bounty-queries";
import { createNotificationQueries } from "./notification-queries";
import { deriveWallet } from "./coins";
import { BOUNTY_MS, BOUNTY_OPEN_LIMIT } from "./coin-rules";
import { bountyHeldCoins, bountyStatus, mapBounties } from "./bounty-mappers";
import { parseBountyAction } from "../lib/account-forms";
import {
  at,
  coinData,
  competitionData,
  player,
  season,
} from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const NOW = at("2026-10-20T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

const grant = (
  id: number,
  playerId: string,
  amount: number,
): CoinAdjustment => ({
  id,
  playerId,
  amount,
  reason: "seed",
  actorName: "TM",
  at: iso(NOW - 6 * DAY),
});

const bounty = (overrides: Partial<Bounty> = {}): Bounty => ({
  id: 1,
  posterId: "ann",
  title: "Selfie with the CTO",
  reward: 10,
  status: "open",
  at: iso(NOW - DAY),
  ...overrides,
});

const claim = (overrides: Partial<BountyClaim> = {}): BountyClaim => ({
  id: 1,
  bountyId: 1,
  playerId: "bob",
  at: iso(NOW - DAY / 2),
  ...overrides,
});

function data(
  bounties: Bounty[],
  claims: BountyClaim[] = [],
  overrides: Partial<CompetitionData> = {},
): CompetitionData {
  return competitionData({
    players: [player("ann", "Ann"), player("bob", "Bob"), player("cat", "Cat")],
    features: { ...competitionData().features, bounties: true },
    coins: coinData({
      adjustments: [grant(1, "ann", 20), grant(2, "bob", 20)],
      bounties: { bounties, claims },
    }),
    ...overrides,
  });
}

const queries = (d: CompetitionData) =>
  createBountyQueries(d, { getWallet: createCoinQueries(d).getWallet });

describe("mapBounties", () => {
  it("maps rows, dropping nulls and normalising timestamps", () => {
    const mapped = mapBounties(
      [
        {
          id: 2,
          seasonId: "s",
          posterId: "ann",
          title: "Do a thing",
          details: null,
          reward: 5,
          status: "awarded",
          winnerId: "bob",
          resolvedByName: null,
          createdAt: "2026-10-01 10:00:00+00",
          closedAt: "2026-10-02 10:00:00+00",
        },
      ],
      [
        {
          id: 3,
          bountyId: 2,
          playerId: "bob",
          note: null,
          createdAt: "2026-10-01 12:00:00+00",
        },
      ],
    );
    expect(mapped.bounties).toEqual([
      {
        id: 2,
        posterId: "ann",
        title: "Do a thing",
        reward: 5,
        status: "awarded",
        winnerId: "bob",
        at: "2026-10-01T10:00:00.000Z",
        closedAt: "2026-10-02T10:00:00.000Z",
      },
    ]);
    expect(mapped.claims).toEqual([
      { id: 3, bountyId: 2, playerId: "bob", at: "2026-10-01T12:00:00.000Z" },
    ]);
  });
});

describe("bountyStatus", () => {
  it("lapses an open bounty once its time is up", () => {
    const b = bounty({ at: iso(NOW - BOUNTY_MS) });
    expect(bountyStatus(b, NOW - 1)).toBe("open");
    expect(bountyStatus(b, NOW)).toBe("expired");
    expect(bountyStatus({ ...b, status: "awarded" }, NOW)).toBe("awarded");
  });
});

describe("bounty coins", () => {
  it("holds an open bounty's reward from the poster", () => {
    const d = data([bounty()]);
    expect(bountyHeldCoins(d.coins.bounties, "ann", NOW)).toBe(10);
    const wallet = deriveWallet(d, "ann", NOW);
    expect(wallet).toMatchObject({ held: 10, balance: 10, bountied: 0 });
  });

  it("frees the coins when the bounty lapses or is cancelled", () => {
    const lapsed = data([bounty({ at: iso(NOW - BOUNTY_MS - 1) })]);
    expect(deriveWallet(lapsed, "ann", NOW).balance).toBe(20);
    const cancelled = data([
      bounty({ status: "cancelled", closedAt: iso(NOW - 1) }),
    ]);
    expect(deriveWallet(cancelled, "ann", NOW).balance).toBe(20);
  });

  it("moves an awarded reward from the poster to the winner", () => {
    const d = data(
      [
        bounty({
          status: "awarded",
          winnerId: "bob",
          closedAt: iso(NOW - DAY / 4),
        }),
      ],
      [claim()],
    );
    const ann = deriveWallet(d, "ann", NOW);
    const bob = deriveWallet(d, "bob", NOW);
    expect(ann).toMatchObject({ balance: 10, held: 0, bountied: -10 });
    expect(bob).toMatchObject({ balance: 30, bountied: 10 });
    expect(ann.ledger[0]).toMatchObject({ kind: "bounty-paid", amount: -10 });
    expect(bob.ledger[0]).toMatchObject({
      kind: "bounty-won",
      amount: 10,
      label: `Won Ann's bounty "Selfie with the CTO"`,
    });
  });
});

describe("getBountyBoard", () => {
  it("lists open bounties biggest first and the rest newest first", () => {
    const board = queries(
      data([
        bounty({ id: 1, reward: 5 }),
        bounty({ id: 2, reward: 15 }),
        bounty({ id: 3, status: "cancelled", closedAt: iso(NOW - 2 * DAY) }),
        bounty({ id: 4, status: "cancelled", closedAt: iso(NOW - DAY) }),
      ]),
    ).getBountyBoard(NOW);
    expect(board.open.map((v) => v.bounty.id)).toEqual([2, 1]);
    expect(board.settled.map((v) => v.bounty.id)).toEqual([4, 3]);
  });

  it("skips bounties whose poster isn't in the season", () => {
    const board = queries(data([bounty({ posterId: "ghost" })])).getBountyBoard(
      NOW,
    );
    expect(board.open).toEqual([]);
  });
});

describe("getBounty", () => {
  const d = data([bounty()], [claim()]);

  it("lets the poster award a claimed bounty but not take it down", () => {
    const detail = queries(d).getBounty(1, "ann", NOW);
    expect(detail).toMatchObject({
      isPoster: true,
      canAward: true,
      canCancel: false,
      claimBlocked: "own-bounty",
    });
  });

  it("lets the poster take down a bounty nobody's claimed", () => {
    const detail = queries(data([bounty()])).getBounty(1, "ann", NOW);
    expect(detail).toMatchObject({ canAward: false, canCancel: true });
  });

  it("shows a claimant their claim, and lets others claim", () => {
    expect(queries(d).getBounty(1, "bob", NOW)?.myClaim?.id).toBe(1);
    const cat = queries(d).getBounty(1, "cat", NOW);
    expect(cat?.claimBlocked).toBeUndefined();
    expect(cat?.myClaim).toBeUndefined();
  });

  it("blocks guests, closed bounties, closed seasons and the flag", () => {
    expect(queries(d).getBounty(1, undefined, NOW)?.claimBlocked).toBe("guest");
    expect(queries(d).getBounty(1, "cat", NOW + 8 * DAY)?.claimBlocked).toBe(
      "closed",
    );
    const closed = data([bounty()], [], {
      season: season({ status: "closed" }),
    });
    expect(queries(closed).getBounty(1, "cat", NOW)?.claimBlocked).toBe(
      "season-closed",
    );
    const off = data([bounty()], [], {
      features: competitionData().features,
    });
    expect(queries(off).getBounty(1, "cat", NOW)).toMatchObject({
      claimBlocked: "disabled",
    });
    expect(queries(off).getBounty(1, "ann", NOW)?.canCancel).toBe(false);
  });

  it("is undefined for an unknown bounty", () => {
    expect(queries(d).getBounty(99, "ann", NOW)).toBeUndefined();
  });
});

describe("getBountyPostPanel", () => {
  it("says what a player can put up", () => {
    expect(queries(data([bounty()])).getBountyPostPanel("ann", NOW)).toEqual({
      available: 10,
      openCount: 1,
    });
  });

  it("blocks guests, the limit and empty wallets", () => {
    const q = queries(
      data(
        Array.from({ length: BOUNTY_OPEN_LIMIT }, (_, i) =>
          bounty({ id: i + 1, reward: 1 }),
        ),
      ),
    );
    expect(q.getBountyPostPanel(undefined, NOW).blocked).toBe("guest");
    expect(q.getBountyPostPanel("ann", NOW).blocked).toBe("limit");
    expect(q.getBountyPostPanel("cat", NOW).blocked).toBe("unaffordable");
  });
});

describe("bounty notifications", () => {
  const feed = (d: CompetitionData, playerId: string) =>
    createNotificationQueries(d, { getPlayerRankHistory: () => [] })
      .getNotifications({ playerId, now: NOW })
      .items.filter((i) => i.kind.startsWith("bounty"))
      .map((i) => [i.kind, i.title]);

  it("tells the poster about claims and the winner they won", () => {
    const d = data(
      [
        bounty({
          status: "awarded",
          winnerId: "bob",
          closedAt: iso(NOW - DAY / 4),
        }),
      ],
      [claim()],
    );
    expect(feed(d, "ann")).toEqual([
      ["bounty-claimed", `Bob claimed your bounty "Selfie with the CTO"`],
    ]);
    expect(feed(d, "bob")).toEqual([
      ["bounty-won", `You won 10 Clim Coin for "Selfie with the CTO"`],
    ]);
  });

  it("stays quiet while the flag is off", () => {
    const d = data([bounty()], [claim()], {
      features: competitionData().features,
    });
    expect(feed(d, "ann")).toEqual([]);
  });
});

describe("parseBountyAction", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("parses a post, trimming and dropping blank details", () => {
    expect(
      parseBountyAction(
        form({ intent: "post", title: "  Dare  ", details: " ", reward: "5" }),
      ),
    ).toEqual({ intent: "post", title: "Dare", reward: 5 });
  });

  it("rejects rewards out of range and blank titles", () => {
    expect(
      parseBountyAction(form({ intent: "post", title: "x", reward: "51" })),
    ).toBeUndefined();
    expect(
      parseBountyAction(form({ intent: "post", title: "x", reward: "0" })),
    ).toBeUndefined();
    expect(
      parseBountyAction(form({ intent: "post", title: " ", reward: "5" })),
    ).toBeUndefined();
  });

  it("parses claims and awards", () => {
    expect(
      parseBountyAction(form({ intent: "claim", bountyId: "3", note: "done" })),
    ).toEqual({ intent: "claim", bountyId: 3, note: "done" });
    expect(
      parseBountyAction(
        form({ intent: "award", bountyId: "3", winnerId: "bob" }),
      ),
    ).toEqual({ intent: "award", bountyId: 3, winnerId: "bob" });
    expect(parseBountyAction(form({ intent: "award", bountyId: "x" }))).toBe(
      undefined,
    );
  });
});
