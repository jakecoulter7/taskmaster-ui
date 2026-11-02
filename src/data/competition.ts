import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BatchResponse } from "drizzle-orm/batch";
import { env } from "cloudflare:workers";
import type {
  CompetitionData,
  Season,
  SeasonDirectory,
  TaskRevealContext,
} from "../types";
import { getDb, type HttpDatabase } from "../db";
import {
  bonusPoints as bonusPointsTable,
  bounties as bountiesTable,
  bountyClaims as bountyClaimsTable,
  bundlePurchases as bundlePurchasesTable,
  changelogEntries as changelogTable,
  coinAdjustments as coinAdjustmentsTable,
  coinGifts as coinGiftsTable,
  coinPurchases as coinPurchasesTable,
  crateOpens as crateOpensTable,
  eggGifts as eggGiftsTable,
  equippedItems as equippedItemsTable,
  featureFlags as featureFlagsTable,
  itemGifts as itemGiftsTable,
  marketListings as marketListingsTable,
  marketOffers as marketOffersTable,
  marketSales as marketSalesTable,
  miniTaskCompletions as miniTaskCompletionsTable,
  miniTasks as miniTasksTable,
  wishes as wishesTable,
  powerUpUses as powerUpUsesTable,
  shopItems as shopItemsTable,
  skillPaths as skillPathsTable,
  skillUnlocks as skillUnlocksTable,
  peoplesChoiceVotes as peoplesChoiceVotesTable,
  players as playersTable,
  pollOptions as pollOptionsTable,
  polls as pollsTable,
  pollVotes as pollVotesTable,
  predictions as predictionsTable,
  raffleTickets as raffleTicketsTable,
  recaps as recapsTable,
  renameTokens as renameTokensTable,
  seasons as seasonsTable,
  shopBundleItems as shopBundleItemsTable,
  shopBundles as shopBundlesTable,
  shopDeals as shopDealsTable,
  taskScores as taskScoresTable,
  taskSubmissions as taskSubmissionsTable,
  tasks as tasksTable,
  teamMembers as teamMembersTable,
  teamScores as teamScoresTable,
  teams as teamsTable,
  wrappedGifts as wrappedGiftsTable,
} from "../db/schema";
import { mapPlayers } from "./players";
import { mapTeams } from "./teams";
import { mapTasks } from "./tasks";
import { buildScoreRecords } from "./scores";
import { derivePollBonusRows, mapPolls } from "./polls";
import {
  derivePeoplesChoiceBonusRows,
  mapPeoplesChoiceVotes,
} from "./peoples-choice";
import { derivePredictionBonusRows, mapPredictions } from "./predictions";
import { mapChangelog, mapRecaps } from "./editorial";
import { createSeasonDirectory, mapSeasons, rowsForSeason } from "./seasons";
import {
  deriveSabotageBonusRows,
  deriveUnderdogBonusRows,
  mapAdjustments,
  mapCrateOpens,
  mapEggGifts,
  mapEntries,
  mapEquipped,
  mapGifts,
  mapHints,
  mapItemGifts,
  mapWishes,
  mapPowerUpUses,
  mapPurchases,
  mapShopItems,
  mapSkillPaths,
  mapSkillUnlocks,
  powerUpKeys,
  resolveSabotages,
  underdogClaims,
} from "./coins";
import { mapFeatureFlags } from "./feature-flags";
import { mapMarket } from "./market-mappers";
import { mapBounties } from "./bounty-mappers";
import { mapMiniTaskCompletions, mapMiniTasks } from "./mini-tasks";
import {
  mapBundlePurchases,
  mapBundles,
  mapDealOverrides,
  mapRaffle,
  mapRenameTokens,
  mapWrappedGifts,
} from "./shop-extras";
import { unlockedTaskIds } from "../lib/task-reveal";
import { timestamptzToIso } from "../lib/time";
import { cachedJson, purgeCached } from "../lib/edge-cache";

/**
 * Who the snapshot is for: public visitors (with any task reveal cookies
 * they carry, keyed by task id) or an admin, who always sees real content.
 */
export type CompetitionViewer =
  | { mode: "public"; revealTokens: ReadonlyMap<string, string> }
  | { mode: "admin" };

// The raw rows are the same for every viewer (reveal cookies, admin mode and
// held results are applied after loading), so public requests share one
// copy cached per Cloudflare data centre. Data only changes through writes,
// and every signed-in write purges it (see `src/middleware.ts`), so the TTL
// only bounds how stale other data centres and script/console edits can be.
const ROWS_CACHE_TTL_SECONDS = 5 * 60;

/**
 * The cache key for the raw rows. It includes the deployed Worker version so
 * a deploy (whose code may expect a new column) never reads rows cached by
 * the previous one. The path isn't a route, and the Worker runs before the
 * cache, so the entry can't be fetched from outside.
 */
const rowsCacheKey = (origin: string) =>
  `${origin}/__cache/competition-rows/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }`;

// Signed-out visitors' pages are cached under the current generation (see
// `src/middleware.ts`). Purging it with the rows moves every page in this
// data centre onto fresh keys, since a URL-keyed cache can't be emptied.
const generationCacheKey = (origin: string) =>
  `${origin}/__cache/competition-generation/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }`;

/**
 * The current generation of the cached competition data (in this data
 * centre): it changes whenever the cached rows are purged or expire. Cache
 * keys that include it are dropped along with the rows.
 */
export const competitionCacheGeneration = (origin: string) =>
  cachedJson<string>(
    generationCacheKey(origin),
    ROWS_CACHE_TTL_SECONDS,
    async () => `${env.CF_VERSION_METADATA?.id ?? "local"}-${Date.now()}`,
  );

// A closed season's rows rarely change (it's read-only for admins until
// reopened, when its rows load with the open seasons), so they're cached for
// longer. A few player writes still land on one (e.g. People's Choice votes
// in the days after the last week), so every signed-in write purges the
// archive generation in the key too, as it does the live rows. The key also
// includes when the season was closed, so closing it again starts afresh.
const ARCHIVE_CACHE_TTL_SECONDS = 24 * 60 * 60;

const archiveGenerationKey = (origin: string) =>
  `${origin}/__cache/season-archive-generation/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }`;

const archiveCacheKey = async (origin: string, season: Season) => {
  const generation = await cachedJson<string>(
    archiveGenerationKey(origin),
    ARCHIVE_CACHE_TTL_SECONDS,
    async () => String(Date.now()),
  );
  return `${origin}/__cache/season-archive/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }/${encodeURIComponent(season.id)}/${encodeURIComponent(
    season.closedAt ?? "",
  )}/${generation}`;
};

/**
 * Drops the cached rows (open and closed seasons') and the pages built
 * from them, in this data centre.
 */
export const invalidateCompetitionCache = async (origin: string) => {
  await Promise.all([
    purgeCached(rowsCacheKey(origin)),
    purgeCached(generationCacheKey(origin)),
    purgeCached(archiveGenerationKey(origin)),
  ]);
};

/** Which seasons' rows a fetch covers: every season not yet closed, or one. */
type SeasonScope = { kind: "open" } | { kind: "season"; seasonId: string };

/**
 * The queries for one scope's season-specific rows (rosters, weeks, scores
 * and every Clim Coin record), each narrowed in SQL to the scope's seasons
 * through its season, week or player. Site-wide tables (polls, changelog,
 * shop, flags) are in `fetchLiveRows`.
 */
export function seasonRowQueries(db: HttpDatabase, scope: SeasonScope) {
  const seasonIds = db
    .select({ id: seasonsTable.id })
    .from(seasonsTable)
    .where(
      scope.kind === "open"
        ? isNull(seasonsTable.closedAt)
        : eq(seasonsTable.id, scope.seasonId),
    );
  const taskIds = db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(inArray(tasksTable.seasonId, seasonIds));
  const playerIds = db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(inArray(playersTable.seasonId, seasonIds));
  const bountyIds = db
    .select({ id: bountiesTable.id })
    .from(bountiesTable)
    .where(inArray(bountiesTable.seasonId, seasonIds));
  const listingIds = db
    .select({ id: marketListingsTable.id })
    .from(marketListingsTable)
    .where(inArray(marketListingsTable.seasonId, seasonIds));
  const inSeasons = (column: Parameters<typeof inArray>[0]) =>
    inArray(column, seasonIds);
  const forWeeks = (column: Parameters<typeof inArray>[0]) =>
    inArray(column, taskIds);
  const forPlayers = (column: Parameters<typeof inArray>[0]) =>
    inArray(column, playerIds);

  return [
    db
      .select()
      .from(playersTable)
      .where(inSeasons(playersTable.seasonId))
      .orderBy(asc(playersTable.sortOrder)),
    db
      .select()
      .from(teamsTable)
      .where(inSeasons(teamsTable.seasonId))
      .orderBy(asc(teamsTable.sortOrder)),
    db
      .select()
      .from(teamMembersTable)
      .where(inSeasons(teamMembersTable.seasonId))
      .orderBy(asc(teamMembersTable.teamId), asc(teamMembersTable.sortOrder)),
    db
      .select()
      .from(tasksTable)
      .where(inSeasons(tasksTable.seasonId))
      .orderBy(asc(tasksTable.weekNumber)),
    db.select().from(taskScoresTable).where(forWeeks(taskScoresTable.taskId)),
    db.select().from(teamScoresTable).where(forWeeks(teamScoresTable.taskId)),
    db
      .select()
      .from(bonusPointsTable)
      .where(forWeeks(bonusPointsTable.taskId))
      .orderBy(asc(bonusPointsTable.id)),
    // Each vote with the entry's owner, so winners resolve without loading
    // every submission.
    db
      .select({
        taskId: peoplesChoiceVotesTable.taskId,
        playerId: peoplesChoiceVotesTable.playerId,
        submissionId: peoplesChoiceVotesTable.submissionId,
        submitterId: taskSubmissionsTable.playerId,
        teamId: taskSubmissionsTable.teamId,
        hiddenAt: taskSubmissionsTable.hiddenAt,
      })
      .from(peoplesChoiceVotesTable)
      .innerJoin(
        taskSubmissionsTable,
        eq(taskSubmissionsTable.id, peoplesChoiceVotesTable.submissionId),
      )
      .where(forWeeks(peoplesChoiceVotesTable.taskId)),
    db
      .select()
      .from(predictionsTable)
      .where(forWeeks(predictionsTable.taskId))
      .orderBy(asc(predictionsTable.createdAt)),
    db.select().from(recapsTable).where(forWeeks(recapsTable.taskId)),
    db
      .select()
      .from(coinPurchasesTable)
      .where(forPlayers(coinPurchasesTable.playerId))
      .orderBy(asc(coinPurchasesTable.id)),
    db
      .select()
      .from(powerUpUsesTable)
      .where(forWeeks(powerUpUsesTable.taskId))
      .orderBy(asc(powerUpUsesTable.id)),
    db
      .select()
      .from(equippedItemsTable)
      .where(forPlayers(equippedItemsTable.playerId)),
    db
      .select()
      .from(coinAdjustmentsTable)
      .where(forPlayers(coinAdjustmentsTable.playerId))
      .orderBy(asc(coinAdjustmentsTable.id)),
    // Who entered which week (visible entries only), for the entry payout.
    db
      .selectDistinct({
        taskId: taskSubmissionsTable.taskId,
        playerId: taskSubmissionsTable.playerId,
      })
      .from(taskSubmissionsTable)
      .where(
        and(
          isNull(taskSubmissionsTable.hiddenAt),
          forWeeks(taskSubmissionsTable.taskId),
        ),
      ),
    db
      .select()
      .from(crateOpensTable)
      .where(forPlayers(crateOpensTable.playerId))
      .orderBy(asc(crateOpensTable.id)),
    db
      .select()
      .from(coinGiftsTable)
      .where(inSeasons(coinGiftsTable.seasonId))
      .orderBy(asc(coinGiftsTable.id)),
    db
      .select()
      .from(itemGiftsTable)
      .where(forPlayers(itemGiftsTable.playerId))
      .orderBy(asc(itemGiftsTable.id)),
    db
      .select()
      .from(eggGiftsTable)
      .where(forPlayers(eggGiftsTable.playerId))
      .orderBy(asc(eggGiftsTable.id)),
    db
      .select()
      .from(wishesTable)
      .where(forPlayers(wishesTable.playerId))
      .orderBy(asc(wishesTable.id)),
    db
      .select()
      .from(skillPathsTable)
      .where(forPlayers(skillPathsTable.playerId)),
    db
      .select()
      .from(skillUnlocksTable)
      .where(forPlayers(skillUnlocksTable.playerId))
      .orderBy(asc(skillUnlocksTable.id)),
    db.select().from(miniTasksTable).where(inSeasons(miniTasksTable.seasonId)),
    db
      .select()
      .from(miniTaskCompletionsTable)
      .where(inSeasons(miniTaskCompletionsTable.seasonId)),
    db
      .select()
      .from(marketListingsTable)
      .where(inSeasons(marketListingsTable.seasonId)),
    db
      .select()
      .from(marketOffersTable)
      .where(inArray(marketOffersTable.listingId, listingIds)),
    db
      .select()
      .from(marketSalesTable)
      .where(inSeasons(marketSalesTable.seasonId)),
    db.select().from(bountiesTable).where(inSeasons(bountiesTable.seasonId)),
    db
      .select()
      .from(bountyClaimsTable)
      .where(inArray(bountyClaimsTable.bountyId, bountyIds)),
    db
      .select()
      .from(raffleTicketsTable)
      .where(forWeeks(raffleTicketsTable.taskId))
      .orderBy(asc(raffleTicketsTable.id)),
    db
      .select()
      .from(renameTokensTable)
      .where(forPlayers(renameTokensTable.playerId))
      .orderBy(asc(renameTokensTable.id)),
    db
      .select()
      .from(wrappedGiftsTable)
      .where(inSeasons(wrappedGiftsTable.seasonId))
      .orderBy(asc(wrappedGiftsTable.id)),
    db
      .select()
      .from(bundlePurchasesTable)
      .where(forPlayers(bundlePurchasesTable.playerId))
      .orderBy(asc(bundlePurchasesTable.id)),
  ] as const;
}

/** Names the results of `seasonRowQueries`, in the same order. */
function nameSeasonRows([
  playerRows,
  teamRows,
  memberRows,
  taskRows,
  taskScoreRows,
  teamScoreRows,
  bonusRows,
  peoplesChoiceRows,
  predictionRows,
  recapRows,
  coinPurchaseRows,
  powerUpUseRows,
  equippedRows,
  coinAdjustmentRows,
  entryRows,
  crateOpenRows,
  coinGiftRows,
  itemGiftRows,
  eggGiftRows,
  wishRows,
  skillPathRows,
  skillUnlockRows,
  miniTaskRows,
  miniTaskCompletionRows,
  marketListingRows,
  marketOfferRows,
  marketSaleRows,
  bountyRows,
  bountyClaimRows,
  raffleTicketRows,
  renameTokenRows,
  wrappedGiftRows,
  bundlePurchaseRows,
]: BatchResponse<ReturnType<typeof seasonRowQueries>>) {
  return {
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    coinPurchaseRows,
    powerUpUseRows,
    equippedRows,
    coinAdjustmentRows,
    entryRows,
    crateOpenRows,
    coinGiftRows,
    itemGiftRows,
    eggGiftRows,
    wishRows,
    skillPathRows,
    skillUnlockRows,
    miniTaskRows,
    miniTaskCompletionRows,
    marketListingRows,
    marketOfferRows,
    marketSaleRows,
    bountyRows,
    bountyClaimRows,
    raffleTicketRows,
    renameTokenRows,
    wrappedGiftRows,
    bundlePurchaseRows,
  };
}

/** One season's (or the open seasons') season-specific rows. */
export type SeasonRows = ReturnType<typeof nameSeasonRows>;

/**
 * What every request needs, in one HTTP round trip: the seasons and a
 * light index of which season each player, squad and week is in (for the
 * season directory), the site-wide tables, and the season-specific rows of
 * every season that isn't closed. Closed seasons' rows are only loaded when
 * a page asks for one (`loadSeasonRows`), so the per-request load stays the
 * same size however many seasons have been archived.
 */
async function fetchLiveRows() {
  const db = getDb();
  const [
    seasonRows,
    playerIndexRows,
    teamIndexRows,
    taskIndexRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    changelogRows,
    shopItemRows,
    featureFlagRows,
    shopBundleRows,
    shopBundleItemRows,
    shopDealRows,
    ...seasonResults
  ] = await db.batch([
    db.select().from(seasonsTable),
    db
      .select({ id: playersTable.id, seasonId: playersTable.seasonId })
      .from(playersTable),
    db
      .select({ id: teamsTable.id, seasonId: teamsTable.seasonId })
      .from(teamsTable),
    db
      .select({
        id: tasksTable.id,
        seasonId: tasksTable.seasonId,
        releaseDate: tasksTable.releaseDate,
        deadline: tasksTable.deadline,
      })
      .from(tasksTable),
    db
      .select()
      .from(pollsTable)
      .orderBy(desc(pollsTable.opensAt), desc(pollsTable.createdAt)),
    db.select().from(pollOptionsTable),
    db.select().from(pollVotesTable),
    db
      .select()
      .from(changelogTable)
      .orderBy(desc(changelogTable.date), desc(changelogTable.createdAt)),
    db.select().from(shopItemsTable),
    db.select().from(featureFlagsTable),
    db.select().from(shopBundlesTable),
    db.select().from(shopBundleItemsTable),
    db.select().from(shopDealsTable),
    ...seasonRowQueries(db, { kind: "open" }),
  ]);
  return {
    seasonRows,
    playerIndexRows,
    teamIndexRows,
    taskIndexRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    changelogRows,
    shopItemRows,
    featureFlagRows,
    shopBundleRows,
    shopBundleItemRows,
    shopDealRows,
    ...nameSeasonRows(seasonResults),
  };
}

/** A closed season's season-specific rows, in one HTTP round trip. */
async function fetchArchivedSeasonRows(seasonId: string): Promise<SeasonRows> {
  const db = getDb();
  return nameSeasonRows(
    await db.batch(seasonRowQueries(db, { kind: "season", seasonId })),
  );
}

/**
 * The site-wide rows plus the season-specific rows of whichever seasons
 * were loaded: the open ones (`loadCompetitionRows`), with a closed one's
 * merged in by `loadSeasonRows`.
 */
export type CompetitionRows = Awaited<ReturnType<typeof fetchLiveRows>>;

/**
 * The rows every request starts from: the site-wide tables, the season
 * index and every open season's rows. Admins always read the database
 * directly; public requests (given the site `origin` for the cache key)
 * share the cached rows. Add a closed season's rows with `loadSeasonRows`,
 * then build its snapshot with `buildCompetition`.
 */
export async function loadCompetitionRows(
  viewer: CompetitionViewer = { mode: "public", revealTokens: new Map() },
  cacheOrigin?: string,
): Promise<CompetitionRows> {
  return viewer.mode === "admin" || !cacheOrigin
    ? fetchLiveRows()
    : cachedJson<CompetitionRows>(
        rowsCacheKey(cacheOrigin),
        ROWS_CACHE_TTL_SECONDS,
        fetchLiveRows,
      );
}

/**
 * `live` with `season`'s rows in it. An open season's are already there; a
 * closed one's are loaded on demand (cached per data centre for public
 * requests, read directly for admins), so only pages about an archived
 * season (the hall of fame, its standings, its wrapped) pay for them.
 */
export async function loadSeasonRows(
  live: CompetitionRows,
  season: Season,
  viewer: CompetitionViewer = { mode: "public", revealTokens: new Map() },
  cacheOrigin?: string,
): Promise<CompetitionRows> {
  if (season.status !== "closed") return live;
  const archived =
    viewer.mode === "admin" || !cacheOrigin
      ? await fetchArchivedSeasonRows(season.id)
      : await cachedJson<SeasonRows>(
          await archiveCacheKey(cacheOrigin, season),
          ARCHIVE_CACHE_TTL_SECONDS,
          () => fetchArchivedSeasonRows(season.id),
        );
  return { ...live, ...archived };
}

/**
 * The snapshot of the season `playerId` is in, built from rows read straight
 * from the database (skipping the edge cache), or `undefined` for an
 * unknown player. For checks guarding a write that mustn't act on stale
 * rows, e.g. a Clim Coin balance before a purchase.
 */
export async function loadFreshPlayerCompetition(
  playerId: string,
): Promise<CompetitionData | undefined> {
  const live = await fetchLiveRows();
  const season = buildSeasonDirectory(live).seasonOfPlayer(playerId);
  if (!season) return undefined;
  return buildCompetition(
    await loadSeasonRows(live, season),
    { mode: "public", revealTokens: new Map() },
    season,
  );
}

/** The seasons, and which season each player, squad and week is in. */
export function buildSeasonDirectory(rows: CompetitionRows): SeasonDirectory {
  return createSeasonDirectory(
    mapSeasons(rows.seasonRows, rows.taskIndexRows),
    {
      players: rows.playerIndexRows,
      teams: rows.teamIndexRows,
      tasks: rows.taskIndexRows,
    },
  );
}

/**
 * Maps one season's rows onto the `src/types` shapes for `viewer`. Derived
 * state (task status, deadlines) is worked out on every request, so it's
 * never stale.
 */
export async function buildCompetition(
  allRows: CompetitionRows,
  viewer: CompetitionViewer,
  season: Season,
): Promise<CompetitionData> {
  return buildSeasonCompetition(
    rowsForSeason(allRows, season.id),
    viewer,
    season,
  );
}

async function buildSeasonCompetition(
  {
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
    shopItemRows,
    coinPurchaseRows,
    powerUpUseRows,
    equippedRows,
    coinAdjustmentRows,
    entryRows,
    crateOpenRows,
    coinGiftRows,
    featureFlagRows,
    itemGiftRows,
    eggGiftRows,
    wishRows,
    skillPathRows,
    skillUnlockRows,
    miniTaskRows,
    miniTaskCompletionRows,
    marketListingRows,
    marketOfferRows,
    marketSaleRows,
    bountyRows,
    bountyClaimRows,
    raffleTicketRows,
    renameTokenRows,
    wrappedGiftRows,
    bundlePurchaseRows,
    shopBundleRows,
    shopBundleItemRows,
    shopDealRows,
  }: CompetitionRows,
  viewer: CompetitionViewer,
  season: Season,
): Promise<CompetitionData> {
  const players = mapPlayers(playerRows);
  const teams = mapTeams(teamRows, memberRows);
  const reveal: TaskRevealContext =
    viewer.mode === "admin"
      ? viewer
      : {
          mode: "public",
          unlockedTaskIds: await unlockedTaskIds(
            viewer.revealTokens,
            new Map(
              taskRows.flatMap((row) =>
                row.revealPassword ? [[row.id, row.revealPassword]] : [],
              ),
            ),
          ),
        };
  const tasks = mapTasks(taskRows, reveal);
  const polls = mapPolls(pollRows, pollOptionRows, pollVoteRows, tasks);
  const peoplesChoiceVotes = mapPeoplesChoiceVotes(peoplesChoiceRows);
  const predictions = mapPredictions(predictionRows);

  // Results night: the public never sees a held week's scores or recorded
  // bonuses (they go out one at a time on `/live`); admins always do.
  const heldTaskIds = new Set(
    viewer.mode === "admin"
      ? []
      : taskRows.filter((row) => row.resultsHeldAt !== null).map((r) => r.id),
  );
  const published = <Row extends { taskId: string }>(rows: Row[]) =>
    rows.filter((row) => !heldTaskIds.has(row.taskId));
  const publishedAt = Object.fromEntries(
    taskRows.flatMap((row) =>
      row.resultsPublishedAt ? [[row.id, row.resultsPublishedAt]] : [],
    ),
  );

  const scoreRows = {
    taskScores: published(taskScoreRows),
    teamScores: published(teamScoreRows),
  };
  // Clim Coin power-ups: Golden Week boosts task points before ranking,
  // Double Down raises a correct call's bonus, Sabotage is a deduction,
  // Heist moves points and Underdog adds some.
  const uses = mapPowerUpUses(powerUpUseRows);
  const context = {
    players,
    teams,
    tasks,
    publishedAt,
    goldenWeekKeys: powerUpKeys(uses, "golden_week"),
  };
  // Recorded bonuses first, then the ones earned by voting in polls and in
  // People's Choice. A held week's bonuses count as given when its results
  // were published, so their notifications arrive after the show.
  const bonusPoints = [
    ...published(bonusRows).map((row) => {
      const at = publishedAt[row.taskId];
      const instant = (value: string) =>
        new Date(timestamptzToIso(value)).getTime();
      return at && instant(at) > instant(row.createdAt)
        ? { ...row, createdAt: at }
        : row;
    }),
    // Polls are site-wide: only this season's players earn their bonus.
    ...derivePollBonusRows(polls).filter((row) =>
      players.some((p) => p.id === row.playerId),
    ),
    ...derivePeoplesChoiceBonusRows(peoplesChoiceVotes, tasks, teams),
  ];
  // Correct predictions depend on the week's finishing positions, and
  // Shields and Mirrors on whether the week's results are out, so rank once
  // without them, then again with their bonuses added (bonuses never change
  // positions or when results are out).
  const ranked = buildScoreRecords({ ...scoreRows, bonusPoints }, context);
  const purchases = mapPurchases(coinPurchaseRows);
  const items = mapShopItems(shopItemRows);
  const sabotageRows = deriveSabotageBonusRows(
    uses,
    players,
    resolveSabotages(uses, purchases, items),
    new Set(Object.keys(ranked.resultsPostedAt)),
  );
  const predictionBonuses = derivePredictionBonusRows(
    predictions,
    ranked,
    players,
    new Map(teams.map((t) => [t.id, t.name])),
    powerUpKeys(uses, "double_down"),
  );
  // Underdog watches finishing positions, which bonuses never change.
  const underdogRows = deriveUnderdogBonusRows(
    underdogClaims(tasks, ranked.scores, purchases, items),
  );
  const derivedBonuses = [
    ...sabotageRows,
    ...predictionBonuses,
    ...underdogRows,
  ];
  const records =
    derivedBonuses.length === 0
      ? ranked
      : buildScoreRecords(
          { ...scoreRows, bonusPoints: [...bonusPoints, ...derivedBonuses] },
          context,
        );

  return {
    season,
    players,
    teams,
    tasks,
    ...records,
    polls,
    peoplesChoiceVotes,
    predictions,
    recaps: mapRecaps(recapRows),
    changelog: mapChangelog(changelogRows),
    coins: {
      items,
      purchases,
      uses,
      equipped: mapEquipped(equippedRows),
      adjustments: mapAdjustments(coinAdjustmentRows),
      entries: mapEntries(entryRows),
      crateOpens: mapCrateOpens(crateOpenRows),
      gifts: mapGifts(coinGiftRows),
      itemGifts: mapItemGifts(itemGiftRows),
      eggGifts: mapEggGifts(eggGiftRows),
      wishes: mapWishes(wishRows),
      hints: mapHints(taskRows),
      skillPaths: mapSkillPaths(skillPathRows),
      skillUnlocks: mapSkillUnlocks(skillUnlockRows),
      miniTasks: mapMiniTasks(miniTaskRows),
      miniTaskCompletions: mapMiniTaskCompletions(miniTaskCompletionRows),
      market: mapMarket(marketListingRows, marketOfferRows, marketSaleRows),
      bounties: mapBounties(bountyRows, bountyClaimRows),
      raffle: mapRaffle(raffleTicketRows, tasks),
      renameTokens: mapRenameTokens(renameTokenRows),
      wrappedGifts: mapWrappedGifts(wrappedGiftRows),
      bundles: mapBundles(shopBundleRows, shopBundleItemRows),
      bundlePurchases: mapBundlePurchases(bundlePurchaseRows),
      dealOverrides: mapDealOverrides(shopDealRows),
    },
    features: mapFeatureFlags(featureFlagRows),
  };
}
