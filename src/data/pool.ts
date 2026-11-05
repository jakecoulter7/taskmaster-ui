import { and, asc, eq, max, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { violatedConstraint } from "./db-errors";
import {
  poolBracketEntries,
  poolBrackets,
  poolMatchReports,
  poolMatchResults,
  poolTeamMembers,
  poolTeams,
} from "../db/schema";
import {
  nextPoolReveal,
  POOL_TEAM_SIZE,
  type PoolEntry,
  type PoolMatch,
  type PoolResult,
} from "../lib/pool-bracket";
import { toWallClock, wallClockToIso } from "../lib/time";
import type { PoolTeamInput } from "../lib/pool-forms";
import {
  matchAgreement,
  type PoolAgreement,
  type PoolReport,
} from "../lib/pool-scoring";

// Pool bracket reads and writes. Read straight from the database (not the
// cached competition snapshot) while the feature is new.

export interface PoolTeamRecord {
  id: string;
  name: string;
  memberIds: string[];
}

export interface PoolBracketRecord {
  id: number;
  weekNumber: number;
  /** When the draw goes public (ISO 8601). */
  revealAt: string;
  entries: PoolEntry[];
  results: PoolResult[];
  reports: PoolReport[];
}

export async function listPoolTeams(
  seasonId: string,
): Promise<PoolTeamRecord[]> {
  const db = getDb();
  const [teamRows, memberRows] = await db.batch([
    db
      .select()
      .from(poolTeams)
      .where(eq(poolTeams.seasonId, seasonId))
      .orderBy(asc(poolTeams.name)),
    db
      .select()
      .from(poolTeamMembers)
      .where(eq(poolTeamMembers.seasonId, seasonId)),
  ]);
  return teamRows.map((team) => ({
    id: team.id,
    name: team.name,
    memberIds: memberRows
      .filter((m) => m.teamId === team.id)
      .map((m) => m.playerId),
  }));
}

/** The pool team a signed-in player (via their linked account) plays for. */
export const poolTeamOf = (
  teams: readonly PoolTeamRecord[],
  playerId: string | undefined,
): PoolTeamRecord | undefined =>
  playerId === undefined
    ? undefined
    : teams.find((t) => t.memberIds.includes(playerId));

// Team ids are global keys, so the season is part of them: a later season
// can reuse a team name.
const poolTeamId = (seasonId: string, slug: string) => `${seasonId}-${slug}`;

/** A team with fewer than two players (one was removed) can't be drawn. */
export const isCompletePoolTeam = (team: PoolTeamRecord) =>
  team.memberIds.length === POOL_TEAM_SIZE;

/** Saves a team; `input.id` is the name's slug, made unique per season. */
export const createPoolTeam = (
  seasonId: string,
  input: PoolTeamInput,
): Promise<void> => createPoolTeams(seasonId, [input]);

/** Saves several teams in one transaction (all or none). */
export async function createPoolTeams(
  seasonId: string,
  inputs: readonly PoolTeamInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  const db = getDb();
  const rows = inputs.map((input) => ({
    ...input,
    teamId: poolTeamId(seasonId, input.id),
  }));
  await db.batch([
    db
      .insert(poolTeams)
      .values(rows.map(({ teamId, name }) => ({ id: teamId, seasonId, name }))),
    db
      .insert(poolTeamMembers)
      .values(
        rows.flatMap(({ teamId, memberIds }) =>
          memberIds.map((playerId) => ({ teamId, playerId, seasonId })),
        ),
      ),
  ]);
}

export type PoolTeamDeletion = "deleted" | "in-use" | "missing";

/** Deletes a team that was never drawn into a bracket. */
export async function deletePoolTeam(
  seasonId: string,
  id: string,
): Promise<PoolTeamDeletion> {
  try {
    const deleted = await getDb()
      .delete(poolTeams)
      .where(and(eq(poolTeams.id, id), eq(poolTeams.seasonId, seasonId)))
      .returning({ id: poolTeams.id });
    return deleted.length > 0 ? "deleted" : "missing";
  } catch (error) {
    // Bracket entries restrict deletes, so a drawn team is refused atomically.
    if (
      violatedConstraint(error) ===
      "pool_bracket_entries_team_id_pool_teams_id_fk"
    ) {
      return "in-use";
    }
    throw error;
  }
}

async function loadPoolBrackets(
  where: SQL | undefined,
): Promise<PoolBracketRecord[]> {
  const db = getDb();
  const [bracketRows, entryRows, resultRows, reportRows] = await db.batch([
    db
      .select()
      .from(poolBrackets)
      .where(where)
      .orderBy(sql`${poolBrackets.weekNumber} desc`),
    db
      .select({
        bracketId: poolBracketEntries.bracketId,
        slot: poolBracketEntries.slot,
        teamId: poolBracketEntries.teamId,
      })
      .from(poolBracketEntries)
      .innerJoin(
        poolBrackets,
        eq(poolBrackets.id, poolBracketEntries.bracketId),
      )
      .where(where),
    db
      .select({
        bracketId: poolMatchResults.bracketId,
        round: poolMatchResults.round,
        matchIndex: poolMatchResults.matchIndex,
        winnerTeamId: poolMatchResults.winnerTeamId,
      })
      .from(poolMatchResults)
      .innerJoin(poolBrackets, eq(poolBrackets.id, poolMatchResults.bracketId))
      .where(where),
    db
      .select({
        bracketId: poolMatchReports.bracketId,
        round: poolMatchReports.round,
        matchIndex: poolMatchReports.matchIndex,
        teamId: poolMatchReports.teamId,
        winnerTeamId: poolMatchReports.winnerTeamId,
      })
      .from(poolMatchReports)
      .innerJoin(poolBrackets, eq(poolBrackets.id, poolMatchReports.bracketId))
      .where(where),
  ]);
  return bracketRows.map((bracket) => ({
    id: bracket.id,
    weekNumber: bracket.weekNumber,
    revealAt: wallClockToIso(bracket.revealAt),
    entries: entryRows
      .filter((e) => e.bracketId === bracket.id)
      .map(({ slot, teamId }) => ({ slot, teamId })),
    results: resultRows
      .filter((r) => r.bracketId === bracket.id)
      .map(({ round, matchIndex, winnerTeamId }) => ({
        round,
        matchIndex,
        winnerTeamId,
      })),
    reports: reportRows
      .filter((r) => r.bracketId === bracket.id)
      .map(({ round, matchIndex, teamId, winnerTeamId }) => ({
        round,
        matchIndex,
        teamId,
        winnerTeamId,
      })),
  }));
}

/** Every bracket in the season, latest week first. */
export const listPoolBrackets = (
  seasonId: string,
): Promise<PoolBracketRecord[]> =>
  loadPoolBrackets(eq(poolBrackets.seasonId, seasonId));

export async function getPoolBracket(
  seasonId: string,
  weekNumber: number,
): Promise<PoolBracketRecord | undefined> {
  const [bracket] = await loadPoolBrackets(
    and(
      eq(poolBrackets.seasonId, seasonId),
      eq(poolBrackets.weekNumber, weekNumber),
    ),
  );
  return bracket;
}

/** The week after the latest bracket (1 for the first). */
export async function nextPoolWeek(seasonId: string): Promise<number> {
  const [row] = await getDb()
    .select({ latest: max(poolBrackets.weekNumber) })
    .from(poolBrackets)
    .where(eq(poolBrackets.seasonId, seasonId));
  return (row?.latest ?? 0) + 1;
}

/** Saves a week's draw in one transaction, sealed until the next Monday 09:00. */
export async function createPoolBracket(
  seasonId: string,
  weekNumber: number,
  entries: readonly PoolEntry[],
): Promise<void> {
  const db = getDb();
  const bracketId = sql<number>`(select ${poolBrackets.id} from ${poolBrackets} where ${poolBrackets.seasonId} = ${seasonId} and ${poolBrackets.weekNumber} = ${weekNumber})`;
  await db.batch([
    db
      .insert(poolBrackets)
      .values({ seasonId, weekNumber, revealAt: nextPoolReveal(new Date()) }),
    db
      .insert(poolBracketEntries)
      .values(
        entries.map((e) => ({ bracketId, slot: e.slot, teamId: e.teamId })),
      ),
  ]);
}

export async function deletePoolBracket(id: number): Promise<void> {
  await getDb().delete(poolBrackets).where(eq(poolBrackets.id, id));
}

/** Reveals a sealed draw straight away. */
export async function revealPoolBracketNow(id: number): Promise<void> {
  await getDb()
    .update(poolBrackets)
    .set({ revealAt: toWallClock(new Date()) })
    .where(eq(poolBrackets.id, id));
}

export async function recordPoolResult(
  bracketId: number,
  result: PoolResult,
): Promise<void> {
  await getDb()
    .insert(poolMatchResults)
    .values({ bracketId, ...result })
    .onConflictDoUpdate({
      target: [
        poolMatchResults.bracketId,
        poolMatchResults.round,
        poolMatchResults.matchIndex,
      ],
      set: { winnerTeamId: result.winnerTeamId, updatedAt: sql`now()` },
    });
}

type MatchRef = { round: number; matchIndex: number };

const ofMatches = (
  table: typeof poolMatchResults | typeof poolMatchReports,
  bracketId: number,
  matches: readonly MatchRef[],
) =>
  and(
    eq(table.bracketId, bracketId),
    or(
      ...matches.map((m) =>
        and(eq(table.round, m.round), eq(table.matchIndex, m.matchIndex)),
      ),
    ),
  );

/** Clears the given matches' results and claims (a match and everything it fed). */
export async function clearPoolResults(
  bracketId: number,
  matches: readonly MatchRef[],
): Promise<void> {
  if (matches.length === 0) return;
  const db = getDb();
  await db.batch([
    db
      .delete(poolMatchResults)
      .where(ofMatches(poolMatchResults, bracketId, matches)),
    db
      .delete(poolMatchReports)
      .where(ofMatches(poolMatchReports, bracketId, matches)),
  ]);
}

/**
 * Saves a competing team's claim about `match` (replacing its earlier one)
 * and, once both teams agree, records the result.
 */
export async function reportPoolResult(
  bracketId: number,
  match: PoolMatch,
  report: PoolReport,
  playerId: string,
): Promise<PoolAgreement> {
  const db = getDb();
  await db
    .insert(poolMatchReports)
    .values({ bracketId, ...report, playerId })
    .onConflictDoUpdate({
      target: [
        poolMatchReports.bracketId,
        poolMatchReports.round,
        poolMatchReports.matchIndex,
        poolMatchReports.teamId,
      ],
      set: {
        winnerTeamId: report.winnerTeamId,
        playerId,
        updatedAt: sql`now()`,
      },
    });
  const claims = await db
    .select({
      round: poolMatchReports.round,
      matchIndex: poolMatchReports.matchIndex,
      teamId: poolMatchReports.teamId,
      winnerTeamId: poolMatchReports.winnerTeamId,
    })
    .from(poolMatchReports)
    .where(ofMatches(poolMatchReports, bracketId, [report]));
  const agreement = matchAgreement(match, claims);
  if (agreement.state === "agreed") {
    await recordPoolResult(bracketId, {
      round: report.round,
      matchIndex: report.matchIndex,
      winnerTeamId: agreement.winnerTeamId,
    });
  }
  return agreement;
}
