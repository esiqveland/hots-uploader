import type { ReplayEntry } from "../hooks/use-uploader.js";
import { seasonOf } from "./seasons.js";

export type HistoryRow = { kind: "header"; label: string } | { kind: "entry"; index: number };

const UNKNOWN_SEASON = "Unknown season";

/**
 * Replays without a parsed `playedAt` group under "Unknown season" rather than
 * being guessed into whichever season is nearby.
 */
const seasonLabelFor = (entry: ReplayEntry): string =>
    entry.playedAt === undefined ? UNKNOWN_SEASON : (seasonOf(new Date(entry.playedAt))?.name ?? UNKNOWN_SEASON);

/**
 * Splits the (already newest-first) history into season-headed sections. A
 * header is inserted wherever the season differs from the row above it, so the
 * list is never re-sorted — just as `StateFile`'s own newest-first order is
 * never re-sorted for display.
 */
export const groupBySeason = (entries: readonly ReplayEntry[]): HistoryRow[] => {
    const rows: HistoryRow[] = [];
    let lastLabel: string | undefined;
    entries.forEach((entry, index) => {
        const label = seasonLabelFor(entry);
        if (label !== lastLabel) {
            rows.push({ kind: "header", label });
            lastLabel = label;
        }
        rows.push({ kind: "entry", index });
    });
    return rows;
};
