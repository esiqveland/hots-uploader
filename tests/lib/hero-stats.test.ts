import { describe, expect, it } from "vitest";
import { heroStatsOf } from "../../src/lib/hero-stats.js";
import type { ReplayEntry } from "../../src/hooks/use-uploader.js";

const entry = (overrides: Partial<ReplayEntry>): ReplayEntry => ({
    name: "replay.StormReplay",
    status: "uploaded",
    at: "2026-09-12T00:00:00.000Z",
    ...overrides,
});

describe("heroStatsOf", () => {
    it("aggregates wins, losses and win rate per hero", () => {
        const entries = [
            entry({ name: "a", hero: "Tyrande", outcome: "win" }),
            entry({ name: "b", hero: "Tyrande", outcome: "loss" }),
            entry({ name: "c", hero: "Tyrande", outcome: "win" }),
            entry({ name: "d", hero: "Muradin", outcome: "win" }),
        ];

        expect(heroStatsOf(entries)).toEqual([
            { hero: "Tyrande", games: 3, wins: 2, losses: 1, winRate: 67 },
            { hero: "Muradin", games: 1, wins: 1, losses: 0, winRate: 100 },
        ]);
    });

    it("sorts by games played, most first", () => {
        const entries = [
            entry({ name: "a", hero: "Muradin", outcome: "win" }),
            entry({ name: "b", hero: "Tyrande", outcome: "win" }),
            entry({ name: "c", hero: "Tyrande", outcome: "loss" }),
        ];

        expect(heroStatsOf(entries).map((s) => s.hero)).toEqual(["Tyrande", "Muradin"]);
    });

    it("excludes entries with no resolved hero", () => {
        const entries = [entry({ name: "a", outcome: "win" })];

        expect(heroStatsOf(entries)).toEqual([]);
    });

    it("excludes a hero whose games all lack a known outcome", () => {
        const entries = [entry({ name: "a", hero: "Muradin" })];

        expect(heroStatsOf(entries)).toEqual([]);
    });

    it("does not count an unparsed game towards a hero's games", () => {
        const entries = [
            entry({ name: "a", hero: "Muradin", outcome: "win" }),
            entry({ name: "b", hero: "Muradin" }),
        ];

        expect(heroStatsOf(entries)).toEqual([
            { hero: "Muradin", games: 1, wins: 1, losses: 0, winRate: 100 },
        ]);
    });

    it("returns an empty list for no entries", () => {
        expect(heroStatsOf([])).toEqual([]);
    });
});
