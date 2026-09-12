import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, loadConfigSync, saveConfig } from "../../src/lib/config.js";

describe("config", () => {
    let dir: string;
    let path: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "hots-config-"));
        path = join(dir, "config.json");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("defaults the window to 700x550, unmaximized", () => {
        expect(defaultConfig.windowWidth).toBe(700);
        expect(defaultConfig.windowHeight).toBe(550);
        expect(defaultConfig.windowMaximized).toBe(false);
    });

    it("round-trips the window size", async () => {
        await saveConfig(
            { ...defaultConfig, windowWidth: 1024, windowHeight: 768, windowMaximized: true },
            path,
        );

        expect(loadConfigSync(path)).toMatchObject({
            windowWidth: 1024,
            windowHeight: 768,
            windowMaximized: true,
        });
        expect(await loadConfig(path)).toMatchObject({ windowWidth: 1024, windowHeight: 768 });
    });

    it("falls back to defaults when the file is missing", () => {
        expect(loadConfigSync(join(dir, "nope.json"))).toEqual(defaultConfig);
    });

    it("falls back to defaults when the file is corrupt", async () => {
        await writeFile(path, "{not json");

        expect(loadConfigSync(path)).toEqual(defaultConfig);
    });

    it("fills in fields a config written by an older version is missing", async () => {
        await writeFile(path, JSON.stringify({ watchDir: "/replays", maxTries: 9 }));

        expect(loadConfigSync(path)).toEqual({
            ...defaultConfig,
            watchDir: "/replays",
            maxTries: 9,
        });
    });
});
