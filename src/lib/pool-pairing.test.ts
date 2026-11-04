import { describe, expect, it } from "vitest";
import { MAX_POOL_TEAMS } from "./pool-bracket";
import { POOL_TEAM_NAMES, planRandomPairings } from "./pool-pairing";

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

// Always picks the last remaining position, so shuffles keep the order.
const keepOrder = () => 0.999999;

describe("planRandomPairings", () => {
  it("pairs everyone into duos when the count is even", () => {
    const plan = planRandomPairings(players(4), 0, [], keepOrder);
    expect(plan.pairings.map((p) => p.memberIds)).toEqual([
      ["p1", "p2"],
      ["p3", "p4"],
    ]);
    expect(plan.unpairedIds).toEqual([]);
  });

  it("leaves the odd one out unpaired", () => {
    const plan = planRandomPairings(players(5), 0, [], keepOrder);
    expect(plan.pairings).toHaveLength(2);
    expect(plan.unpairedIds).toEqual(["p5"]);
  });

  it("puts every player in exactly one place", () => {
    const plan = planRandomPairings(players(9), 0, [], Math.random);
    const placed = [
      ...plan.pairings.flatMap((p) => p.memberIds),
      ...plan.unpairedIds,
    ];
    expect(placed.sort()).toEqual(players(9).sort());
  });

  it("stops at the team cap", () => {
    const plan = planRandomPairings(
      players(10),
      MAX_POOL_TEAMS - 2,
      [],
      keepOrder,
    );
    expect(plan.pairings).toHaveLength(2);
    expect(plan.unpairedIds).toEqual(["p5", "p6", "p7", "p8", "p9", "p10"]);
  });

  it("pairs nobody with fewer than two players or no room", () => {
    expect(planRandomPairings(players(1), 0, []).pairings).toEqual([]);
    expect(planRandomPairings(players(4), MAX_POOL_TEAMS, []).pairings).toEqual(
      [],
    );
  });

  it("gives each team a unique name not already taken, with its slug as id", () => {
    const taken = ["cue ballers", "Corner Pocket"];
    const plan = planRandomPairings(players(12), 0, taken, Math.random);
    const names = plan.pairings.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Cue Ballers");
    expect(names).not.toContain("Corner Pocket");
    for (const p of plan.pairings) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("falls back to numbered names when the list runs out", () => {
    const plan = planRandomPairings(
      players(4),
      0,
      [...POOL_TEAM_NAMES, "Duo 1"],
      keepOrder,
    );
    expect(plan.pairings.map((p) => p.name)).toEqual(["Duo 2", "Duo 3"]);
  });
});
