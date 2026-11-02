import type { Bounty, BountyClaim, BountyData, BountyStatus } from "../types";
import type {
  bounties as bountiesTable,
  bountyClaims as bountyClaimsTable,
} from "../db/schema";
import { timestamptzToIso } from "../lib/time";
import { BOUNTY_MS } from "./coin-rules";

// Pure mappers and derivations for bounties. Like marketplace offers, an
// open bounty's reward is held from its poster's wallet until it's awarded,
// cancelled or lapses (by age, derived here, so nothing runs when it does).

type BountyRow = typeof bountiesTable.$inferSelect;
type BountyClaimRow = typeof bountyClaimsTable.$inferSelect;

export function mapBounties(
  bountyRows: BountyRow[],
  claimRows: BountyClaimRow[],
): BountyData {
  return {
    bounties: [...bountyRows]
      .sort((a, b) => a.id - b.id)
      .map(
        (row): Bounty => ({
          id: row.id,
          posterId: row.posterId,
          title: row.title,
          ...(row.details && { details: row.details }),
          reward: row.reward,
          status: row.status,
          ...(row.winnerId && { winnerId: row.winnerId }),
          ...(row.resolvedByName && { resolvedByName: row.resolvedByName }),
          at: timestamptzToIso(row.createdAt),
          ...(row.closedAt && { closedAt: timestamptzToIso(row.closedAt) }),
        }),
      ),
    claims: [...claimRows]
      .sort((a, b) => a.id - b.id)
      .map(
        (row): BountyClaim => ({
          id: row.id,
          bountyId: row.bountyId,
          playerId: row.playerId,
          ...(row.note && { note: row.note }),
          at: timestamptzToIso(row.createdAt),
        }),
      ),
  };
}

/** When an open bounty lapses if nobody wins it. */
export function bountyExpiry(bounty: Pick<Bounty, "at">): number {
  return new Date(bounty.at).getTime() + BOUNTY_MS;
}

/** A bounty's state at `now`: an open one past its expiry has lapsed. */
export function bountyStatus(
  bounty: Pick<Bounty, "at" | "status">,
  now: number,
): BountyStatus {
  return bounty.status === "open" && now >= bountyExpiry(bounty)
    ? "expired"
    : bounty.status;
}

/** Open, unexpired bounties: the ones holding their poster's coins. */
export function liveBounties(data: BountyData, now: number): Bounty[] {
  return data.bounties.filter((b) => bountyStatus(b, now) === "open");
}

/** The coins a player's open bounties hold. */
export function bountyHeldCoins(
  data: BountyData,
  playerId: string,
  now: number,
): number {
  return liveBounties(data, now)
    .filter((b) => b.posterId === playerId)
    .reduce((sum, b) => sum + b.reward, 0);
}
