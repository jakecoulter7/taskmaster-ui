import type { APIRoute } from "astro";
import { runBountyAction } from "../../data/bounty-actions";
import { parseBountyAction } from "../../lib/account-forms";
import { withBase } from "../../lib/url";

// Every bounty form posts here (from the board and from a bounty's page).
// Living under `/account` means the middleware has already required a
// signed-in player (with a changed temporary password) and purges the
// cached rows after; Astro's origin check rejects cross-site posts.

// Signing in from the board lands here (see `/login?next=`).
export const GET: APIRoute = ({ redirect }) => redirect(withBase("/bounties"));

export const POST: APIRoute = async ({ locals, request, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const action = parseBountyAction(await request.formData());
  const { outcome, bountyId } = action
    ? await runBountyAction(player.playerId, action)
    : { outcome: "invalid" as const, bountyId: undefined };
  const search = `?${new URLSearchParams({ bounty: outcome })}`;
  return redirect(
    bountyId === undefined
      ? withBase(`/bounties${search}`)
      : withBase(`/bounties/${bountyId}${search}`),
    303,
  );
};
