import { describe, expect, it } from "vitest";
import type { ReplayDetails } from "../../src/lib/replay-details.js";
import { mostCommonToonId, parseToonIdFromPath, resolveToonId } from "../../src/lib/toon.js";

const WATCH_DIR =
    "/games/prefix/drive_c/users/me/Documents/Heroes of the Storm"
    + "/Accounts/1564242/2-Hero-1-12336863/Replays/Multiplayer";

const replay = (...toonIds: number[]): ReplayDetails => ({
    map: "Sky Temple",
    players: toonIds.map((toonId) => ({ toonId, hero: "Chen", team: 0, result: 1 })),
});

describe("parseToonIdFromPath", () => {
    it("takes the id out of the account folder", () => {
        expect(parseToonIdFromPath(WATCH_DIR)).toBe(12336863);
    });

    it("works for other regions and realms", () => {
        expect(parseToonIdFromPath("/x/Accounts/1107983297/2-Hero-1-13481373/Replays")).toBe(
            13481373,
        );
        expect(parseToonIdFromPath("/x/Accounts/9/5-Hero-2-777/Replays/Multiplayer")).toBe(777);
    });

    it("gives up on a folder that is not laid out that way", () => {
        expect(parseToonIdFromPath("/home/me/replays")).toBeUndefined();
        expect(parseToonIdFromPath("")).toBeUndefined();
    });
});

describe("mostCommonToonId", () => {
    it("finds the player present in every replay", () => {
        expect(mostCommonToonId([replay(1, 2, 3), replay(1, 4, 5), replay(1, 6, 7)])).toBe(1);
    });

    // With one replay every player appears exactly once, so there is no signal.
    it("refuses to guess from a single replay", () => {
        expect(mostCommonToonId([replay(1, 2, 3)])).toBeUndefined();
    });

    it("returns nothing for no replays", () => {
        expect(mostCommonToonId([])).toBeUndefined();
    });
});

describe("resolveToonId", () => {
    it("prefers the configured id, so a wrong guess is correctable", () => {
        expect(
            resolveToonId({ configured: 999, watchDir: WATCH_DIR, parsed: [replay(1, 1)] }),
        ).toEqual({ toonId: 999, source: "configured" });
    });

    it("falls back to the watch folder", () => {
        expect(resolveToonId({ watchDir: WATCH_DIR })).toEqual({
            toonId: 12336863,
            source: "path",
        });
    });

    it("falls back to the most common player when the folder says nothing", () => {
        expect(
            resolveToonId({ watchDir: "/home/me/replays", parsed: [replay(1, 2), replay(1, 3)] }),
        ).toEqual({ toonId: 1, source: "replays" });
    });

    it("reports that it could not work it out, rather than picking wrongly", () => {
        expect(resolveToonId({})).toEqual({ source: "none" });
        expect(resolveToonId({ configured: 0, watchDir: "/home/me/replays" })).toEqual({
            source: "none",
        });
    });
});
