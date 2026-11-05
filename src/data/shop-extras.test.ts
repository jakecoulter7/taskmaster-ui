import { describe, expect, it, vi } from "vitest";
import type { CoinPurchase, PowerUpUse, ShopItem } from "../types";
import { createCoinQueries } from "./coin-queries";
import {
  deriveSabotageBonusRows,
  deriveWallet,
  resolveSabotages,
  spyglassFindings,
  underdogClaims,
} from "./coins";
import {
  dealWeekBounds,
  dealWeekStart,
  drawRaffles,
  pickDeal,
} from "./shop-extras";
import {
  coinData,
  competitionData,
  player,
  shopItem,
  task,
} from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const powerUp = (kind: NonNullable<ShopItem["powerUp"]>) =>
  shopItem({
    id: kind,
    name: kind,
    category: "power_up",
    price: 4,
    powerUp: kind,
  });

const heist = powerUp("heist");
const freeze = powerUp("freeze");
const spyglass = powerUp("spyglass");
const coinRush = powerUp("coin_rush");
const copycat = powerUp("copycat");
const shield = powerUp("shield");
const mirror = powerUp("mirror");
const badge = powerUp("bounty_badge");
const underdog = powerUp("underdog");
const goldenWeek = powerUp("golden_week");
const duck = shopItem({ id: "duck", name: "Duck", price: 10 });
const cat = shopItem({ id: "cat", name: "Cat", price: 6 });
const crown = shopItem({
  id: "crown",
  name: "Crown",
  category: "avatar",
  price: 8,
  imageUrl: "/shop/avatars/crown.svg",
});

let nextId = 1;
const bought = (
  playerId: string,
  item: ShopItem,
  at = "2026-01-05T00:00:00.000Z",
): CoinPurchase => ({
  id: nextId++,
  playerId,
  itemId: item.id,
  price: item.price,
  at,
});
const use = (
  overrides: Partial<PowerUpUse> & Pick<PowerUpUse, "effect" | "playerId">,
): PowerUpUse => ({
  id: nextId++,
  purchaseId: nextId++,
  taskId: "w2",
  at: "2026-01-13T00:00:00.000Z",
  ...overrides,
});

const players = [player("ann", "Ann"), player("bob", "Bob"), player("cat")];

describe("raffle draws", () => {
  const tickets = [
    { id: 1, taskId: "w1", playerId: "ann", price: 2, nonce: "a" },
    { id: 2, taskId: "w1", playerId: "bob", price: 2, nonce: "b" },
    { id: 3, taskId: "w1", playerId: "bob", price: 2, nonce: "c" },
    { id: 4, taskId: "w2", playerId: "ann", price: 2, nonce: "d" },
  ];
  const weeks = [
    { id: "w1", deadline: "2026-01-11T18:00:00.000Z" },
    { id: "w2", deadline: "2026-01-18T18:00:00.000Z" },
  ];
  const now = Date.parse("2026-01-12T00:00:00.000Z");

  it("draws only weeks whose deadline has passed, paying the whole pot", () => {
    const draws = drawRaffles(tickets, weeks, now);
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({
      taskId: "w1",
      pot: 6,
      tickets: 3,
      at: "2026-01-11T18:00:00.000Z",
    });
    expect(["ann", "bob"]).toContain(draws[0].winnerId);
  });

  it("always draws the same winner from the same tickets", () => {
    const first = drawRaffles(tickets, weeks, now);
    const again = drawRaffles([...tickets].reverse(), weeks, now + 1000);
    expect(again).toEqual(first);
  });

  it("depends on the secret nonces", () => {
    const winners = new Set(
      Array.from(
        { length: 40 },
        (_, i) =>
          drawRaffles(
            tickets.map((t) => ({ ...t, nonce: `${t.nonce}-${i}` })),
            weeks,
            now,
          )[0].winnerId,
      ),
    );
    expect(winners).toEqual(new Set(["ann", "bob"]));
  });
});

describe("deal of the week", () => {
  const items = [duck, cat, crown, heist];
  // A Wednesday in January (GMT).
  const wednesday = Date.parse("2026-01-14T12:00:00.000Z");

  it("runs Monday to Monday, UK time", () => {
    expect(dealWeekStart(wednesday)).toBe("2026-01-12");
    expect(dealWeekStart(Date.parse("2026-01-11T23:30:00.000Z"))).toBe(
      "2026-01-05",
    );
    expect(dealWeekBounds("2026-01-12")).toEqual({
      startsAt: "2026-01-12T00:00:00.000Z",
      endsAt: "2026-01-19T00:00:00.000Z",
    });
  });

  it("picks the same item all week, and lets an admin override it", () => {
    const auto = pickDeal(items, [], wednesday);
    expect(auto).toMatchObject({ automatic: true, discountPercent: 30 });
    expect(pickDeal(items, [], wednesday + 2 * 86_400_000)?.item).toEqual(
      auto?.item,
    );
    const picked = pickDeal(
      items,
      [
        {
          weekStart: "2026-01-12",
          itemId: "crown",
          discountPercent: 50,
          actorName: "TM",
        },
      ],
      wednesday,
    );
    expect(picked).toMatchObject({
      automatic: false,
      discountPercent: 50,
      item: crown,
    });
  });

  it("skips egg exclusives, skill rewards, retired and cheap items", () => {
    const only = pickDeal(
      [
        { ...duck, crateOnly: true },
        { ...cat, skillOnly: true },
        { ...crown, available: false },
        shopItem({ id: "cheap", price: 2 }),
        heist,
      ],
      [],
      wednesday,
    );
    expect(only?.item.id).toBe("heist");
  });

  it("takes the discount off what players pay", () => {
    const now = Date.now();
    const q = createCoinQueries(
      competitionData({
        players,
        features: { ...competitionData().features, shop_deals: true },
        coins: coinData({
          items: [duck],
          dealOverrides: [
            {
              weekStart: dealWeekStart(now),
              itemId: "duck",
              discountPercent: 30,
              actorName: "TM",
            },
          ],
        }),
      }),
    );
    expect(q.getItemPrice(duck, "ann")).toBe(7);
    expect(q.getShopDeal({ playerId: "ann" })).toMatchObject({
      discountPercent: 30,
      fullPrice: 10,
      listing: { price: 7, deal: { percent: 30, fullPrice: 10 } },
    });
  });

  it("is off with the flag", () => {
    const q = createCoinQueries(
      competitionData({ players, coins: coinData({ items: [duck] }) }),
    );
    expect(q.getItemPrice(duck, "ann")).toBe(10);
    expect(q.getShopDeal({ playerId: "ann" })).toBeUndefined();
  });
});

describe("Heist", () => {
  it("moves points from the target to its user", () => {
    const heistUse = use({
      effect: "heist",
      playerId: "ann",
      targetPlayerId: "bob",
    });
    expect(deriveSabotageBonusRows([heistUse], players)).toEqual([
      expect.objectContaining({ playerId: "bob", points: -5 }),
      expect.objectContaining({ playerId: "ann", points: 5 }),
    ]);
  });

  it("is turned round by a Mirror and stopped by a Shield, once revealed", () => {
    const mirrored = bought("bob", mirror);
    const heistUse = use({
      effect: "heist",
      playerId: "ann",
      targetPlayerId: "bob",
    });
    const resolutions = resolveSabotages(
      [heistUse],
      [mirrored],
      [heist, mirror],
    );
    expect(resolutions.get(heistUse.id)?.outcome).toBe("reflected");
    expect(
      deriveSabotageBonusRows(
        [heistUse],
        players,
        resolutions,
        new Set(["w2"]),
      ),
    ).toEqual([
      expect.objectContaining({ playerId: "ann", points: -5 }),
      expect.objectContaining({ playerId: "bob", points: 5 }),
    ]);
    // Secret until the week's results are out.
    expect(deriveSabotageBonusRows([heistUse], players, resolutions)).toEqual([
      expect.objectContaining({ playerId: "bob", points: -5 }),
      expect.objectContaining({ playerId: "ann", points: 5 }),
    ]);

    const shielded = bought("cat", shield);
    const onCat = use({
      effect: "heist",
      playerId: "ann",
      targetPlayerId: "cat",
    });
    expect(
      deriveSabotageBonusRows(
        [onCat],
        players,
        resolveSabotages([onCat], [shielded], [heist, shield]),
        new Set(["w2"]),
      ),
    ).toEqual([]);
  });

  it("works through Copycat too", () => {
    const copied = use({
      effect: "copycat",
      copiedEffect: "heist",
      playerId: "ann",
      targetPlayerId: "bob",
    });
    expect(deriveSabotageBonusRows([copied], players)).toHaveLength(2);
  });
});

describe("Underdog", () => {
  const weeks = [1, 2, 3, 4].map((n) =>
    task({
      id: `w${n}`,
      weekNumber: n,
      deadline: `2026-01-${String(n * 7).padStart(2, "0")}T18:00:00.000Z`,
    }),
  );
  const finish = (taskId: string, order: string[]) =>
    order.map((playerId, i) => ({ taskId, playerId, position: i + 1 }));

  it("pays on the week after two bottom-half finishes in a row", () => {
    const charge = bought("ann", underdog, "2026-01-01T00:00:00.000Z");
    const scores = [
      ...finish("w1", ["bob", "cat", "ann"]),
      ...finish("w2", ["cat", "bob", "ann"]),
    ];
    expect(underdogClaims(weeks, scores, [charge], [underdog])).toEqual([
      { purchaseId: charge.id, playerId: "ann", taskId: "w3" },
    ]);
  });

  it("resets on a top-half week and ignores weeks before the purchase", () => {
    const late = bought("ann", underdog, "2026-01-08T00:00:00.000Z");
    const scores = [
      ...finish("w1", ["bob", "cat", "ann"]),
      ...finish("w2", ["ann", "bob", "cat"]),
      ...finish("w3", ["cat", "bob", "ann"]),
    ];
    expect(underdogClaims(weeks, scores, [late], [underdog])).toEqual([]);
  });
});

describe("Spyglass", () => {
  it("sees defences bought before it and not yet used up", () => {
    const shieldCharge = bought("bob", shield, "2026-01-01T00:00:00.000Z");
    const mirrorCharge = bought("bob", mirror, "2026-01-20T00:00:00.000Z");
    const look = use({
      effect: "spyglass",
      playerId: "ann",
      targetPlayerId: "bob",
      at: "2026-01-13T00:00:00.000Z",
    });
    expect(
      spyglassFindings(
        look,
        [look],
        [shieldCharge, mirrorCharge],
        [shield, mirror],
        new Map(),
      ),
    ).toEqual({ shield: true, mirror: false });
  });
});

describe("wallet extras", () => {
  const weeks = [
    task({
      id: "w1",
      weekNumber: 1,
      status: "completed",
      deadline: "2026-01-11T18:00:00.000Z",
    }),
    task({ id: "w2", weekNumber: 2, status: "live" }),
  ];

  it("doubles a week's coins with Coin Rush", () => {
    const rush = use({ effect: "coin_rush", playerId: "ann", taskId: "w1" });
    const data = competitionData({
      players,
      tasks: weeks,
      scores: [
        {
          taskId: "w1",
          playerId: "ann",
          points: 10,
          position: 1,
        } as never,
      ],
      resultsPostedAt: { w1: "2026-01-12T20:00:00.000Z" },
      coins: coinData({
        items: [coinRush],
        uses: [rush],
        entries: [{ taskId: "w1", playerId: "ann" }],
      }),
    });
    const wallet = deriveWallet(data, "ann");
    // 10 for 1st, 2 for entering, then the same again.
    expect(wallet.earned).toBe(24);
    expect(wallet.ledger.find((e) => e.kind === "coin-rush")?.amount).toBe(12);
  });

  it("adds half the next bounty won with Bounty Badge", () => {
    const charge = bought("ann", badge, "2026-01-01T00:00:00.000Z");
    const data = competitionData({
      players,
      coins: coinData({
        items: [badge],
        purchases: [charge],
        bounties: {
          bounties: [1, 2].map((id) => ({
            id,
            posterId: "bob",
            title: `Bounty ${id}`,
            reward: 5,
            status: "awarded" as const,
            winnerId: "ann",
            at: "2026-01-02T00:00:00.000Z",
            closedAt: `2026-01-0${id + 2}T00:00:00.000Z`,
          })),
          claims: [],
        },
      }),
    });
    const lines = deriveWallet(data, "ann").ledger.filter(
      (e) => e.kind === "bounty-badge",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(3);
  });

  it("counts raffle tickets, wins, rename tokens, gift wrap and bundles", () => {
    const wrappedCopy = bought("bob", duck);
    const bundleCopy: CoinPurchase = {
      ...bought("ann", cat),
      price: 0,
      bundlePurchaseId: 1,
    };
    const data = competitionData({
      players,
      tasks: weeks,
      coins: coinData({
        items: [duck, cat],
        purchases: [{ ...wrappedCopy, price: 0 }, bundleCopy],
        raffle: {
          tickets: [
            {
              id: 1,
              taskId: "w1",
              playerId: "ann",
              price: 2,
              at: "2026-01-10T00:00:00.000Z",
            },
            {
              id: 2,
              taskId: "w1",
              playerId: "ann",
              price: 2,
              at: "2026-01-10T00:00:00.000Z",
            },
          ],
          draws: [
            {
              taskId: "w1",
              winnerId: "ann",
              pot: 4,
              tickets: 2,
              at: "2026-01-11T18:00:00.000Z",
            },
          ],
        },
        renameTokens: [
          { id: 1, playerId: "ann", price: 3, at: "2026-01-10T00:00:00.000Z" },
        ],
        wrappedGifts: [
          {
            id: 1,
            purchaseId: wrappedCopy.id,
            fromPlayerId: "ann",
            toPlayerId: "bob",
            itemId: "duck",
            price: 10,
            fee: 2,
            anonymous: true,
            at: "2026-01-10T00:00:00.000Z",
          },
        ],
        bundles: [
          {
            id: "starter",
            name: "Starter",
            description: "",
            price: 5,
            available: true,
            itemIds: ["cat"],
            sortOrder: 0,
          },
        ],
        bundlePurchases: [
          {
            id: 1,
            playerId: "ann",
            bundleId: "starter",
            price: 5,
            at: "2026-01-10T00:00:00.000Z",
          },
        ],
      }),
    });
    const ann = deriveWallet(data, "ann");
    expect(ann.earned).toBe(4);
    // 4 in tickets, 3 for the token, 12 to wrap, 5 for the bundle.
    expect(ann.spent).toBe(24);
    expect(ann.ledger.some((e) => e.kind === "purchase")).toBe(false);
    const bob = deriveWallet(data, "bob");
    expect(bob.ledger.every((e) => e.amount >= 0)).toBe(true);
    expect(bob.ledger.find((e) => e.kind === "gift-wrap-in")?.label).toContain(
      "a secret admirer",
    );
  });
});

describe("power-up panel", () => {
  const weeks = [
    task({ id: "w1", weekNumber: 1, status: "completed" }),
    task({ id: "w2", weekNumber: 2, status: "live" }),
  ];
  const setup = (purchases: CoinPurchase[], uses: PowerUpUse[] = []) =>
    createCoinQueries(
      competitionData({
        players,
        tasks: weeks,
        coins: coinData({
          items: [heist, freeze, spyglass, copycat, goldenWeek, shield],
          purchases,
          uses,
        }),
      }),
    );

  it("stops a frozen player using a power-up, and a Freeze on someone who has", () => {
    const annFreeze = bought("ann", freeze);
    const bobHeist = bought("bob", heist);
    const q = setup(
      [annFreeze, bobHeist],
      [
        use({
          effect: "freeze",
          playerId: "ann",
          targetPlayerId: "bob",
          purchaseId: annFreeze.id,
        }),
      ],
    );
    expect(q.getPowerUpBlock("bob", weeks[1], "heist")).toBe("frozen");
    expect(q.getPowerUpPanel("bob").frozenBy?.id).toBe("ann");
    // Bob's frozen already, and Ann used hers: only Cat can still be frozen.
    expect(q.getPowerUpTargets("cat", "w2").freeze.map((p) => p.id)).toEqual(
      [],
    );
  });

  it("shares the one-hit-per-week limit between Sabotage and Heist", () => {
    const q = setup(
      [],
      [use({ effect: "sabotage", playerId: "cat", targetPlayerId: "bob" })],
    );
    const targets = q.getPowerUpTargets("ann", "w2");
    expect(targets.heist.map((p) => p.id)).toEqual(["cat"]);
    expect(targets.spyglass.map((p) => p.id)).toEqual(["bob", "cat"]);
  });

  it("offers Copycat what others used last week", () => {
    const charge = bought("ann", copycat);
    const q = setup(
      [charge],
      [
        use({ effect: "golden_week", playerId: "bob", taskId: "w1" }),
        use({
          effect: "copycat",
          copiedEffect: "heist",
          playerId: "cat",
          targetPlayerId: "bob",
          taskId: "w1",
        }),
        use({ effect: "golden_week", playerId: "ann", taskId: "w1" }),
      ],
    );
    const choices = q.getCopyable("ann", weeks[1]);
    expect(choices.map((c) => c.effect).sort()).toEqual([
      "golden_week",
      "heist",
    ]);
    expect(q.getPowerUpBlock("ann", weeks[1], "copycat")).toBeUndefined();
    expect(q.getPowerUpBlock("ann", weeks[1], "copycat", "spyglass")).toBe(
      "nothing-to-copy",
    );
  });

  it("logs what Spyglass saw, for its user only", () => {
    const shieldCharge = bought("bob", shield, "2026-01-01T00:00:00.000Z");
    const q = setup(
      [shieldCharge],
      [use({ effect: "spyglass", playerId: "ann", targetPlayerId: "bob" })],
    );
    expect(q.getPowerUpPanel("ann").spyglass).toEqual([
      expect.objectContaining({ shield: true, mirror: false }),
    ]);
    expect(q.getPowerUpPanel("bob").spyglass).toEqual([]);
  });
});

describe("shop extras", () => {
  const live = task({ id: "w2", weekNumber: 2, status: "live" });
  const starter = {
    id: "starter",
    name: "Starter",
    description: "",
    price: 12,
    available: true,
    itemIds: ["duck", "crown"],
    sortOrder: 0,
  };
  const setup = (purchases: CoinPurchase[] = [], grant = 20) =>
    createCoinQueries(
      competitionData({
        players,
        tasks: [live],
        features: {
          ...competitionData().features,
          shop_bundles: true,
          shop_raffle: true,
          shop_gift_wrap: true,
        },
        coins: coinData({
          items: [duck, cat, crown, heist],
          purchases,
          bundles: [starter],
          adjustments: ["ann", "bob"].map((playerId, i) => ({
            id: i + 1,
            playerId,
            amount: grant,
            reason: "Starter coins",
            actorName: "Taskmaster",
            at: "2026-01-01T00:00:00.000Z",
          })),
          raffle: {
            tickets: [1, 2, 3, 4].map((id) => ({
              id,
              taskId: "w2",
              playerId: "ann",
              price: 2,
              at: "2026-01-10T00:00:00.000Z",
            })),
            draws: [],
          },
        }),
      }),
    );

  it("won't sell a bundle to someone who's had one of its items", () => {
    const q = setup([bought("bob", crown)]);
    expect(q.getBundleViews({ playerId: "ann" })[0]).toMatchObject({
      value: 18,
    });
    expect(q.getBundleBlock(starter, { playerId: "ann" })).toBeUndefined();
    expect(q.getBundleBlock(starter, { playerId: "bob" })).toBe("owned");
    expect(q.getBundleBlock(starter, { playerId: "cat" })).toBe("unaffordable");
  });

  it("caps raffle tickets a week", () => {
    const ann = setup().getRafflePanel({ playerId: "ann" });
    expect(ann).toMatchObject({ myTickets: 4, pot: 8, canBuy: 1 });
    const bob = setup().getRafflePanel({ playerId: "bob" });
    expect(bob).toMatchObject({ myTickets: 0, totalTickets: 4, canBuy: 5 });
  });

  it("only wraps things the recipient hasn't had, and never power-ups", () => {
    const q = setup([bought("bob", duck)]);
    expect(q.getGiftWrapBlock("ann", "bob", duck)).toBe("recipient-owns");
    expect(q.getGiftWrapBlock("ann", "bob", cat)).toBeUndefined();
    expect(q.getGiftWrapBlock("ann", "bob", heist)).toBe("unavailable");
    expect(q.getGiftWrapBlock("ann", "ann", cat)).toBe("invalid");
    expect(
      q.getGiftWrapPanel({ playerId: "ann" }).items.map((i) => i.item.id),
    ).toEqual(["duck", "cat", "crown"]);
  });
});
