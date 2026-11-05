import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { bounties, bountyClaims, players } from "../db/schema";
import { BOUNTY_OPEN_LIMIT } from "./coin-rules";
import { bountyLive, budget, lockWallet } from "./shop";

// Bounty writes a player makes from `/account/bounties` (the middleware has
// already required a signed-in player and purges the cached rows after),
// plus an admin's award or cancel from `/admin/market`. Callers check the
// rules against fresh rows first; each write re-checks the stored facts
// (under the poster's wallet lock where coins are involved), so a
// double-submit or a race can't overspend or pay out twice.

export interface BountyInput {
  title: string;
  details?: string;
  reward: number;
}

/**
 * Puts up a bounty for `posterId`, holding its reward from their wallet:
 * only if they can afford it with their other offers and bounties held,
 * and have fewer than `BOUNTY_OPEN_LIMIT` open. Returns its id, or
 * `undefined`.
 */
export async function postBounty(
  posterId: string,
  input: BountyInput,
  earned: number,
): Promise<number | undefined> {
  const db = getDb();
  const [, posted] = await db.batch([
    db.execute(lockWallet(posterId)),
    db.execute(sql`
      insert into ${bounties} (season_id, poster_id, title, details, reward)
      select poster.season_id, poster.id, ${input.title}::text,
        ${input.details ?? null}::text, ${input.reward}::integer
      from ${players} poster
      where poster.id = ${posterId}
        and (
          select count(*) from ${bounties} mine
          where mine.poster_id = ${posterId} and ${bountyLive("mine")}
        ) < ${BOUNTY_OPEN_LIMIT}
        and (${budget(posterId, earned)}) >= ${input.reward}::integer
      returning id`),
  ]);
  const id = (posted.rows[0] as { id?: number } | undefined)?.id;
  return typeof id === "number" ? id : undefined;
}

/**
 * Takes an open bounty down, freeing its reward. A poster can only cancel
 * their own, and only while nobody's claimed it; an admin (`adminName`) can
 * cancel any open one, and their name is kept on it.
 */
export async function cancelBounty(
  bountyId: number,
  by: { posterId: string } | { adminName: string },
): Promise<boolean> {
  const cancelled = await getDb().execute(sql`
    update ${bounties} b
    set status = 'cancelled', closed_at = now(),
      resolved_by_name = ${"adminName" in by ? by.adminName : null}::text
    where b.id = ${bountyId}
      and ${bountyLive("b")}
      ${
        "posterId" in by
          ? sql`and b.poster_id = ${by.posterId}
              and not exists (
                select 1 from ${bountyClaims} c where c.bounty_id = b.id)`
          : sql``
      }
    returning b.id`);
  return cancelled.rows.length > 0;
}

/**
 * Awards an open bounty to `winnerId`, who must have claimed it: its held
 * reward moves from the poster to them (derived). The poster awards their
 * own; an admin (`adminName`) can award any, and their name is kept on it.
 */
export async function awardBounty(
  bountyId: number,
  winnerId: string,
  by: { posterId: string } | { adminName: string },
): Promise<boolean> {
  const awarded = await getDb().execute(sql`
    update ${bounties} b
    set status = 'awarded', winner_id = ${winnerId}, closed_at = now(),
      resolved_by_name = ${"adminName" in by ? by.adminName : null}::text
    where b.id = ${bountyId}
      and ${bountyLive("b")}
      and b.poster_id <> ${winnerId}
      ${"posterId" in by ? sql`and b.poster_id = ${by.posterId}` : sql``}
      and exists (
        select 1 from ${bountyClaims} c
        where c.bounty_id = b.id and c.player_id = ${winnerId})
    returning b.id`);
  return awarded.rows.length > 0;
}

/**
 * Claims an open bounty for `playerId` (in its season, not its poster),
 * with an optional note. Claiming again updates the note.
 */
export async function claimBounty(
  bountyId: number,
  playerId: string,
  note?: string,
): Promise<boolean> {
  const claimed = await getDb().execute(sql`
    insert into ${bountyClaims} (bounty_id, player_id, note)
    select b.id, claimant.id, ${note ?? null}::text
    from ${bounties} b
    join ${players} claimant
      on claimant.id = ${playerId} and claimant.season_id = b.season_id
    where b.id = ${bountyId}
      and ${bountyLive("b")}
      and b.poster_id <> ${playerId}
    on conflict (bounty_id, player_id)
      do update set note = excluded.note
    returning id`);
  return claimed.rows.length > 0;
}

/** Withdraws a player's claim on a bounty that's still open. */
export async function unclaimBounty(
  bountyId: number,
  playerId: string,
): Promise<boolean> {
  const removed = await getDb().execute(sql`
    delete from ${bountyClaims} c
    using ${bounties} b
    where c.bounty_id = b.id
      and b.id = ${bountyId}
      and c.player_id = ${playerId}
      and ${bountyLive("b")}
    returning c.id`);
  return removed.rows.length > 0;
}
