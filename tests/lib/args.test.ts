import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/lib/args.js";

describe("parseArgs", () => {
    it("returns nothing to override when given no arguments", () => {
        expect(parseArgs([])).toEqual({ help: false });
    });

    it("accepts --dir with a separate value", () => {
        expect(parseArgs(["--dir", "/replays"]).watchDir).toBe("/replays");
    });

    it("accepts --dir=value", () => {
        expect(parseArgs(["--dir=/replays"]).watchDir).toBe("/replays");
    });

    it("accepts the -dir spelling the Go version used", () => {
        expect(parseArgs(["-dir", "/replays"]).watchDir).toBe("/replays");
    });

    it("accepts the -d short flag", () => {
        expect(parseArgs(["-d", "/replays"]).watchDir).toBe("/replays");
    });

    it("keeps paths containing spaces and equals signs intact", () => {
        const path = "/games/Heroes of the Storm/Replays/Multiplayer";
        expect(parseArgs(["--dir", path]).watchDir).toBe(path);
        expect(parseArgs([`--dir=${path}=x`]).watchDir).toBe(`${path}=x`);
    });

    it("recognises --help", () => {
        expect(parseArgs(["--help"]).help).toBe(true);
        expect(parseArgs(["-h"]).help).toBe(true);
    });

    it("ignores flags it does not know", () => {
        expect(parseArgs(["--inspect", "--port=3000", "extra"])).toEqual({ help: false });
    });

    it("ignores --dir with no value", () => {
        expect(parseArgs(["--dir"]).watchDir).toBeUndefined();
        expect(parseArgs(["--dir="]).watchDir).toBeUndefined();
    });

    it("lets a later --dir win", () => {
        expect(parseArgs(["--dir", "/a", "--dir", "/b"]).watchDir).toBe("/b");
    });

    it("reads --import-state", () => {
        expect(parseArgs(["--import-state", "/tmp/state.json"]).importState).toBe(
            "/tmp/state.json",
        );
        expect(parseArgs(["--import-state=/tmp/state.json"]).importState).toBe("/tmp/state.json");
    });

    it("ignores --import-state with no value", () => {
        expect(parseArgs(["--import-state"]).importState).toBeUndefined();
    });
});
