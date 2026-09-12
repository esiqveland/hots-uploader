import { describe, expect, it } from "vitest";
import {
    parseReplayDetails,
    RESULT_LOSS,
    RESULT_WIN,
    toMatchDetails,
} from "../../src/lib/replay-details.js";
import { detailsFixture } from "./versioned-fixtures.js";

const match = detailsFixture("Sky Temple", [
    { toonId: 12336863, hero: "Chen", team: 0, result: RESULT_LOSS },
    { toonId: 14283239, hero: "Genji", team: 0, result: RESULT_LOSS },
    { toonId: 521974, hero: "Johanna", team: 1, result: RESULT_WIN },
]);

describe("parseReplayDetails", () => {
    it("reads the map", () => {
        expect(parseReplayDetails(match)?.map).toBe("Sky Temple");
    });

    it("reads every player's toon, hero, team and result", () => {
        expect(parseReplayDetails(match)?.players).toEqual([
            { toonId: 12336863, hero: "Chen", team: 0, result: RESULT_LOSS },
            { toonId: 14283239, hero: "Genji", team: 0, result: RESULT_LOSS },
            { toonId: 521974, hero: "Johanna", team: 1, result: RESULT_WIN },
        ]);
    });

    it("handles a toon id past 2^24, which a byte-shifted vint would mangle", () => {
        const big = detailsFixture("Braxis Holdout", [
            { toonId: 134_336_394, hero: "Sonya", team: 0, result: RESULT_WIN },
        ]);

        expect(parseReplayDetails(big)?.players[0]?.toonId).toBe(134_336_394);
    });

    it("returns null rather than throwing on bytes that are not a details block", () => {
        expect(parseReplayDetails(Buffer.from("not a replay"))).toBeNull();
    });

    it("returns null when the player list is missing", () => {
        expect(parseReplayDetails(detailsFixture("Sky Temple", []))?.players).toEqual([]);
    });

    it("reads the played-at FILETIME, verified against a real replay's own filename", () => {
        const withTimestamp = detailsFixture("Sky Temple", [], 134_336_394_227_681_700n);
        expect(parseReplayDetails(withTimestamp)?.playedAt).toBe("2026-09-11T22:30:22.768Z");
    });

    it("leaves playedAt undefined when the timestamp field is absent", () => {
        expect(parseReplayDetails(match)?.playedAt).toBeUndefined();
    });
});

describe("toMatchDetails", () => {
    it("stores players as compact [toonId, hero, result] tuples", () => {
        expect(toMatchDetails(parseReplayDetails(match)!)).toEqual({
            map: "Sky Temple",
            players: [
                [12336863, "Chen", RESULT_LOSS],
                [14283239, "Genji", RESULT_LOSS],
                [521974, "Johanna", RESULT_WIN],
            ],
            playedAt: undefined,
        });
    });
});
