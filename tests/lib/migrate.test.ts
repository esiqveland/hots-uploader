import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importState } from "../../src/lib/migrate.js";

const history = (names: string[]) =>
    JSON.stringify({
        states: names.map((name) => ({
            name,
            sha256: name,
            seen_at: "2024-11-11T23:38:06.011Z",
            ts: "2024-11-11T23:38:05.092Z",
            is_uploaded: true,
        })),
    });

describe("importState", () => {
    let dir: string;
    let source: string;
    let target: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "hots-import-"));
        source = join(dir, "go-state.json");
        target = join(dir, "state.json");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("imports a history handed over explicitly", async () => {
        await writeFile(source, history(["a.StormReplay", "b.StormReplay"]));

        expect(await importState(source, target)).toBe(2);
        expect(JSON.parse(await readFile(target, "utf8")).states).toHaveLength(2);
    });

    // Nothing is guessed: the Go uploader wrote state.json relative to whatever
    // directory it ran from, so there is no path worth assuming.
    it("does nothing when no source is given", async () => {
        expect(await importState(undefined, target)).toBe(0);
    });

    it("does nothing when the source does not exist", async () => {
        expect(await importState(join(dir, "nope.json"), target)).toBe(0);
    });

    it("never overwrites an existing history", async () => {
        await writeFile(source, history(["new.StormReplay"]));
        await writeFile(target, history(["mine.StormReplay"]));

        expect(await importState(source, target)).toBe(0);
        expect(JSON.parse(await readFile(target, "utf8")).states[0].name).toBe("mine.StormReplay");
    });

    it("ignores an empty history", async () => {
        await writeFile(source, JSON.stringify({ states: [] }));

        expect(await importState(source, target)).toBe(0);
    });
});
