import type { APIRoute } from "astro";
import type { CoinOutcome, PurchaseBlock, ShopTab } from "../../../types";
import { loadFreshPlayerCompetition } from "../../../data/competition";
import { createQueries } from "../../../data/queries";
import { buyItem } from "../../../data/shop";
import { withBase } from "../../../lib/url";
import { parseShopTab, shopHref, shopTabOf } from "../../../lib/coin-ui";

// Buying from `/shop`. Living under `/account` means the middleware has
// already required a signed-in player (with a changed temporary password)
// and purges the cached rows after; Astro's origin check rejects cross-site
// posts. The balance is checked against fresh rows, then re-checked by the
// write itself.

const BLOCK_OUTCOME: Record<PurchaseBlock, CoinOutcome> = {
  guest: "invalid",
  owned: "owned",
  used: "owned",
  "crate-only": "unavailable",
  "skill-only": "unavailable",
  unaffordable: "unaffordable",
  unavailable: "unavailable",
  "sold-out": "sold-out",
  "season-closed": "season-closed",
};

// Back to the tab the item was bought from (the featured tab's deal posts
// `tab=featured`), else the tab it's shelved on.
const backToShop = (
  itemId: string,
  tab: ShopTab | undefined,
  outcome?: CoinOutcome,
) =>
  shopHref(
    tab,
    outcome ? { coins: outcome } : {},
    `${tab === "featured" ? "deal" : "item"}-${encodeURIComponent(itemId)}`,
  );

// Signing in from the shop lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToShop(params.itemId ?? "", undefined));

export const POST: APIRoute = async ({ params, locals, redirect, request }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const itemId = params.itemId ?? "";
  const form = await request.formData().catch(() => undefined);
  const from = parseShopTab(form?.get("tab")?.toString());

  const data = await loadFreshPlayerCompetition(player.playerId);
  const queries = data && createQueries(data);
  const item = queries?.getShopItemById(itemId);
  const tab = from ?? (item ? shopTabOf(item) : undefined);
  const reply = (outcome: CoinOutcome) =>
    redirect(backToShop(itemId, tab, outcome), 303);
  if (!queries) return reply("invalid");
  if (!item) return reply("unavailable");
  const { getPurchaseBlock, getWallet, getItemPrice } = queries;
  const blocked = getPurchaseBlock(item, { playerId: player.playerId });
  if (blocked) return reply(BLOCK_OUTCOME[blocked]);

  const bought = await buyItem(
    player.playerId,
    item.id,
    getWallet(player.playerId).earned,
    item.price - getItemPrice(item, player.playerId),
  );
  if (bought) return reply("bought");
  // Someone else may have bought the last one since the check above.
  const fresh = await loadFreshPlayerCompetition(player.playerId);
  const recheck = fresh && createQueries(fresh);
  const freshItem = recheck?.getShopItemById(itemId);
  const soldOut = freshItem && recheck?.getStockLeft(freshItem) === 0;
  return reply(soldOut ? "sold-out" : "unaffordable");
};
