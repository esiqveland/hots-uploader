import { readFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configFile, ensureDir } from "./paths.js";

export interface Config {
    /** Directory to watch for new `.StormReplay` files. Empty means unconfigured. */
    watchDir: string;
    /** Upload attempts before giving up. The Go default was 5. */
    maxTries: number;
    /** Begin watching as soon as the app starts. */
    autoStart: boolean;
    /**
     * Your Heroes of the Storm player (toon) id, set by hand when it cannot be
     * detected. Undefined means "work it out automatically".
     */
    toonId?: number;
    /**
     * Keep looking up Heroes Profile match links for the whole history in the
     * background. The visible rows are always linked; this covers the rest, which
     * is hundreds of requests, so it is opt-in.
     */
    linkAllReplays: boolean;
    /** Size the window was last left at. */
    windowWidth: number;
    windowHeight: number;
    windowMaximized: boolean;
}

export const defaultConfig: Config = {
    watchDir: "",
    maxTries: 5,
    autoStart: true,
    linkAllReplays: false,
    windowWidth: 700,
    windowHeight: 550,
    windowMaximized: false,
};

export const configError = (config: Config): string | null => {
    if (config.watchDir === "") {
        return "No replay folder selected";
    }
    if (config.maxTries <= 0) {
        return "Max retries must be greater than 0";
    }
    return null;
};

/**
 * Read synchronously at startup, so the window is created at the size it was left
 * at. Setting a GTK window's default size after it is on screen does not resize
 * it, so this value cannot arrive a tick late.
 */
export const loadConfigSync = (path: string = configFile()): Config => {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Config> | null;
        return { ...defaultConfig, ...parsed };
    } catch {
        return { ...defaultConfig };
    }
};

export const loadConfig = async (path: string = configFile()): Promise<Config> => {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<Config> | null;
        return { ...defaultConfig, ...parsed };
    } catch {
        return { ...defaultConfig };
    }
};

export const saveConfig = async (config: Config, path: string = configFile()): Promise<void> => {
    await ensureDir(dirname(path));
    const temp = join(dirname(path), `.${process.pid}.config.json.tmp`);
    await writeFile(temp, JSON.stringify(config, null, 4), "utf8");
    await rename(temp, path);
};
