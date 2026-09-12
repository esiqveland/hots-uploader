import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHIVE_DIR_NAME } from "./filehandler.js";
import { sha512Base64 } from "./hash.js";
import { readReplayDetails, toMatchDetails } from "./replay-details.js";
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
    /** Replays whose match was read out of the file. */
    parsed: number;
}

export interface BackfillOptions {
    watchDir: string;
    state: StateFile;
    uploader: Uploader;
    signal?: AbortSignal;
    throttleMs?: number;
    /**
     * Look only at this many of the newest entries.
     *
     * Deliberately a window over the *history*, not a cap on how much work to do:
     * capping the work would walk further back into the history on every run, so
     * the eager pass would keep uploading replays at every startup instead of
     * going quiet once the visible rows are done.
     */
    scope?: number;
    /** Overrides "now" for the {@link LINK_MAX_AGE_MONTHS} cutoff. Tests only. */
    now?: Date;
    onProgress?: (progress: BackfillProgress) => void;
    onLog?: (message: string) => void;
}

export interface BackfillSummary extends BackfillProgress {
    /** Entries whose replay file is no longer on disk, so they can never be linked. */
    missing: number;
    /** Entries left unlinked on purpose, for being older than {@link LINK_MAX_AGE_MONTHS}. */
    tooOld: number;
    stopped: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isLinked = (entry: UploadState): boolean => entry.replay?.replay_id !== undefined;
// `playedAt` was added after `details` itself, so an entry parsed before then
// has a `details` block but no timestamp in it — re-reading picks it up, at no
// network cost, since the file is already on disk for the loop below.
const isParsed = (entry: UploadState): boolean =>
    entry.details !== undefined && entry.details.playedAt !== undefined;

/** Entries with nothing left to collect: they have a match id and a parsed match. */
const isComplete = (entry: UploadState): boolean => isLinked(entry) && isParsed(entry);

/**
 * Never send anything older than this to Heroes Profile: a replay from that far
 * back is unlikely to matter to anyone, and every request is load on a service
 * we do not run. `details.playedAt` is the true match date when it is known;
 * the file's own mtime (`ts`, always present) stands in until it is.
 */
const LINK_MAX_AGE_MONTHS = 12;

const bestKnownDate = (entry: UploadState): Date | undefined => {
    const date = new Date(entry.details?.playedAt ?? entry.ts);
    return Number.isNaN(date.getTime()) ? undefined : date;
};

/** Unknown age is never treated as "too old" — that would block linking forever. */
const isTooOldToLink = (entry: UploadState, now: Date): boolean => {
    const date = bestKnownDate(entry);
    if (date === undefined) {
        return false;
    }
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - LINK_MAX_AGE_MONTHS);
    return date < cutoff;
};

/** Entries that have no Heroes Profile match id yet, and are not too old to ever get one. */
export const needsBackfill = (state: StateFile, now: Date = new Date()): number =>
    state.states.filter((entry) => !isLinked(entry) && !isTooOldToLink(entry, now)).length;

/**
 * How many of the most recent entries the main window shows. The eager pass
 * covers exactly these, so the visible list is linked without a long run.
 */
export const FRONT_PAGE_ROWS = 10;

export interface ParseSummary {
    /** Entries missing details whose archived file was still on disk. */
    total: number;
    parsed: number;
    /** Entries missing details whose file is no longer on disk. */
    missing: number;
}

/**
 * Reads `details` — map, players, and the played-at timestamp — for every
 * history entry that is missing it, straight from the archived file on disk.
 *
 * Unlike `backfillReplayIds`, this never talks to Heroes Profile: matching a
 * replay to its Heroes Profile match id is a separate, opt-in concern (it costs
 * a request per replay), but reading a replay's own `details` block costs
 * nothing but a local file read, so it always runs.
 */
export const parseLocalDetails = async (options: {
    watchDir: string;
    state: StateFile;
    onLog?: (message: string) => void;
}): Promise<ParseSummary> => {
    const { watchDir, state } = options;
    const log = options.onLog ?? (() => {});
    const archiveDir = join(watchDir, ARCHIVE_DIR_NAME);

    let available: Set<string>;
    try {
        available = new Set(await readdir(archiveDir));
    } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        log(`Local parse: cannot read ${archiveDir}: ${error.message}`);
        return { total: 0, parsed: 0, missing: 0 };
    }

    const outstanding = state.states.filter((entry) => !isParsed(entry));
    const missing = outstanding.filter((entry) => !available.has(entry.name)).length;
    const work = outstanding.filter((entry) => available.has(entry.name));

    let parsed = 0;
    for (const entry of work) {
        const path = join(archiveDir, entry.name);
        try {
            const content = await readFile(path);
            // Same name, different bytes is possible (a restored backup, a
            // second file with a reused timestamp) — confirm before trusting it.
            if (sha512Base64(content) !== entry.sha256) {
                log(`Local parse: ${entry.name} on disk does not match its history entry`);
                continue;
            }
            const details = readReplayDetails(path);
            if (details !== null) {
                entry.details = toMatchDetails(details);
                parsed++;
                await state.save();
            }
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            log(`Local parse: ${entry.name} failed: ${error.message}`);
        }
    }

    if (work.length > 0) {
        log(`Local parse: read match data for ${parsed} of ${work.length} archived replays`);
    }
    return { total: work.length, parsed, missing };
};

/**
 * Re-submits archived replays, newest first, to collect their match ids.
 * Returns what it managed to do, including whether it was stopped early.
 */
export const backfillReplayIds = async (
    options: BackfillOptions,
): Promise<BackfillSummary> => {
    const { watchDir, state, uploader, signal, scope } = options;
    const log = options.onLog ?? (() => {});
    const throttleMs = options.throttleMs ?? THROTTLE_MS;
    const now = options.now ?? new Date();
    const archiveDir = join(watchDir, ARCHIVE_DIR_NAME);

    let available: Set<string>;
    try {
        available = new Set(await readdir(archiveDir));
    } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        log(`Cannot read ${archiveDir}: ${error.message}`);
        return { done: 0, total: 0, linked: 0, parsed: 0, missing: 0, tooOld: 0, stopped: false };
    }

    // The index is newest-first, so this is too. Entries with nothing left to
    // collect cost nothing to skip, which is what makes a stopped run resumable.
    // An entry that is linked but unparsed still has work: its match. Anything
    // too old is left alone entirely — even a fresh local parse is someone
    // else's job (parseLocalDetails), not this function's.
    const considered = scope === undefined ? state.states : state.states.slice(0, scope);
    const eligible = considered.filter((entry) => !isTooOldToLink(entry, now));
    const tooOld = considered.length - eligible.length;
    const outstanding = eligible.filter((entry) => !isComplete(entry));
    const missing = outstanding.filter((entry) => !available.has(entry.name)).length;
    const work = outstanding.filter((entry) => available.has(entry.name));

    log(
        `Backfill: ${work.length} replays to read`
        + (missing > 0 ? `, ${missing} with no file left on disk` : "")
        + (tooOld > 0 ? `, ${tooOld} too old to link` : ""),
    );

    const progress: BackfillProgress = { done: 0, total: work.length, linked: 0, parsed: 0 };
    options.onProgress?.({ ...progress });

    for (const entry of work) {
        if (signal?.aborted) {
            log(`Backfill stopped after ${progress.done} of ${progress.total}`);
            return { ...progress, missing, tooOld, stopped: true };
        }

        const path = join(archiveDir, entry.name);
        let didUpload = false;

        try {
            const content = await readFile(path);

            // Replay names embed a timestamp, but two entries could still share
            // one. Hashing confirms this really is the file the entry describes
            // before anything is written onto it.
            if (sha512Base64(content) !== entry.sha256) {
                log(`Backfill: ${entry.name} on disk does not match its history entry`);
            } else {
                let changed = false;

                if (!isParsed(entry)) {
                    const details = readReplayDetails(path);
                    if (details !== null) {
                        entry.details = toMatchDetails(details);
                        progress.parsed++;
                        changed = true;
                    }
                }

                // Only an unlinked entry costs a request. One that just needed
                // its match read is finished locally, at full speed.
                if (!isLinked(entry)) {
                    const result = await uploader.upload(entry.name, content);
                    entry.replay = {
                        fingerprint: result.fingerprint,
                        replay_id: result.replayId,
                        status: result.status,
                    };
                    if (result.replayId !== undefined) {
                        progress.linked++;
                    }
                    didUpload = true;
                    changed = true;
                }

                if (changed) {
                    await state.save();
                }
            }
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            log(`Backfill: ${entry.name} failed: ${error.message}`);
        }

        progress.done++;
        options.onProgress?.({ ...progress });

        // Throttle the network, not the disk.
        if (didUpload && progress.done < progress.total) {
            await sleep(throttleMs);
        }
    }

    log(
        `Backfill finished: linked ${progress.linked}, read ${progress.parsed} matches,`
        + ` of ${progress.total}`,
    );
    return { ...progress, missing, tooOld, stopped: false };
};
