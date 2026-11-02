// Display config for skill trees: classes and copy keyed by the domain
// unions, so pages and components map variants through one typed table.
import type {
  PowerUpKind,
  ShopCategory,
  SkillBlock,
  SkillEarnSource,
  SkillOutcome,
  SkillPath,
  SkillNode,
  SkillPerk,
  SkillPerks,
} from "../types";
import { POWER_UP_INFO } from "../data/coins";

/** Each pathway accent's text, border, fill and SVG stroke utilities. */
export const SKILL_ACCENT_CLASS: Record<
  SkillPath["accent"],
  { text: string; border: string; fill: string; solid: string; stroke: string }
> = {
  acid: {
    text: "text-acid",
    border: "border-acid/50",
    fill: "bg-acid/10",
    solid: "border-acid bg-acid/25",
    stroke: "stroke-acid",
  },
  amber: {
    text: "text-amber",
    border: "border-amber/50",
    fill: "bg-amber/10",
    solid: "border-amber bg-amber/25",
    stroke: "stroke-amber",
  },
  magenta: {
    text: "text-magenta",
    border: "border-magenta/50",
    fill: "bg-magenta/10",
    solid: "border-magenta bg-magenta/25",
    stroke: "stroke-magenta",
  },
  cyan: {
    text: "text-cyan",
    border: "border-cyan/50",
    fill: "bg-cyan/10",
    solid: "border-cyan bg-cyan/25",
    stroke: "stroke-cyan",
  },
  gold: {
    text: "text-gold",
    border: "border-gold/50",
    fill: "bg-gold/10",
    solid: "border-gold bg-gold/25",
    stroke: "stroke-gold",
  },
};

/** A node's place in its tree, as its card labels it. */
export function skillNodeRole(node: SkillNode): string {
  if (node.requires.length === 0) return "root";
  if (node.requires.length > 1) return "capstone";
  return ({ 2: "branch", 3: "spur", 4: "tip" } as const)[
    node.tier as 2 | 3 | 4
  ];
}

/** Where a node is drawn: percentages of the tree's box (x across, y down). */
export interface SkillNodePoint {
  x: number;
  y: number;
}

export interface SkillTreeLayout {
  points: Record<string, SkillNodePoint>;
  /** One per prerequisite, parent to child. */
  edges: { from: string; to: string }[];
  rows: number;
}

/** Space between siblings, a lone child's outward lean, and the min gap. */
const FAN = 2;
const LEAN = 0.5;
const MIN_GAP = 1;

/**
 * Lays a pathway out as a tree growing up from its root: one row per tier,
 * each node above the middle of its prerequisites. Siblings fan out, a lone
 * child leans away from the centre, and no two nodes in a row overlap.
 */
export function layoutSkillTree(nodes: readonly SkillNode[]): SkillTreeLayout {
  const tiers = [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b);
  const xs = new Map<string, number>();
  for (const tier of tiers) {
    const siblings = new Map<string, SkillNode[]>();
    for (const node of nodes.filter((n) => n.tier === tier)) {
      const key = node.requires.join(" ");
      siblings.set(key, [...(siblings.get(key) ?? []), node]);
    }
    const row: { id: string; x: number }[] = [];
    for (const group of siblings.values()) {
      const parents = group[0].requires.flatMap((id) => xs.get(id) ?? []);
      const mean = parents.length
        ? parents.reduce((sum, x) => sum + x, 0) / parents.length
        : 0;
      const base =
        parents.length === 1 && group.length === 1
          ? mean + Math.sign(mean) * LEAN
          : mean;
      group.forEach((node, i) =>
        row.push({ id: node.id, x: base + (i - (group.length - 1) / 2) * FAN }),
      );
    }
    row.sort((a, b) => a.x - b.x);
    row.forEach((node, i) => {
      if (i > 0) node.x = Math.max(node.x, row[i - 1].x + MIN_GAP);
      xs.set(node.id, node.x);
    });
  }
  const all = [...xs.values()];
  const min = Math.min(...all);
  const span = Math.max(...all) - min;
  const rows = tiers.length;
  const points: Record<string, SkillNodePoint> = {};
  for (const node of nodes) {
    const row = tiers.indexOf(node.tier);
    points[node.id] = {
      x: span ? ((xs.get(node.id)! - min) / span) * 100 : 50,
      y: rows > 1 ? ((rows - 1 - row) / (rows - 1)) * 100 : 50,
    };
  }
  return {
    points,
    edges: nodes.flatMap((node) =>
      node.requires
        .filter((id) => id in points)
        .map((from) => ({ from, to: node.id })),
    ),
    rows,
  };
}

/** What a skill node says instead of its unlock button. */
export const SKILL_BLOCK_LABEL: Record<SkillBlock, string> = {
  guest: "sign in to unlock",
  "season-closed": "season closed",
  unlocked: "✓ unlocked",
  "other-path": "another pathway",
  locked: "locked",
  unaffordable: "not enough coins",
};

/** The notice shown after unlocking a skill node redirects back. */
export const SKILL_OUTCOME_NOTICE: Record<
  SkillOutcome,
  { tone: "success" | "error"; message: string }
> = {
  unlocked: { tone: "success", message: "Skill unlocked!" },
  unaffordable: {
    tone: "error",
    message: "You don't have enough Clim Coin for that skill.",
  },
  locked: {
    tone: "error",
    message: "Unlock the skills before it in the tree first.",
  },
  owned: { tone: "error", message: "You've already unlocked that skill." },
  "other-path": {
    tone: "error",
    message: "You've committed to another pathway this season.",
  },
  "season-closed": {
    tone: "error",
    message: "This season is closed, so its skill trees are frozen.",
  },
  unavailable: { tone: "error", message: "Skill trees aren't open right now." },
  invalid: { tone: "error", message: "That didn't work. Try again." },
};

const SKILL_OUTCOMES = new Set(Object.keys(SKILL_OUTCOME_NOTICE));

/** The outcome named in a `?skills=` param, if it's a real one. */
export function parseSkillOutcome(
  value: string | null,
): SkillOutcome | undefined {
  return value && SKILL_OUTCOMES.has(value)
    ? (value as SkillOutcome)
    : undefined;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "a", "a and b", "a, b and c". */
const listOf = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const EARN_LABEL: Record<SkillEarnSource, string> = {
  placement: "per scored week",
  entry: "per entry submitted",
  prediction: "per winner call",
  "poll-vote": "per poll vote",
  "peoples-choice-vote": "per People's Choice vote",
  "power-up-use": "per power-up used",
};

const CATEGORY_LABEL: Record<ShopCategory, string> = {
  pet: "pets",
  avatar: "avatars",
  cosmetic: "cosmetics",
  power_up: "power-ups",
};

/** What one perk does, as a short line (a node card lists these). */
export function describePerk(perk: SkillPerk): string {
  switch (perk.kind) {
    case "earn_bonus":
      return `+${plural(perk.amount, "coin")} ${EARN_LABEL[perk.source]}`;
    case "power_up_discount": {
      const names = perk.powerUps?.map((e) => POWER_UP_INFO[e].label);
      const subject = names ? listOf(names) : "power-ups";
      const verb = names?.length === 1 ? "costs" : "cost";
      return `${subject} ${verb} ${plural(perk.amount, "coin")} less`;
    }
    case "shop_discount":
      return `${listOf(perk.categories.map((c) => CATEGORY_LABEL[c]))} cost ${plural(perk.amount, "coin")} less`;
    case "egg_discount":
      return `eggs cost ${plural(perk.amount, "coin")} less`;
    case "egg_luck":
      return `luckier eggs: ${Math.round(perk.amount * 100)}% of the odds move up a tier`;
    case "gift_cap":
      return `gift ${plural(perk.amount, "more coin")} every 7 days`;
  }
}

/** A player's added-up perks as short lines, for the `/skills` summary. */
export function describePerks(perks: SkillPerks): string[] {
  const lines: string[] = [];
  const add = (perk: SkillPerk, suffix = "") =>
    lines.push(`${describePerk(perk)}${suffix}`);

  for (const [source, amount] of Object.entries(perks.earn)) {
    if (amount) {
      add({ kind: "earn_bonus", source: source as SkillEarnSource, amount });
    }
  }
  if (perks.powerUpDiscount > 0) {
    add({ kind: "power_up_discount", amount: perks.powerUpDiscount });
  }
  // A particular power-up's discount stacks on the all-power-ups one.
  const onTop = perks.powerUpDiscount > 0 ? " on top" : "";
  for (const [effect, amount] of Object.entries(perks.powerUpDiscounts)) {
    if (amount) {
      add(
        {
          kind: "power_up_discount",
          amount,
          powerUps: [effect as PowerUpKind],
        },
        onTop,
      );
    }
  }
  // Categories with the same discount read as one line.
  const byAmount = new Map<number, ShopCategory[]>();
  for (const [category, amount] of Object.entries(perks.shopDiscounts)) {
    if (amount) {
      byAmount.set(amount, [
        ...(byAmount.get(amount) ?? []),
        category as ShopCategory,
      ]);
    }
  }
  for (const [amount, categories] of byAmount) {
    add({ kind: "shop_discount", amount, categories });
  }
  if (perks.eggDiscount > 0) {
    add({ kind: "egg_discount", amount: perks.eggDiscount });
  }
  if (perks.eggLuck > 0) add({ kind: "egg_luck", amount: perks.eggLuck });
  if (perks.giftCap > 0) add({ kind: "gift_cap", amount: perks.giftCap });
  return lines;
}
