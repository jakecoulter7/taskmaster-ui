import { beforeEach, describe, expect, it, vi } from "vitest";
import { season } from "../test/fixtures";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("astro:env/server", () => ({}));

// A real Drizzle client (it never connects: only `batch` runs, and that's
// stubbed), so the queries' SQL can be inspected.
const batch = vi.fn();
vi.mock("../db", async () => {
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { neon } = await import("@neondatabase/serverless");
  const schema = await import("../db/schema");
  const db = drizzle({
    client: neon("postgresql://user:password@localhost/db"),
    schema,
    casing: "snake_case",
  });
  return { getDb: () => Object.assign(db, { batch }) };
});

const { getDb } = await import("../db");
const { loadSeasonRows, seasonRowQueries } = await import("./competition");
type Rows = Parameters<typeof loadSeasonRows>[0];

const sqlOf = (scope: Parameters<typeof seasonRowQueries>[1]) =>
  seasonRowQueries(getDb(), scope).map((query) => query.toSQL());

describe("seasonRowQueries", () => {
  it("narrows every season-specific table to the open seasons in SQL", () => {
    for (const { sql } of sqlOf({ kind: "open" })) {
      expect(sql).toMatch(/ where /);
      expect(sql).toContain('"seasons"."closed_at" is null');
    }
  });

  it("narrows every table to one season when loading an archive", () => {
    for (const { sql, params } of sqlOf({ kind: "season", seasonId: "old" })) {
      expect(sql).toContain('"seasons"."id" = $');
      expect(sql).not.toContain('"seasons"."closed_at"');
      expect(params).toContain("old");
    }
  });
});

describe("loadSeasonRows", () => {
  const live = {
    seasonRows: [],
    pollRows: ["site-wide poll"],
    playerRows: ["open-season player"],
    marketSaleRows: ["open-season sale"],
  } as unknown as Rows;

  beforeEach(() => batch.mockReset());

  it("uses the live rows for a season that isn't closed", async () => {
    const rows = await loadSeasonRows(live, season({ status: "running" }));
    expect(rows).toBe(live);
    expect(batch).not.toHaveBeenCalled();
  });

  it("loads a closed season's rows and keeps the site-wide ones", async () => {
    const count = seasonRowQueries(getDb(), { kind: "open" }).length;
    batch.mockResolvedValue(
      Array.from({ length: count }, (_, i) => (i === 0 ? ["old player"] : [])),
    );
    const rows = await loadSeasonRows(
      live,
      season({ id: "old", status: "closed" }),
    );
    expect(batch).toHaveBeenCalledOnce();
    expect(rows.playerRows).toEqual(["old player"]);
    expect(rows.marketSaleRows).toEqual([]);
    expect(rows.pollRows).toEqual(["site-wide poll"]);
  });
});
