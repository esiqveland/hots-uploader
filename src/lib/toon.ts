import type { ReplayDetails } from "./replay-details.js";

/**
 * Heroes of the Storm stores replays under a folder that names the account:
 * `…/Accounts/<blizzId>/<region>-Hero-<realm>-<toonId>/Replays/Multiplayer`.
 * The last number is the toon id that appears in every replay's player list.
 */
const ACCOUNT_FOLDER = /(?:^|\/)\d+-Hero-\d+-(\d+)(?:\/|$)/;

export const parseToonIdFromPath = (path: string): number | undefined => {
    const match = ACCOUNT_FOLDER.exec(path);
    const id = match === null ? Number.NaN : Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/**
 * The toon appearing in the most replays. You are the only player in all of
 * them, so with more than a couple of replays this is unambiguous.
 */
export const mostCommonToonId = (
    details: readonly ReplayDetails[],
): number | undefined => {
    const counts = new Map<number, number>();
    for (const replay of details) {
        for (const player of replay.players) {
            counts.set(player.toonId, (counts.get(player.toonId) ?? 0) + 1);
        }
    }

    let best: number | undefined;
    let bestCount = 0;
    for (const [toonId, count] of counts) {
        if (count > bestCount) {
            best = toonId;
            bestCount = count;
        }
    }
    // One replay tells us nothing: ten players would each appear once.
    return details.length > 1 && bestCount > 1 ? best : undefined;
};

export interface ToonSources {
    /** Set by hand in Preferences. Always wins, so a bad guess is correctable. */
    configured?: number;
    watchDir?: string;
    parsed?: readonly ReplayDetails[];
}

export interface ResolvedToon {
    toonId?: number;
    /** Where it came from, so Preferences can say whether detection worked. */
    source: "configured" | "path" | "replays" | "none";
}

export const resolveToonId = ({ configured, watchDir, parsed }: ToonSources): ResolvedToon => {
    if (configured !== undefined && configured > 0) {
        return { toonId: configured, source: "configured" };
    }

    const fromPath = watchDir === undefined ? undefined : parseToonIdFromPath(watchDir);
    if (fromPath !== undefined) {
        return { toonId: fromPath, source: "path" };
    }

    const fromReplays = parsed === undefined ? undefined : mostCommonToonId(parsed);
    if (fromReplays !== undefined) {
        return { toonId: fromReplays, source: "replays" };
    }

    return { source: "none" };
};
