import type { BountyOutcome } from "../types";
import type { BountyAction } from "../lib/account-forms";
import { createQueries } from "./queries";
import { loadFreshPlayerCompetition } from "./competition";
import {
  awardBounty,
  cancelBounty,
  claimBounty,
  postBounty,
  unclaimBounty,
} from "./bounties";

export interface BountyResult {
  outcome: BountyOutcome;
  /** The bounty the action was about, to send the player back to. */
  bountyId?: number;
}

/**
 * Carries out a bounty action for a signed-in player and says how it went.
 * Everything is checked against fresh rows (the edge-cached ones may be a
 * few minutes old), then re-checked by the write itself.
 */
export async function runBountyAction(
  playerId: string,
  action: BountyAction,
): Promise<BountyResult> {
  const fresh = await loadFreshPlayerCompetition(playerId);
  if (!fresh) return { outcome: "invalid" };
  if (!fresh.features.bounties) return { outcome: "disabled" };
  if (fresh.season.status === "closed") return { outcome: "season-closed" };
  const q = createQueries(fresh);
  const now = Date.now();

  if (action.intent === "post") {
    const panel = q.getBountyPostPanel(playerId, now);
    if (panel.blocked) {
      return { outcome: panel.blocked === "guest" ? "invalid" : panel.blocked };
    }
    if (action.reward > (panel.available ?? 0)) {
      return { outcome: "unaffordable" };
    }
    const id = await postBounty(
      playerId,
      {
        title: action.title,
        reward: action.reward,
        ...(action.details && { details: action.details }),
      },
      q.getWallet(playerId, now).earned,
    );
    return id === undefined
      ? { outcome: "invalid" }
      : { outcome: "posted", bountyId: id };
  }

  const bountyId = action.bountyId;
  const detail = q.getBounty(bountyId, playerId, now);
  if (!detail) return { outcome: "invalid" };
  if (detail.view.status !== "open") return { outcome: "closed", bountyId };

  switch (action.intent) {
    case "cancel": {
      if (!detail.isPoster) return { outcome: "invalid", bountyId };
      if (!detail.canCancel) return { outcome: "has-claims", bountyId };
      const done = await cancelBounty(bountyId, { posterId: playerId });
      return { outcome: done ? "cancelled" : "has-claims", bountyId };
    }
    case "claim": {
      if (detail.claimBlocked) {
        return {
          outcome:
            detail.claimBlocked === "guest" ? "invalid" : detail.claimBlocked,
          bountyId,
        };
      }
      const done = await claimBounty(bountyId, playerId, action.note);
      return { outcome: done ? "claimed" : "invalid", bountyId };
    }
    case "unclaim": {
      const done = await unclaimBounty(bountyId, playerId);
      return { outcome: done ? "unclaimed" : "invalid", bountyId };
    }
    case "award": {
      if (!detail.isPoster || !detail.canAward) {
        return { outcome: "invalid", bountyId };
      }
      if (!detail.view.claims.some((c) => c.player.id === action.winnerId)) {
        return { outcome: "invalid", bountyId };
      }
      const done = await awardBounty(bountyId, action.winnerId, {
        posterId: playerId,
      });
      return { outcome: done ? "awarded" : "invalid", bountyId };
    }
  }
}
