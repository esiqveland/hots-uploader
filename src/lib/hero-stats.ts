import type { ReplayEntry } from "../hooks/use-uploader.js";
import { recordOf } from "./record.js";

export interface HeroStat {
    hero: string;
    games: number;
    wins: number;
    losses: number;
    winRate: number;
}

/**
 * Wins, losses and win rate per hero, sorted by games played (most first).
 *
 * `games` is the number of entries with a known outcome, not the raw entry
 * count, so it always agrees with `wins + losses` — a hero with an unparsed
 * replay doesn't get an inflated games count.
 */
export const heroStatsOf = (entries: readonly ReplayEntry[]): HeroStat[] => {
    const outcomesByHero = new Map<string, ("win" | "loss" | undefined)[]>();
    for (const entry of entries) {
        if (entry.hero === undefined) {
            continue;
        }
        const outcomes = outcomesByHero.get(entry.hero) ?? [];
        outcomes.push(entry.outcome);
        outcomesByHero.set(entry.hero, outcomes);
    }

    return [...outcomesByHero.entries()]
        .map(([hero, outcomes]) => {
            const record = recordOf(outcomes, Number.POSITIVE_INFINITY);
            return {
                hero,
                games: record.total,
                wins: record.wins,
                losses: record.losses,
                winRate: record.winRate,
            };
        })
        .filter((stat) => stat.games > 0)
        .sort((a, b) => b.games - a.games);
};
