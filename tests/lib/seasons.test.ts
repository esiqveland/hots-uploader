import { describe, expect, it } from "vitest";
import { seasonOf } from "../../src/lib/seasons.js";

describe("seasonOf", () => {
    it("returns undefined before the first confirmed season", () => {
        expect(seasonOf(new Date("2025-02-01T23:59:59Z"))).toBeUndefined();
    });

    it("matches every confirmed season from Nexus Compendium", () => {
        expect(seasonOf(new Date("2025-03-01T00:00:00Z"))?.name).toBe("2025 Season 1");
        expect(seasonOf(new Date("2025-07-01T00:00:00Z"))?.name).toBe("2025 Season 2");
        expect(seasonOf(new Date("2025-11-01T00:00:00Z"))?.name).toBe("2025 Season 3");
        expect(seasonOf(new Date("2026-03-01T00:00:00Z"))?.name).toBe("2026 Season 1");
    });

    it("is inclusive of a season's start and exclusive of its end", () => {
        expect(seasonOf(new Date("2025-02-02T00:00:00Z"))?.name).toBe("2025 Season 1");
        expect(seasonOf(new Date("2025-06-01T23:59:59.999Z"))?.name).toBe("2025 Season 1");
        expect(seasonOf(new Date("2025-06-02T00:00:00Z"))?.name).toBe("2025 Season 2");
    });

    it("projects forward past the last confirmed season using the observed cadence", () => {
        // 2026 Season 1 ends 2026-06-02; nothing newer is published yet.
        expect(seasonOf(new Date("2026-07-01T00:00:00Z"))?.name).toBe("2026 Season 2");
        expect(seasonOf(new Date("2026-09-12T00:00:00Z"))?.name).toBe("2026 Season 2");
        expect(seasonOf(new Date("2026-11-01T00:00:00Z"))?.name).toBe("2026 Season 3");
        expect(seasonOf(new Date("2027-03-01T00:00:00Z"))?.name).toBe("2027 Season 1");
    });

    it("projected boundaries stay on the 2nd of Feb/Jun/Oct", () => {
        const season = seasonOf(new Date("2026-09-12T00:00:00Z"));
        expect(season?.start.toISOString()).toBe("2026-06-02T00:00:00.000Z");
        expect(season?.end.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    });
});
