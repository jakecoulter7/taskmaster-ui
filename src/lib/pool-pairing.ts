// Random pool pairings: shuffles players into duos and names them, for the
// admin's "pair at random" button. Pure, so it's testable with a fixed random.

import { slugify } from "./admin-forms";
import { MAX_POOL_TEAMS, POOL_TEAM_SIZE } from "./pool-bracket";

export const POOL_TEAM_NAMES = [
  "Cue Ballers",
  "Corner Pocket",
  "Break Point",
  "Chalk Talk",
  "Double Kiss",
  "Side Spin",
  "Top Spin",
  "The Snookered",
  "Bank Shot",
  "Cannon Fodder",
  "Long Pot",
  "Rack Attack",
  "Eight Ball Wizards",
  "Plant Life",
  "Stun Gun",
  "Clean Sweep",
  "Black Ball Bandits",
  "Kitchen Crew",
  "Foul Play",
  "Spot On",
  "Double Trouble",
  "Fluke Force",
  "The Bridge Club",
  "Cushion Crashers",
] as const;

export interface PoolPairing {
  name: string;
  /** The name's slug, as the team form produces it. */
  id: string;
  memberIds: string[];
}

export interface PoolPairingPlan {
  pairings: PoolPairing[];
  /** Players left out: an odd one, or everyone past the team cap. */
  unpairedIds: string[];
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pairs `playerIds` at random into as many duos as fit alongside
 * `existingTeamCount` teams, naming each with an unused pool name.
 * `takenNames` are the season's existing team names.
 */
export function planRandomPairings(
  playerIds: readonly string[],
  existingTeamCount: number,
  takenNames: readonly string[],
  random: () => number = Math.random,
): PoolPairingPlan {
  const room = Math.max(0, MAX_POOL_TEAMS - existingTeamCount);
  const count = Math.min(room, Math.floor(playerIds.length / POOL_TEAM_SIZE));
  const players = shuffle(playerIds, random);
  const taken = new Set(takenNames.map(slugify));
  const names: string[] = shuffle(
    POOL_TEAM_NAMES.filter((name) => !taken.has(slugify(name))),
    random,
  );
  // Fallback names if the list runs out: "Duo 1", "Duo 2", … unused ones.
  for (let n = 1; names.length < count; n++) {
    const name = `Duo ${n}`;
    if (!taken.has(slugify(name))) names.push(name);
  }
  const pairings = Array.from({ length: count }, (_, i) => ({
    name: names[i],
    id: slugify(names[i]),
    memberIds: players.slice(i * POOL_TEAM_SIZE, (i + 1) * POOL_TEAM_SIZE),
  }));
  return { pairings, unpairedIds: players.slice(count * POOL_TEAM_SIZE) };
}
