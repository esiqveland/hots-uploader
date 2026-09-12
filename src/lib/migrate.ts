import { access, readFile } from "node:fs/promises";
import { StateFile } from "./state.js";
import { stateFile } from "./paths.js";

const exists = async (path: string): Promise<boolean> => {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
};

/**
 * Adopts an upload history written by the Go CLI this app replaces, so replays it
 * already uploaded are not uploaded again.
 *
 * The Go version wrote `state.json` relative to whatever directory it ran from,
 * so there is no location worth guessing: the file is imported only when its path
 * is given with `--import-state`. Returns how many entries were imported, and
 * does nothing if a history already exists.
 */
export const importState = async (
    source: string | undefined,
    target: string = stateFile(),
): Promise<number> => {
    if (source === undefined || (await exists(target))) {
        return 0;
    }
    if (!(await exists(source))) {
        return 0;
    }

    const imported = StateFile.fromJson(await readFile(source, "utf8"), target);
    if (imported.states.length === 0) {
        return 0;
    }
    await imported.save();
    return imported.states.length;
};
