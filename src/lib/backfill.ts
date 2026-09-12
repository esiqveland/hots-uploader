import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHIVE_DIR_NAME } from "./filehandler.js";
import { sha512Base64 } from "./hash.js";
import type { StateFile, UploadState } from "./state.js";
import type { Uploader } from "./uploader.js";

/**
 * Heroes Profile answers a re-upload of a known replay with `Duplicate` plus its
 * `replayID`, so the only way to learn the id of a replay uploaded before we
 * started recording it is to send the file again.
 *
 * Work is driven by the history index rather than by the archive directory, for
 * two reasons: the index is already newest-first, so the replays on screen are
 * linked first instead of last; and each entry already knows its file, so nothing
 * has to hash the whole archive just to work out what it is looking at.
 */
const THROTTLE_MS = 1_000;

export interface BackfillProgress {
    done: number;
    total: number;
    linked: number;
}

export interface BackfillOptions {
    watchDir: string;
    state: StateFile;
    uploader: Uploader;
    signal?: AbortSignal;
    throttleMs?: number;
    /** Stop after this many entries. Used for the eager pass over visible rows. */
    limit?: number;
    onProgress?: (progress: BackfillProgress) => void;
    onLog?: (message: string) => void;
}

export interface BackfillSummary extends BackfillProgress {
    /** Entries whose replay file is no longer on disk, so they can never be linked. */
    missing: number;
    stopped: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isLinked = (entry: UploadState): boolean => entry.replay?.replay_id !== undefined;

/** Entries that have no Heroes Profile match id yet. */
export const needsBackfill = (state: StateFile): number =>
    state.states.filter((entry) => !isLinked(entry)).length;

/**
 * How many of the most recent entries the main window shows. The eager pass
 * covers exactly these, so the visible list is linked without a long run.
 */
export const FRONT_PAGE_ROWS = 10;

/**
 * Re-submits archived replays, newest first, to collect their match ids.
 * Returns what it managed to do, including whether it was stopped early.
 */
export const backfillReplayIds = async (
    options: BackfillOptions,
): Promise<BackfillSummary> => {
    const { watchDir, state, uploader, signal, limit } = options;
    const log = options.onLog ?? (() => {});
    const throttleMs = options.throttleMs ?? THROTTLE_MS;
    const archiveDir = join(watchDir, ARCHIVE_DIR_NAME);

    let available: Set<string>;
    try {
        available = new Set(await readdir(archiveDir));
    } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        log(`Cannot read ${archiveDir}: ${error.message}`);
        return { done: 0, total: 0, linked: 0, missing: 0, stopped: false };
    }

    // The index is newest-first, so this is too. Entries already linked cost
    // nothing to skip, which is what makes a stopped run resumable.
    const unlinked = state.states.filter((entry) => !isLinked(entry));
    const missing = unlinked.filter((entry) => !available.has(entry.name)).length;
    const candidates = unlinked.filter((entry) => available.has(entry.name));
    const work = limit === undefined ? candidates : candidates.slice(0, limit);

    log(
        `Backfill: ${work.length} replays to link`
        + (missing > 0 ? `, ${missing} with no file left on disk` : ""),
    );

    const progress: BackfillProgress = { done: 0, total: work.length, linked: 0 };
    options.onProgress?.({ ...progress });

    for (const entry of work) {
        if (signal?.aborted) {
            log(`Backfill stopped after ${progress.done} of ${progress.total}`);
            return { ...progress, missing, stopped: true };
        }

        try {
            const content = await readFile(join(archiveDir, entry.name));

            // Replay names embed a timestamp, but two entries could still share
            // one. Hashing confirms this really is the file the entry describes
            // before its id is written onto it.
            if (sha512Base64(content) !== entry.sha256) {
                log(`Backfill: ${entry.name} on disk does not match its history entry`);
            } else {
                const result = await uploader.upload(entry.name, content);
                entry.replay = {
                    fingerprint: result.fingerprint,
                    replay_id: result.replayId,
                    status: result.status,
                };
                if (result.replayId !== undefined) {
                    progress.linked++;
                }
                await state.save();
            }
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            log(`Backfill: ${entry.name} failed: ${error.message}`);
        }

        progress.done++;
        options.onProgress?.({ ...progress });

        if (progress.done < progress.total) {
            await sleep(throttleMs);
        }
    }

    log(`Backfill finished: linked ${progress.linked} of ${progress.total}`);
    return { ...progress, missing, stopped: false };
};
