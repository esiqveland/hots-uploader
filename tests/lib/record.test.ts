import { describe, expect, it } from "vitest";
import { recordOf } from "../../src/lib/record.js";

const repeat = (outcome: "win" | "loss", n: number) => Array.from({ length: n }, () => outcome);

describe("recordOf", () => {
    it("counts wins and losses and works out the rate", () => {
        expect(recordOf(["win", "loss", "win", "win"])).toEqual({
            wins: 3,
            losses: 1,
            total: 4,
            winRate: 75,
        });
    });

    it("stops at the window, counting the most recent games", () => {
        const record = recordOf([...repeat("win", 100), ...repeat("loss", 50)]);

        expect(record).toEqual({ wins: 100, losses: 0, total: 100, winRate: 100 });
    });

    // Games with no known result must not be counted as losses.
    it("skips games with no result, and keeps filling the window past them", () => {
        const record = recordOf(["win", undefined, "loss", undefined, "win"]);

        expect(record).toEqual({ wins: 2, losses: 1, total: 3, winRate: 67 });
    });

    it("reports nothing rather than dividing by zero", () => {
        expect(recordOf([])).toEqual({ wins: 0, losses: 0, total: 0, winRate: 0 });
        expect(recordOf([undefined, undefined])).toEqual({
            wins: 0,
            losses: 0,
            total: 0,
            winRate: 0,
        });
    });

    it("rounds the rate to a whole percent", () => {
        expect(recordOf([...repeat("win", 1), ...repeat("loss", 2)]).winRate).toBe(33);
        expect(recordOf([...repeat("win", 395), ...repeat("loss", 408)], 803).winRate).toBe(49);
    });

    it("honours a smaller window", () => {
        expect(recordOf(["win", "loss", "loss"], 2)).toMatchObject({ total: 2, winRate: 50 });
    });
});
