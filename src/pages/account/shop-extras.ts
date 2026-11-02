import type { APIRoute } from "astro";
import type { BundleBlock, CoinOutcome, ShopTab } from "../../types";
import { loadFreshPlayerCompetition } from "../../data/competition";
import { createQueries } from "../../data/queries";
import {
  buyBundle,
  buyRaffleTickets,
  buyRenameToken,
  renamePet,
  wrapGift,
} from "../../data/shop";
import {
  parseShopExtraAction,
  type ShopExtraAction,
} from "../../lib/account-forms";
import { shopHref } from "../../lib/coin-ui";
import { withBase } from "../../lib/url";

// The shop's extras: raffle tickets, rename tokens (and renaming a pet),
// gift wrap and bundles. Living under `/account` means the middleware has
// already required a signed-in player and purges the cached rows after;
// Astro's origin check rejects cross-site posts. Each is checked against
// fresh rows, then re-checked by the write itself.

/** Where each action's result shows: its tab, and the panel on it. */
const LANDING: Record<ShopExtraAction["intent"], [ShopTab, string]> = {
  raffle: ["extras", "raffle"],
  token: ["extras", "rename"],
  rename: ["extras", "rename"],
  wrap: ["extras", "gift-wrap"],
  bundle: ["featured", "bundles"],
};

const BUNDLE_OUTCOME: Record<BundleBlock, CoinOutcome> = {
  guest: "invalid",
  owned: "owned",
  unavailable: "unavailable",
  "sold-out": "sold-out",
  unaffordable: "unaffordable",
  "season-closed": "season-closed",
};

export const GET: APIRoute = ({ redirect }) => redirect(shopHref("extras"));

export const POST: APIRoute = async ({ locals, redirect, request }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const action = parseShopExtraAction(await request.formData());
  const [tab, hash]: [ShopTab, string | undefined] = action
    ? LANDING[action.intent]
    : ["extras", undefined];
  const reply = (outcome: CoinOutcome) =>
    redirect(shopHref(tab, { coins: outcome }, hash), 303);
  if (!action) return reply("invalid");

  const data = await loadFreshPlayerCompetition(player.playerId);
  if (!data) return reply("invalid");
  const queries = createQueries(data);
  const { playerId } = player;
  if (data.season.status === "closed") return reply("season-closed");
  const earned = () => queries.getWallet(playerId).earned;

  switch (action.intent) {
    case "raffle": {
      if (!data.features.shop_raffle) return reply("disabled");
      const panel = queries.getRafflePanel({ playerId });
      if (!panel.task || panel.task.id !== action.taskId) {
        return reply("raffle-closed");
      }
      if (panel.blocked === "limit" || action.count > panel.maxTickets) {
        return reply("raffle-limit");
      }
      if (panel.blocked) return reply("unaffordable");
      if (action.count > panel.canBuy) {
        return reply(
          panel.myTickets + action.count > panel.maxTickets
            ? "raffle-limit"
            : "unaffordable",
        );
      }
      const bought = await buyRaffleTickets(
        playerId,
        action.taskId,
        action.count,
        earned(),
      );
      return reply(bought > 0 ? "tickets-bought" : "raffle-closed");
    }
    case "token": {
      const panel = queries.getRenamePanel({ playerId });
      if (panel.blocked) return reply("unaffordable");
      return reply(
        (await buyRenameToken(playerId, earned()))
          ? "token-bought"
          : "unaffordable",
      );
    }
    case "rename": {
      const panel = queries.getRenamePanel({ playerId });
      if (panel.tokens === 0) return reply("no-token");
      if (!panel.pets.some((pet) => pet.item.id === action.itemId)) {
        return reply("invalid");
      }
      return reply(
        (await renamePet(playerId, action.itemId, action.name))
          ? "renamed"
          : "no-token",
      );
    }
    case "wrap": {
      const item = queries.getShopItemById(action.itemId);
      if (!item) return reply("unavailable");
      const blocked = queries.getGiftWrapBlock(
        playerId,
        action.toPlayerId,
        item,
      );
      if (blocked) return reply(blocked);
      const wrapped = await wrapGift(
        playerId,
        action.toPlayerId,
        item.id,
        queries.getItemPrice(item, playerId),
        action.anonymous,
        action.message,
        earned(),
      );
      return reply(wrapped ? "wrapped" : "unaffordable");
    }
    case "bundle": {
      if (!data.features.shop_bundles) return reply("disabled");
      const bundle = queries.getShopBundleById(action.bundleId);
      if (!bundle) return reply("unavailable");
      const blocked = queries.getBundleBlock(bundle, { playerId });
      if (blocked) return reply(BUNDLE_OUTCOME[blocked]);
      return reply(
        (await buyBundle(playerId, bundle.id, earned()))
          ? "bundle-bought"
          : "unaffordable",
      );
    }
  }
};
