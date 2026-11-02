import { and, eq, type SQL, sql } from "drizzle-orm";
import type {
  ActivePowerUpKind,
  CoinOutcome,
  CopyablePowerUpKind,
  Crate,
  CrateTierKind,
  LoadoutSlot,
} from "../types";
import { getDb } from "../db";
import {
  bounties,
  bundlePurchases,
  coinAdjustments,
  coinGifts,
  coinPurchases,
  crateOpens,
  eggGifts,
  equippedItems,
  itemGifts,
  marketListings,
  marketOffers,
  marketSales,
  players,
  powerUpUses,
  raffleTickets,
  renameTokens,
  shopBundleItems,
  shopBundles,
  shopItems,
  skillUnlocks,
  tasks,
  wishes,
  wrappedGifts,
} from "../db/schema";
import { violatedConstraint } from "./db-errors";
import {
  BOUNTY_DAYS,
  GIFT_WEEKLY_CAP,
  GIFT_WRAP_FEE,
  MARKET_LISTING_DAYS,
  RAFFLE_MAX_TICKETS,
  RAFFLE_TICKET_PRICE,
  RENAME_TOKEN_PRICE,
} from "./coin-rules";

// Clim Coin writes a player makes from `/account` (the middleware has
// already required a signed-in player and purges the cached rows after).
// Callers check the rules against the snapshot first; each write re-checks
// the stored facts so a double-submit or a race can't overspend or cheat.

/** Whether `listing` (a `market_listings` alias) is open and unexpired. */
export const listingLive = (listing: string) =>
  sql.raw(`(${listing}.status = 'open'
    and ${listing}.created_at > now() - interval '${MARKET_LISTING_DAYS} days')`);

/** Whether `bounty` (a `bounties` alias) is open and unexpired. */
export const bountyLive = (bounty: string) =>
  sql.raw(`(${bounty}.status = 'open'
    and ${bounty}.created_at > now() - interval '${BOUNTY_DAYS} days')`);

/**
 * Whether `purchase` (a `coin_purchases` alias) is a copy its player still
 * holds and can use: not sold on the marketplace, and not on sale there.
 */
export const heldCopy = (purchase: string) => sql`(
  not exists (
    select 1 from ${marketSales} sold
    where sold.source_purchase_id = ${sql.raw(purchase)}.id
  )
  and not exists (
    select 1 from ${marketListings} listed
    where listed.purchase_id = ${sql.raw(purchase)}.id
      and ${listingLive("listed")}
  ))`;

/**
 * The coins a player's pending marketplace offers hold (offers on closed
 * or lapsed listings don't), leaving out their offer on `exceptListingId`.
 */
const heldByOffers = (playerId: string, exceptListingId?: number) => sql`
  coalesce((select sum(o.amount) from ${marketOffers} o
    join ${marketListings} l on l.id = o.listing_id
    where o.buyer_id = ${playerId}
      and o.status = 'pending'
      and ${listingLive("l")}
      ${exceptListingId === undefined ? sql`` : sql`and o.listing_id <> ${exceptListingId}`}), 0)`;

/** The coins a player's open bounties hold. */
const heldByBounties = (playerId: string) => sql`
  coalesce((select sum(b.reward) from ${bounties} b
    where b.poster_id = ${playerId} and ${bountyLive("b")}), 0)`;

/**
 * The coins a player has left to spend, given their derived `earned`.
 * Pending marketplace offers hold coins, except one on `exceptListingId`
 * (the listing being paid for), and so do their open bounties.
 */
export const budget = (
  playerId: string,
  earned: number,
  exceptListingId?: number,
) => sql`
  ${earned}::integer
    + coalesce((select sum(amount) from ${coinAdjustments}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${coinPurchases}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${crateOpens}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${skillUnlocks}
        where player_id = ${playerId}), 0)
    + coalesce((select sum(amount) from ${coinGifts}
        where to_player_id = ${playerId}), 0)
    - coalesce((select sum(amount) from ${coinGifts}
        where from_player_id = ${playerId}), 0)
    + coalesce((select sum(price) from ${marketSales}
        where seller_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${marketSales}
        where buyer_id = ${playerId}), 0)
    + coalesce((select sum(reward) from ${bounties}
        where winner_id = ${playerId} and status = 'awarded'), 0)
    - coalesce((select sum(reward) from ${bounties}
        where poster_id = ${playerId} and status = 'awarded'), 0)
    - coalesce((select sum(price) from ${raffleTickets}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${renameTokens}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price + fee) from ${wrappedGifts}
        where from_player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${bundlePurchases}
        where player_id = ${playerId}), 0)
    - ${heldByOffers(playerId, exceptListingId)}
    - ${heldByBounties(playerId)}`;

/**
 * Whether `item` (a `shop_items` alias) is in its sale window now. Windows
 * are UK wall-clock times, so compare against the UK wall clock.
 */
const onSaleNow = (item: string) =>
  sql.raw(`
  (${item}.available_from is null
    or ${item}.available_from <= (now() at time zone 'Europe/London'))
  and (${item}.available_until is null
    or ${item}.available_until > (now() at time zone 'Europe/London'))`);

/**
 * Serialises a player's spending, so two at once can't both spend. Admin
 * item gifts take it too, so a gift and a purchase can't both give the item.
 */
export const lockWallet = (playerId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`clim-coin:${playerId}`}))`;

/**
 * Serialises shop purchases of one item, so two players can't both buy its
 * last copy. Always taken after the buyer's wallet lock.
 */
const lockStock = (itemId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`shop-stock:${itemId}`}))`;

/**
 * How many copies of `item` (a `shop_items` alias) the shop has sold in
 * `playerId`'s season. Zero-price copies from eggs, admin gifts, skill nodes
 * and marketplace resales aren't shop sales, so they don't use up stock.
 */
const shopSoldThisSeason = (playerId: string) => sql`(
  select count(*) from ${coinPurchases} sale
  join ${players} buyer on buyer.id = sale.player_id
  where sale.item_id = item.id
    and buyer.season_id = (
      select season_id from ${players} where id = ${playerId})
    and not exists (select 1 from ${crateOpens} c
      where c.purchase_id = sale.id)
    and not exists (select 1 from ${itemGifts} g
      where g.purchase_id = sale.id)
    and not exists (select 1 from ${skillUnlocks} s
      where s.purchase_id = sale.id)
    and not exists (select 1 from ${marketSales} m
      where m.buyer_purchase_id = sale.id))`;

/**
 * Buys `itemId` at its current price, less `discount` (the player's skill
 * tree discount, worked out by the caller from fresh rows), if the player
 * can afford it and hasn't bought it before. Skill tree rewards are never
 * sold. A power-up can be bought once a season (wallets are per
 * season), checked by its effect so a second item with the same effect
 * can't get round it. `earned` is the player's
 * derived earnings, worked out from fresh rows. Spending and grants are
 * summed in the same transaction, under a per-player lock, so two buys at
 * once can't both spend the same coins. A limited-stock item is re-counted
 * under a per-item lock too, so it can't oversell.
 */
export async function buyItem(
  playerId: string,
  itemId: string,
  earned: number,
  discount = 0,
): Promise<boolean> {
  const db = getDb();
  const price = sql`greatest(item.price - ${discount}::integer, 0)`;
  const [, , inserted] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(lockStock(itemId)),
    db.execute(sql`
      insert into ${coinPurchases} (player_id, item_id, price)
      select ${playerId}, item.id, ${price}
      from ${shopItems} item
      where item.id = ${itemId}
        and item.available
        and ${onSaleNow("item")}
        and not item.crate_only
        and not item.skill_only
        and not exists (
          select 1 from ${coinPurchases} owned
          join ${shopItems} owned_item on owned_item.id = owned.item_id
          where owned.player_id = ${playerId}
            and (
              owned.item_id = item.id
              or owned_item.power_up = item.power_up
            )
        )
        and (${budget(playerId, earned)}) >= ${price}
        and (item.stock is null or item.stock > ${shopSoldThisSeason(playerId)})
      returning id`),
  ]);
  return inserted.rows.length > 0;
}

/** Whether `item` (a `shop_items` alias) is a power-up `playerId` has had. */
const ownsItemOrEffect = (playerId: string | SQL) => sql`exists (
  select 1 from ${coinPurchases} owned
  join ${shopItems} owned_item on owned_item.id = owned.item_id
  where owned.player_id = ${playerId}
    and (
      owned.item_id = item.id
      or owned_item.power_up = item.power_up
    ))`;

/**
 * Buys `itemId` for another player in the same season (gift wrap), at
 * `price` (what the sender would pay, worked out by the caller) plus the
 * wrap fee. The recipient owns it through a zero-price purchase written in
 * the same statement, as long as they've never had it; power-ups can't be
 * wrapped. Checked under the sender's wallet lock, and the item's stock
 * lock (a wrapped copy is a shop sale).
 */
export async function wrapGift(
  fromPlayerId: string,
  toPlayerId: string,
  itemId: string,
  price: number,
  anonymous: boolean,
  message: string | null,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const cost = price + GIFT_WRAP_FEE;
  const [, , wrapped] = await db.batch([
    db.execute(lockWallet(fromPlayerId)),
    db.execute(lockStock(itemId)),
    db.execute(sql`
      with eligible as (
        select item.id, sender.season_id
        from ${shopItems} item
        join ${players} sender on sender.id = ${fromPlayerId}
        join ${players} recipient
          on recipient.id = ${toPlayerId}
          and recipient.season_id = sender.season_id
        where item.id = ${itemId}
          and recipient.id <> sender.id
          and item.category <> 'power_up'
          and item.available
          and ${onSaleNow("item")}
          and not item.crate_only
          and not item.skill_only
          and not ${ownsItemOrEffect(toPlayerId)}
          and (item.stock is null
            or item.stock > ${shopSoldThisSeason(toPlayerId)})
          and (${budget(fromPlayerId, earned)}) >= ${cost}::integer
      ),
      given as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select ${toPlayerId}, id, 0 from eligible
        returning id, item_id
      )
      insert into ${wrappedGifts}
        (season_id, from_player_id, to_player_id, item_id, purchase_id,
          price, fee, anonymous, message)
      select eligible.season_id, ${fromPlayerId}, ${toPlayerId}, given.item_id,
        given.id, ${price}::integer, ${GIFT_WRAP_FEE}::integer,
        ${anonymous}, ${message}::text
      from given cross join eligible
      returning id`),
  ]);
  return wrapped.rows.length > 0;
}

/**
 * Buys `bundleId` for the player at its price: one zero-price purchase per
 * item, pointing back at the bundle purchase, all in one statement under
 * the wallet lock. Refused if the bundle or any item is off sale, any item
 * is out of stock, or the player has had any item (or a power-up's effect).
 */
export async function buyBundle(
  playerId: string,
  bundleId: string,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const [, , bought] = await db.batch([
    db.execute(lockWallet(playerId)),
    // Each item's stock lock, in a fixed order so two bundles can't deadlock.
    db.execute(sql`
      select pg_advisory_xact_lock(hashtext('shop-stock:' || item_id))
      from (select item_id from ${shopBundleItems}
        where bundle_id = ${bundleId} order by item_id) locked`),
    db.execute(sql`
      with bundle as (
        select b.id, b.price from ${shopBundles} b
        where b.id = ${bundleId}
          and b.available
          and exists (select 1 from ${shopBundleItems} bi
            where bi.bundle_id = b.id)
          and not exists (
            select 1 from ${shopBundleItems} bi
            join ${shopItems} item on item.id = bi.item_id
            where bi.bundle_id = b.id
              and (not item.available
                or not (${onSaleNow("item")})
                or item.crate_only
                or item.skill_only
                or ${ownsItemOrEffect(playerId)}
                or (item.stock is not null
                  and item.stock <= ${shopSoldThisSeason(playerId)}))
          )
          and (${budget(playerId, earned)}) >= b.price
      ),
      bought as (
        insert into ${bundlePurchases} (player_id, bundle_id, price)
        select ${playerId}, id, price from bundle
        returning id, bundle_id
      )
      insert into ${coinPurchases} (player_id, item_id, price, bundle_purchase_id)
      select ${playerId}, bi.item_id, 0, bought.id
      from bought
      join ${shopBundleItems} bi on bi.bundle_id = bought.bundle_id
      returning id`),
  ]);
  return bought.rows.length > 0;
}

/**
 * Buys `count` raffle tickets for the live week `taskId`, if the week is
 * still open (released, deadline not yet passed, UK wall clock), it keeps
 * the player within the weekly limit, and they can afford them. Checked
 * under the wallet lock. Returns how many were bought (0 or `count`).
 */
export async function buyRaffleTickets(
  playerId: string,
  taskId: string,
  count: number,
  earned: number,
): Promise<number> {
  const db = getDb();
  const [, bought] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      insert into ${raffleTickets} (task_id, player_id, price)
      select week.id, buyer.id, ${RAFFLE_TICKET_PRICE}::integer
      from ${tasks} week
      join ${players} buyer
        on buyer.id = ${playerId} and buyer.season_id = week.season_id
      cross join generate_series(1, ${count}::integer)
      where week.id = ${taskId}
        and week.release_date <= (now() at time zone 'Europe/London')
        and week.deadline > (now() at time zone 'Europe/London')
        and ${count}::integer between 1 and ${RAFFLE_MAX_TICKETS}::integer
        and ${count}::integer + (select count(*) from ${raffleTickets} mine
            where mine.player_id = ${playerId} and mine.task_id = week.id)
          <= ${RAFFLE_MAX_TICKETS}::integer
        and (${budget(playerId, earned)})
          >= ${count}::integer * ${RAFFLE_TICKET_PRICE}::integer
      returning id`),
  ]);
  return bought.rows.length;
}

/** Buys one rename token, if the player can afford it (wallet lock). */
export async function buyRenameToken(
  playerId: string,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const [, bought] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      insert into ${renameTokens} (player_id, price)
      select ${playerId}, ${RENAME_TOKEN_PRICE}::integer
      where (${budget(playerId, earned)}) >= ${RENAME_TOKEN_PRICE}::integer
      returning id`),
  ]);
  return bought.rows.length > 0;
}

/**
 * Spends the player's oldest unspent rename token naming their pet
 * `itemId` (a pet they hold now). Returns whether it was renamed.
 */
export async function renamePet(
  playerId: string,
  itemId: string,
  name: string,
): Promise<boolean> {
  const db = getDb();
  const [, renamed] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      update ${renameTokens} set item_id = ${itemId}, name = ${name},
        used_at = now()
      where id = (
        select token.id from ${renameTokens} token
        where token.player_id = ${playerId} and token.used_at is null
        order by token.id
        limit 1
      )
      and exists (
        select 1 from ${coinPurchases} owned
        join ${shopItems} pet on pet.id = owned.item_id
        where owned.player_id = ${playerId}
          and owned.item_id = ${itemId}
          and pet.category = 'pet'
          and ${heldCopy("owned")}
      )
      returning id`),
  ]);
  return renamed.rows.length > 0;
}

/**
 * Opens `crate` for the player, giving them `itemId` (rolled by the caller
 * from their personal odds): the item is owned through a zero-price
 * purchase and the crate's price (as the caller passes it, after any skill
 * tree discount) is spent, in one statement under the
 * wallet lock. A power-up won this way is that effect's one charge for the
 * season, exactly as if bought. Returns the opening's id, or `undefined` if
 * they can no longer afford it or already own the item (or, for a power-up,
 * its effect), e.g. a double-submit won it first, so the caller can roll
 * again.
 */
export async function openCrate(
  playerId: string,
  crate: Crate,
  itemId: string,
  rarity: CrateTierKind,
  earned: number,
): Promise<number | undefined> {
  const db = getDb();
  const [, opened] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      with won as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select ${playerId}, item.id, 0
        from ${shopItems} item
        where item.id = ${itemId}
          and item.available
          and not item.skill_only
          and ${onSaleNow("item")}
          and not exists (
            select 1 from ${coinPurchases} owned
            join ${shopItems} owned_item on owned_item.id = owned.item_id
            where owned.player_id = ${playerId}
              and (
                owned.item_id = item.id
                or owned_item.power_up = item.power_up
              )
          )
          and (${budget(playerId, earned)}) >= ${crate.price}
        returning id, item_id
      )
      insert into ${crateOpens}
        (player_id, crate_id, price, item_id, rarity, purchase_id)
      select ${playerId}, ${crate.id}, ${crate.price}, won.item_id,
        ${rarity}, won.id
      from won
      returning id`),
  ]);
  const id = (opened.rows[0] as { id?: number } | undefined)?.id;
  return typeof id === "number" ? id : undefined;
}

/**
 * Cracks an egg an admin gifted the player (`giftId`), giving them `itemId`
 * (rolled by the caller from their personal odds). Like `openCrate`, but
 * free: the item is owned through a zero-price purchase, a zero-price
 * `crate_opens` row records it and the gift is marked opened, in one
 * statement under the wallet lock. Returns the opening's id, or `undefined`
 * if the gift isn't theirs, is already open, or they already own the item
 * (or its power-up effect), so the caller can roll again.
 */
export async function openGiftedEgg(
  playerId: string,
  giftId: number,
  itemId: string,
  rarity: CrateTierKind,
): Promise<number | undefined> {
  const db = getDb();
  const [, opened] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      with gift as (
        select id, crate_id from ${eggGifts}
        where id = ${giftId}
          and player_id = ${playerId}
          and crate_open_id is null
      ),
      won as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select ${playerId}, item.id, 0
        from ${shopItems} item
        where item.id = ${itemId}
          and exists (select 1 from gift)
          and item.available
          and not item.skill_only
          and ${onSaleNow("item")}
          and not exists (
            select 1 from ${coinPurchases} owned
            join ${shopItems} owned_item on owned_item.id = owned.item_id
            where owned.player_id = ${playerId}
              and (
                owned.item_id = item.id
                or owned_item.power_up = item.power_up
              )
          )
        returning id, item_id
      ),
      hatched as (
        insert into ${crateOpens}
          (player_id, crate_id, price, item_id, rarity, purchase_id)
        select ${playerId}, gift.crate_id, 0, won.item_id, ${rarity}, won.id
        from won cross join gift
        returning id
      )
      update ${eggGifts} set crate_open_id = hatched.id
      from hatched
      where ${eggGifts}.id = ${giftId}
      returning hatched.id`),
  ]);
  const id = (opened.rows[0] as { id?: number } | undefined)?.id;
  return typeof id === "number" ? id : undefined;
}

/**
 * Sends `amount` coins from one player to another in the same season, if
 * the sender can afford it and it keeps them within their weekly gift
 * `cap` (gifts sent in the last 7 days count; skill trees can raise it). `earned` is the sender's derived
 * earnings from fresh rows. Checked under the sender's wallet lock, so two
 * gifts at once can't both spend the same coins or beat the cap.
 */
export async function sendGift(
  fromPlayerId: string,
  toPlayerId: string,
  amount: number,
  message: string | null,
  earned: number,
  cap: number = GIFT_WEEKLY_CAP,
): Promise<boolean> {
  const db = getDb();
  const [, inserted] = await db.batch([
    db.execute(lockWallet(fromPlayerId)),
    db.execute(sql`
      insert into ${coinGifts}
        (season_id, from_player_id, to_player_id, amount, message)
      select sender.season_id, sender.id, recipient.id, ${amount}::integer,
        ${message}::text
      from ${players} sender
      join ${players} recipient
        on recipient.season_id = sender.season_id
      where sender.id = ${fromPlayerId}
        and recipient.id = ${toPlayerId}
        and recipient.id <> sender.id
        and ${amount}::integer > 0
        and ${amount}::integer + coalesce((select sum(amount) from ${coinGifts}
            where from_player_id = ${fromPlayerId}
              and created_at > now() - interval '7 days'), 0)
          <= ${cap}::integer
        and (${budget(fromPlayerId, earned)}) >= ${amount}::integer
      returning id`),
  ]);
  return inserted.rows.length > 0;
}

/** Wears an owned item in `slot`, replacing whatever was there. */
export async function equipItem(
  playerId: string,
  slot: LoadoutSlot,
  itemId: string,
): Promise<boolean> {
  const inserted = await getDb().execute(sql`
    insert into ${equippedItems} (player_id, slot, item_id)
    select ${playerId}, ${slot}::loadout_slot, ${itemId}
    where exists (
      select 1 from ${coinPurchases} owned
      where owned.player_id = ${playerId}
        and owned.item_id = ${itemId}
        and ${heldCopy("owned")}
    )
    on conflict (player_id, slot)
      do update set item_id = excluded.item_id, updated_at = now()
    returning item_id`);
  return inserted.rows.length > 0;
}

export async function unequipSlot(
  playerId: string,
  slot: LoadoutSlot,
): Promise<void> {
  await getDb()
    .delete(equippedItems)
    .where(
      and(eq(equippedItems.playerId, playerId), eq(equippedItems.slot, slot)),
    );
}

/**
 * Spends the player's unused One Wish Willow charge on `wish`, for the
 * Taskmaster to grant or decline. The unique `purchase_id` stops a
 * double-submit spending one charge twice. Returns whether it was made.
 */
export async function makeWish(
  playerId: string,
  wish: string,
): Promise<boolean> {
  const inserted = await getDb().execute(sql`
    insert into ${wishes} (purchase_id, player_id, wish)
    select charge.id, ${playerId}, ${wish}
    from ${coinPurchases} charge
    join ${shopItems} item on item.id = charge.item_id
    where charge.player_id = ${playerId}
      and item.power_up = 'wish'
      and ${heldCopy("charge")}
      and not exists (
        select 1 from ${wishes} made where made.purchase_id = charge.id
      )
    order by charge.id
    limit 1
    on conflict (purchase_id) do nothing
    returning id`);
  return inserted.rows.length > 0;
}

const USE_CONSTRAINT_OUTCOMES: Record<string, CoinOutcome> = {
  power_up_uses_player_id_task_id_unique: "already-used",
  power_up_uses_player_id_effect_unique: "no-charge",
  power_up_uses_one_sabotage_per_target_idx: "already-sabotaged",
  power_up_uses_purchase_id_unique: "no-charge",
  power_up_uses_not_self: "invalid",
  power_up_uses_target_player_id_players_id_fk: "invalid",
  power_up_uses_target_when_targeted: "invalid",
  power_up_uses_copied_when_copycat: "invalid",
  power_up_uses_copied_active: "invalid",
};

/**
 * Serialises power-up uses on one week, so a Freeze and its target's own
 * power-up (or two Heists on one player) can't both slip through.
 */
const lockWeek = (taskId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`power-ups:${taskId}`}))`;

/** A `power_up_uses` alias's effect, a Copycat counting as what it copied. */
const appliedSql = (use: string) =>
  sql.raw(`coalesce(${use}.copied_effect, ${use}.effect)`);

/**
 * Spends the player's unused charge of `effect` on `taskId` (a Copycat
 * acting as `copiedEffect`). The caller has checked the week is live and
 * the target and copy valid; the constraints enforce one use of each
 * power-up per player a season, one power-up per player per week and one
 * Sabotage per target per week. Under a per-week lock the write also
 * re-checks that the player isn't frozen, that a Freeze's target hasn't
 * used a power-up yet, and that a Sabotage's or Heist's target hasn't
 * already been hit.
 */
export async function usePowerUp(
  playerId: string,
  taskId: string,
  effect: ActivePowerUpKind,
  copiedEffect: CopyablePowerUpKind | null,
  targetPlayerId: string | null,
): Promise<CoinOutcome> {
  const applied = copiedEffect ?? effect;
  const db = getDb();
  const frozen = sql`exists (
    select 1 from ${powerUpUses} f
    where f.task_id = ${taskId}
      and f.target_player_id = ${playerId}
      and ${appliedSql("f")} = 'freeze')`;
  const targetUsed = sql`exists (
    select 1 from ${powerUpUses} t
    where t.task_id = ${taskId} and t.player_id = ${targetPlayerId}::text)`;
  const targetHit = sql`exists (
    select 1 from ${powerUpUses} h
    where h.task_id = ${taskId}
      and h.target_player_id = ${targetPlayerId}::text
      and ${appliedSql("h")} in ('sabotage', 'heist'))`;
  try {
    const [, inserted, why] = await db.batch([
      db.execute(lockWeek(taskId)),
      db.execute(sql`
        insert into ${powerUpUses}
          (purchase_id, player_id, task_id, effect, copied_effect,
            target_player_id)
        select charge.id, ${playerId}, ${taskId}, ${effect}::power_up_kind,
          ${copiedEffect}::power_up_kind, ${targetPlayerId}::text
        from ${coinPurchases} charge
        join ${shopItems} item on item.id = charge.item_id
        where charge.player_id = ${playerId}
          and item.power_up = ${effect}::power_up_kind
          and ${heldCopy("charge")}
          and not exists (
            select 1 from ${powerUpUses} spent
            where spent.purchase_id = charge.id
          )
          and not ${frozen}
          ${applied === "freeze" ? sql`and not ${targetUsed}` : sql``}
          ${applied === "sabotage" || applied === "heist" ? sql`and not ${targetHit}` : sql``}
        order by charge.id
        limit 1
        returning id`),
      db.execute(sql`
        select ${frozen} as frozen, ${targetUsed} as target_used,
          ${targetHit} as target_hit`),
    ]);
    if (inserted.rows.length > 0) return "used";
    const reason = why.rows[0] as
      | { frozen?: boolean; target_used?: boolean; target_hit?: boolean }
      | undefined;
    if (reason?.frozen) return "frozen";
    if (applied === "freeze" && reason?.target_used) return "target-used";
    if ((applied === "sabotage" || applied === "heist") && reason?.target_hit) {
      return "already-sabotaged";
    }
    return "no-charge";
  } catch (error) {
    const outcome = USE_CONSTRAINT_OUTCOMES[violatedConstraint(error) ?? ""];
    if (outcome) return outcome;
    throw error;
  }
}
