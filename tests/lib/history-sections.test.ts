import { describe, expect, it } from "vitest";
import { groupBySeason } from "../../src/lib/history-sections.js";
import type { ReplayEntry } from "../../src/hooks/use-uploader.js";

const entry = (overrides: Partial<ReplayEntry>): ReplayEntry => ({
    name: "replay.StormReplay",
    status: "uploaded",
    at: "2026-09-12T00:00:00.000Z",
    ...overrides,
});

describe("groupBySeason", () => {
    it("inserts one header per run of same-season entries, without re-sorting", () => {
        const entries = [
            entry({ name: "a", playedAt: "2026-07-01T00:00:00Z" }), // 2026 S2
            entry({ name: "b", playedAt: "2026-06-30T00:00:00Z" }), // 2026 S2
            entry({ name: "c", playedAt: "2026-01-01T00:00:00Z" }), // 2025 S3
        ];

        expect(groupBySeason(entries)).toEqual([
            { kind: "header", label: "2026 Season 2" },
            { kind: "entry", index: 0 },
            { kind: "entry", index: 1 },
            { kind: "header", label: "2025 Season 3" },
            { kind: "entry", index: 2 },
        ]);
    });

    it("groups entries with no playedAt under Unknown season", () => {
        const entries = [entry({ name: "a" }), entry({ name: "b" })];

        expect(groupBySeason(entries)).toEqual([
            { kind: "header", label: "Unknown season" },
            { kind: "entry", index: 0 },
            { kind: "entry", index: 1 },
        ]);
    });

    it("starts a new section when the season changes back and forth", () => {
        const entries = [
            entry({ name: "a", playedAt: "2026-07-01T00:00:00Z" }), // 2026 S2
            entry({ name: "b" }), // unknown
            entry({ name: "c", playedAt: "2026-06-30T00:00:00Z" }), // 2026 S2
        ];

        expect(groupBySeason(entries).map((r) => r.kind)).toEqual([
            "header",
            "entry",
            "header",
            "entry",
            "header",
            "entry",
        ]);
    });

    it("returns an empty list for no entries", () => {
        expect(groupBySeason([])).toEqual([]);
    });
});
