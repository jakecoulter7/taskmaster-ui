import type {
  Bounty,
  BountyBoard,
  BountyClaimBlock,
  BountyDetail,
  BountyPostPanel,
  BountyView,
  CompetitionData,
  Wallet,
} from "../types";
import { BOUNTY_OPEN_LIMIT, BOUNTY_REWARD_RANGE } from "./coin-rules";
import { bountyExpiry, bountyStatus, liveBounties } from "./bounty-mappers";

interface BountyDeps {
  getWallet: (playerId: string, now?: number) => Wallet;
}

/**
 * Bounty selectors (spread into `createQueries`): the board, one bounty as
 * a viewer sees it and whether a player can post one. Pure over the
 * snapshot; the writes in `bounties.ts` re-check the stored facts.
 * Everything is gated on the `bounties` feature flag.
 */
export function createBountyQueries(data: CompetitionData, deps: BountyDeps) {
  const { players, coins, season, features } = data;
  const { bounties, claims } = coins.bounties;
  const enabled = features.bounties;
  const seasonClosed = season.status === "closed";
  const playerById = new Map(players.map((p) => [p.id, p]));
  const isPlayer = (id?: string): id is string =>
    id !== undefined && playerById.has(id);

  function toView(bounty: Bounty, now: number): BountyView | undefined {
    const poster = playerById.get(bounty.posterId);
    if (!poster) return undefined;
    const winner = bounty.winnerId
      ? playerById.get(bounty.winnerId)
      : undefined;
    return {
      bounty,
      status: bountyStatus(bounty, now),
      poster,
      ...(winner && { winner }),
      expiresAt: new Date(bountyExpiry(bounty)).toISOString(),
      claims: claims.flatMap((claim) => {
        const player = playerById.get(claim.playerId);
        return claim.bountyId === bounty.id && player
          ? [{ claim, player }]
          : [];
      }),
    };
  }

  const settledAt = (view: BountyView) =>
    view.bounty.closedAt
      ? new Date(view.bounty.closedAt).getTime()
      : bountyExpiry(view.bounty);

  /** Every bounty this season: open ones biggest first, then the rest. */
  function getBountyBoard(now: number = Date.now()): BountyBoard {
    const views = bounties.flatMap((b) => toView(b, now) ?? []);
    return {
      open: views
        .filter((v) => v.status === "open")
        .sort(
          (a, b) =>
            b.bounty.reward - a.bounty.reward || b.bounty.id - a.bounty.id,
        ),
      settled: views
        .filter((v) => v.status !== "open")
        .sort((a, b) => settledAt(b) - settledAt(a)),
    };
  }

  /** One bounty as `playerId` (signed in, or not) sees it. */
  function getBounty(
    id: number,
    playerId?: string,
    now: number = Date.now(),
  ): BountyDetail | undefined {
    const bounty = bounties.find((b) => b.id === id);
    const view = bounty && toView(bounty, now);
    if (!view) return undefined;
    const viewer = isPlayer(playerId) ? playerId : undefined;
    const isPoster = viewer === view.bounty.posterId;
    const open = view.status === "open";
    const claimBlocked: BountyClaimBlock | undefined = !viewer
      ? "guest"
      : !enabled
        ? "disabled"
        : seasonClosed
          ? "season-closed"
          : !open
            ? "closed"
            : isPoster
              ? "own-bounty"
              : undefined;
    const myClaim = view.claims.find((c) => c.player.id === viewer)?.claim;
    const canManage = enabled && !seasonClosed && open && isPoster;
    return {
      view,
      isPoster,
      ...(claimBlocked && { claimBlocked }),
      ...(myClaim && { myClaim }),
      canAward: canManage && view.claims.length > 0,
      canCancel: canManage && view.claims.length === 0,
    };
  }

  /** Whether `playerId` can put up a bounty now, and with how much. */
  function getBountyPostPanel(
    playerId?: string,
    now: number = Date.now(),
  ): BountyPostPanel {
    if (!isPlayer(playerId)) return { blocked: "guest", openCount: 0 };
    const openCount = liveBounties(coins.bounties, now).filter(
      (b) => b.posterId === playerId,
    ).length;
    const available = deps.getWallet(playerId, now).balance;
    const blocked = !enabled
      ? "disabled"
      : seasonClosed
        ? "season-closed"
        : openCount >= BOUNTY_OPEN_LIMIT
          ? "limit"
          : available < BOUNTY_REWARD_RANGE.min
            ? "unaffordable"
            : undefined;
    return { ...(blocked && { blocked }), available, openCount };
  }

  return {
    bountiesEnabled: enabled,
    getBountyBoard,
    getBounty,
    getBountyPostPanel,
  };
}
