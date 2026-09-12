import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export const APP_DIR_NAME = "hotsreplayuploader";

const xdgDir = (envVar: string, fallback: string): string => {
    const value = process.env[envVar];
    return value && value.length > 0 ? value : join(homedir(), ...fallback.split("/"));
};

/** `$XDG_CONFIG_HOME/hotsreplayuploader`, falling back to `~/.config/hotsreplayuploader`. */
export const configDir = (): string => join(xdgDir("XDG_CONFIG_HOME", ".config"), APP_DIR_NAME);

/** `$XDG_DATA_HOME/hotsreplayuploader`, falling back to `~/.local/share/hotsreplayuploader`. */
export const dataDir = (): string => join(xdgDir("XDG_DATA_HOME", ".local/share"), APP_DIR_NAME);

export const configFile = (): string => join(configDir(), "config.json");
export const stateFile = (): string => join(dataDir(), "state.json");

export const ensureDir = async (dir: string): Promise<void> => {
    await mkdir(dir, { recursive: true });
};
