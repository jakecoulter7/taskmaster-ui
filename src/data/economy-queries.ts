import type {
  CoinLedgerKind,
  CompetitionData,
  EconomyCrateRow,
  EconomyFlow,
  EconomyHolder,
  EconomyReport,
  EconomyShopRow,
  EconomySource,
  EconomySourceRow,
  EconomyWeek,
  Wallet,
} from "../types";
import { ukWeekStart } from "../lib/time";
import { getCrate } from "./coin-rules";
import { isOnSale } from "./coins";

interface EconomyDeps {
  getWallet: (playerId: string, now?: number) => Wallet;
}

/** How many holders the dashboard ranks. */
export const ECONOMY_TOP_HOLDERS = 10;

const SOURCE_INFO: Record<EconomySource, { flow: EconomyFlow; label: string }> =
  {
    placements: { flow: "earned", label: "task placements" },
    entries: { flow: "earned", label: "task entries" },
    votes: { flow: "earned", label: "votes & predictions" },
    "mini-tasks": { flow: "earned", label: "mini-tasks" },
    "skill-perks": { flow: "earned", label: "skill perks" },
    "power-ups": { flow: "earned", label: "power-up bonuses" },
    grants: { flow: "granted", label: "admin grants" },
    deductions: { flow: "spent", label: "admin deductions" },
    shop: { flow: "spent", label: "shop purchases" },
    crates: { flow: "spent", label: "mystery eggs" },
    skills: { flow: "spent", label: "skill unlocks" },
    gifts: { flow: "moved", label: "gifts" },
    market: { flow: "moved", label: "marketplace" },
    bounties: { flow: "moved", label: "bounties" },
    raffle: { flow: "moved", label: "raffle pots" },
  };

/**
 * Which source each ledger line counts towards. Transfers between players
 * count once, on the receiving side, so they aren't doubled; free item
 * gifts move no coins. Adjustments split by sign at runtime.
 */
const KIND_SOURCE: Record<
  CoinLedgerKind,
  EconomySource | "adjustment" | undefined
> = {
  placement: "placements",
  entry: "entries",
  "poll-vote": "votes",
  "peoples-choice-vote": "votes",
  prediction: "votes",
  "mini-task": "mini-tasks",
  "skill-perk": "skill-perks",
  adjustment: "adjustment",
  purchase: "shop",
  crate: "crates",
  skill: "skills",
  "gift-in": "gifts",
  "gift-out": undefined,
  "market-sale": "market",
  "market-buy": undefined,
  "bounty-won": "bounties",
  "bounty-paid": undefined,
  "item-gift": undefined,
  "coin-rush": "power-ups",
  "bounty-badge": "power-ups",
  "raffle-win": "raffle",
  raffle: undefined,
  rename: "shop",
  bundle: "shop",
  "gift-wrap-out": "shop",
  "gift-wrap-in": undefined,
};

const FLOW_ORDER: EconomyFlow[] = ["earned", "granted", "spent", "moved"];

export { ukWeekStart };

/**
 * The admin economy dashboard (spread into `createQueries`): where the
 * season's Clim Coin came from and went, the supply week by week, who holds
 * the most and how the shop is selling. Derived from every player's wallet,
 * so it always agrees with what players see.
 */
export function createEconomyQueries(data: CompetitionData, deps: EconomyDeps) {
  const { players, coins } = data;

  function getEconomyReport(now: number = Date.now()): EconomyReport {
    const wallets = players.map((player) => ({
      player,
      wallet: deps.getWallet(player.id, now),
    }));

    const sources = new Map<EconomySource, { amount: number; count: number }>();
    const weeks = new Map<string, { minted: number; burned: number }>();
    const add = (source: EconomySource, amount: number) => {
      const row = sources.get(source) ?? { amount: 0, count: 0 };
      sources.set(source, {
        amount: row.amount + amount,
        count: row.count + 1,
      });
    };
    for (const { wallet } of wallets) {
      for (const line of wallet.ledger) {
        const mapped = KIND_SOURCE[line.kind];
        if (!mapped || line.amount === 0) continue;
        const source: EconomySource =
          mapped === "adjustment"
            ? line.amount > 0
              ? "grants"
              : "deductions"
            : mapped;
        add(source, Math.abs(line.amount));
        const { flow } = SOURCE_INFO[source];
        if (flow === "moved") continue;
        const key = ukWeekStart(line.at);
        const week = weeks.get(key) ?? { minted: 0, burned: 0 };
        if (flow === "spent") week.burned += Math.abs(line.amount);
        else week.minted += line.amount;
        weeks.set(key, week);
      }
    }

    const sourceRows: EconomySourceRow[] = [...sources]
      .map(([source, { amount, count }]) => ({
        source,
        ...SOURCE_INFO[source],
        amount,
        count,
      }))
      .sort(
        (a, b) =>
          FLOW_ORDER.indexOf(a.flow) - FLOW_ORDER.indexOf(b.flow) ||
          b.amount - a.amount,
      );
    const total = (flows: EconomyFlow[]) =>
      sourceRows
        .filter((row) => flows.includes(row.flow))
        .reduce((sum, row) => sum + row.amount, 0);

    let running = 0;
    const weekRows: EconomyWeek[] = [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, { minted, burned }]) => {
        running += minted - burned;
        return { weekStart, minted, burned, circulating: running };
      });

    const holders: EconomyHolder[] = wallets
      .map(({ player, wallet }) => ({
        player,
        balance: wallet.balance,
        held: wallet.held,
      }))
      .sort(
        (a, b) =>
          b.balance + b.held - (a.balance + a.held) ||
          a.player.name.localeCompare(b.player.name),
      );

    // Shop sales: copies bought outright, not the zero-price ones eggs,
    // gifts, skill nodes and resales hand out.
    const freeCopies = new Set([
      ...coins.crateOpens.map((o) => o.purchaseId),
      ...coins.itemGifts.map((g) => g.purchaseId),
      ...coins.skillUnlocks.flatMap((u) => u.purchaseId ?? []),
      ...coins.market.sales.map((s) => s.buyerPurchaseId),
    ]);
    // Gift-wrapped copies were bought from the shop by the sender, at the
    // price on their wrap; bundle copies count as sold (the bundle's price
    // isn't split between its items).
    const wrappedPrice = new Map(
      coins.wrappedGifts.map((g) => [g.purchaseId, g.price]),
    );
    const sales = new Map<string, { sold: number; revenue: number }>();
    for (const purchase of coins.purchases) {
      if (freeCopies.has(purchase.id)) continue;
      const row = sales.get(purchase.itemId) ?? { sold: 0, revenue: 0 };
      sales.set(purchase.itemId, {
        sold: row.sold + 1,
        revenue:
          row.revenue + (wrappedPrice.get(purchase.id) ?? purchase.price),
      });
    }
    const shop: EconomyShopRow[] = coins.items
      .filter((item) => !item.crateOnly && !item.skillOnly)
      .map((item) => {
        const { sold, revenue } = sales.get(item.id) ?? {
          sold: 0,
          revenue: 0,
        };
        return {
          item,
          sold,
          revenue,
          ...(item.stock !== undefined && {
            stockLeft: Math.max(item.stock - sold, 0),
          }),
          onSale: isOnSale(item, now),
        };
      })
      .filter((row) => row.sold > 0 || row.onSale)
      .sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.sold - a.sold ||
          a.item.name.localeCompare(b.item.name),
      );

    const crateSales = new Map<string, EconomyCrateRow>();
    for (const open of coins.crateOpens) {
      const row = crateSales.get(open.crateId) ?? {
        crateId: open.crateId,
        name: getCrate(open.crateId)?.name ?? open.crateId,
        opened: 0,
        revenue: 0,
      };
      row.opened += 1;
      row.revenue += open.price;
      crateSales.set(open.crateId, row);
    }

    return {
      circulating: holders.reduce((sum, h) => sum + h.balance + h.held, 0),
      held: holders.reduce((sum, h) => sum + h.held, 0),
      minted: total(["earned", "granted"]),
      burned: total(["spent"]),
      moved: total(["moved"]),
      sources: sourceRows,
      weeks: weekRows,
      holders: holders.slice(0, ECONOMY_TOP_HOLDERS),
      shop,
      crates: [...crateSales.values()].sort((a, b) => b.revenue - a.revenue),
    };
  }

  return { getEconomyReport };
}
