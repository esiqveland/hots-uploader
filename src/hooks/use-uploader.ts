import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { processArgs } from "../lib/args.js";
import { formatTime } from "../lib/format.js";
import { RESULT_LOSS, RESULT_WIN } from "../lib/replay-details.js";
import { resolveToonId, type ResolvedToon } from "../lib/toon.js";
import { type Config, loadConfigSync, saveConfig } from "../lib/config.js";
import { FileHandler } from "../lib/filehandler.js";
import {
    backfillReplayIds,
    FRONT_PAGE_ROWS,
    needsBackfill,
    parseLocalDetails,
    type BackfillProgress,
} from "../lib/backfill.js";
import { importState } from "../lib/migrate.js";
import { sortableTime, StateFile, type UploadState } from "../lib/state.js";
import { Uploader } from "../lib/uploader.js";
import { ReplayWatcher, type WatcherStatus } from "../lib/watcher.js";

export type EntryStatus = "uploading" | "uploaded" | "rejected" | "failed";

export interface ReplayEntry {
    name: string;
    status: EntryStatus;
    /** When it was uploaded, or when the attempt failed. */
    at: string;
    detail?: string;
    /** Heroes Profile's match id, when we have one. */
    replayId?: number;
    /** The map, when the replay file has been read. */
    map?: string;
    /** Your hero and outcome, worked out from the player id. */
    hero?: string;
    outcome?: "win" | "loss";
    /** When the game was played, ISO, when the replay file has been read. */
    playedAt?: string;
}

export interface Notice {
    id: number;
    text: string;
}

/** Keeps the log pane bounded; it is a rolling view, not an archive. */
const MAX_LOG_LINES = 500;

/** How long to coalesce config writes, so a drag-resize writes once. */
const SAVE_DEBOUNCE_MS = 400;

const outcomeOf = (result: number): "win" | "loss" | undefined =>
    result === RESULT_WIN ? "win" : result === RESULT_LOSS ? "loss" : undefined;

/**
 * Your hero and result are worked out here, not stored, so correcting the player
 * id fixes every row at once without re-reading a single replay.
 *
 * Also used to build the row for a single entry as the watcher hands it off, so
 * an in-flight or just-finished replay shows its map and hero immediately rather
 * than waiting for the next full reload from state.
 */
const toEntry = (s: UploadState, toonId: number | undefined): ReplayEntry => {
    const mine =
        toonId === undefined ? undefined : s.details?.players.find(([id]) => id === toonId);
    return {
        name: s.name,
        // A verdict without is_uploaded means Heroes Profile turned it down;
        // anything else unfinished is a failed attempt.
        status: s.is_uploaded ? "uploaded" : s.replay?.status ? "rejected" : "failed",
        at: s.seen_at,
        detail: s.is_uploaded ? undefined : s.replay?.status,
        replayId: s.replay?.replay_id,
        map: s.details?.map,
        hero: mine?.[1],
        outcome: mine === undefined ? undefined : outcomeOf(mine[2]),
        playedAt: s.details?.playedAt,
    } satisfies ReplayEntry;
};

/**
 * `state.states` is newest-first by construction, but not guaranteed to stay
 * that way — a detail read after the entry was added (a local parse, a
 * backfill) can reveal a truer date without moving the entry — so the render
 * path sorts explicitly rather than trusting the array order.
 */
const toEntries = (state: StateFile, toonId: number | undefined): ReplayEntry[] =>
    [...state.states]
        .sort((a, b) => sortableTime(b) - sortableTime(a))
        .map((s) => toEntry(s, toonId));

/** Mirrors {@link sortableTime} for a `ReplayEntry`, which has no file mtime of
 * its own — `at` (when it was seen or the attempt settled) stands in for it. */
const entryTime = (entry: ReplayEntry): number => {
    const date = new Date(entry.playedAt ?? entry.at);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

/**
 * Owns the uploader backend and mirrors it into React state.
 *
 * The watcher is rebuilt whenever the watched folder or retry count changes;
 * upload history is loaded once and shared across rebuilds.
 */
export const useUploader = () => {
    // Loaded synchronously so the window opens at its saved size, and so a --dir
    // on the command line is in effect before the first render.
    const [config, setConfig] = useState<Config>(() => {
        const loaded = loadConfigSync();
        const { watchDir } = processArgs();
        if (watchDir === undefined || watchDir === loaded.watchDir) {
            return loaded;
        }
        const overridden = { ...loaded, watchDir };
        void saveConfig(overridden);
        return overridden;
    });
    const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
    const [entries, setEntries] = useState<ReplayEntry[]>([]);
    const [status, setStatus] = useState<WatcherStatus>("stopped");
    const [log, setLog] = useState<string[]>([]);
    const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
    /** Bumped when background work changes the history, to re-derive the rows. */
    const [entriesVersion, setEntriesVersion] = useState(0);
    const backfillAbort = useRef<AbortController | null>(null);

    const stateRef = useRef<StateFile | null>(null);
    const [toon, setToon] = useState<ResolvedToon>({ source: "none" });
    // Read by the watcher's callbacks, which are rebuilt only when the watched
    // folder or retry count change, not on every toon resolution.
    const toonRef = useRef<number | undefined>(undefined);
    toonRef.current = toon.toonId;
    const watcherRef = useRef<ReplayWatcher | null>(null);
    const noticeId = useRef(0);

    const appendLog = useCallback((message: string) => {
        const line = `${formatTime(new Date())}  ${message}`;
        setLog((lines) => [...lines, line].slice(-MAX_LOG_LINES));
    }, []);

    const notify = useCallback((text: string) => {
        setNotice({ id: ++noticeId.current, text });
    }, []);

    const upsert = useCallback((entry: ReplayEntry) => {
        setEntries((current) => {
            const index = current.findIndex((e) => e.name === entry.name);
            if (index >= 0) {
                const next = [...current];
                next[index] = entry;
                return next;
            }
            // Same insert-by-date rule as `StateFile.add`: a backdated replay
            // (an old backup, a delayed sync) should not jump to the top just
            // because it was seen just now.
            const time = entryTime(entry);
            const insertAt = current.findIndex((e) => entryTime(e) <= time);
            if (insertAt === -1) {
                return [...current, entry];
            }
            const next = [...current];
            next.splice(insertAt, 0, entry);
            return next;
        });
    }, []);

    // Load the upload history, adopting one handed over with --import-state if
    // this is the first run.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const imported = await importState(processArgs().importState);
            const loadedState = await StateFile.load();
            if (cancelled) {
                return;
            }
            stateRef.current = loadedState;
            setIsHistoryLoaded(true);
            appendLog(`Loaded ${loadedState.states.length} files done.`);
            if (imported > 0) {
                notify(`Imported ${imported} previous uploads`);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [appendLog, notify]);

    // Rebuild the watcher whenever the settings it depends on change.
    useEffect(() => {
        const state = stateRef.current;
        if (!isHistoryLoaded || state === null || config.watchDir === "") {
            return;
        }

        const uploader = new Uploader({ maxTries: config.maxTries, onLog: appendLog });
        const handler = new FileHandler({
            watchDir: config.watchDir,
            state,
            uploader,
            onLog: appendLog,
            onUploadStart: (entry) => {
                // Overrides the settled status toEntry would derive from a bare
                // "not uploaded yet" entry, which is "failed" — indistinguishable
                // from a settled state that has no `replay` field.
                upsert({ ...toEntry(entry, toonRef.current), status: "uploading" });
            },
        });
        const watcher = new ReplayWatcher({
            watchDir: config.watchDir,
            handler,
            onLog: appendLog,
            onStatus: setStatus,
            onScanProgress: (done, total) => {
                setScan(done >= total ? null : { done, total });
            },
            onError: (error) => {
                notify(error.message);
            },
            onResult: (result) => {
                if (result.kind === "uploaded") {
                    upsert(toEntry(result.entry, toonRef.current));
                    notify(`Uploaded ${result.entry.name}`);
                } else if (result.kind === "rejected") {
                    const status = result.entry.replay?.status ?? "UnknownCode";
                    upsert(toEntry(result.entry, toonRef.current));
                    notify(`Heroes Profile rejected ${result.entry.name}: ${status}`);
                } else if (result.kind === "failed") {
                    upsert({
                        ...toEntry(result.entry, toonRef.current),
                        status: "failed",
                        detail: result.error.message,
                    });
                }
            },
        });

        watcherRef.current = watcher;
        if (config.autoStart) {
            void watcher.start();
        }

        return () => {
            watcher.stop();
            watcherRef.current = null;
        };
    }, [
        appendLog,
        config.autoStart,
        config.maxTries,
        config.watchDir,
        isHistoryLoaded,
        notify,
        upsert,
    ]);

    // Window size changes arrive on every resize step, so writes are coalesced
    // rather than hitting the disk per pixel.
    const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestConfig = useRef(config);
    latestConfig.current = config;

    const updateConfig = useCallback((changes: Partial<Config>) => {
        setConfig((current) => {
            const next = { ...current, ...changes };
            latestConfig.current = next;
            if (pendingSave.current !== null) {
                clearTimeout(pendingSave.current);
            }
            pendingSave.current = setTimeout(() => {
                pendingSave.current = null;
                void saveConfig(latestConfig.current);
            }, SAVE_DEBOUNCE_MS);
            return next;
        });
    }, []);

    /** Writes any coalesced change immediately, for use on the way out. */
    const flushConfig = useCallback(async () => {
        if (pendingSave.current !== null) {
            clearTimeout(pendingSave.current);
            pendingSave.current = null;
        }
        await saveConfig(latestConfig.current);
    }, []);

    const start = useCallback(() => {
        void watcherRef.current?.start();
    }, []);

    const stop = useCallback(() => {
        watcherRef.current?.stop();
    }, []);

    const rescan = useCallback(() => {
        void watcherRef.current?.rescan();
    }, []);

    /**
     * Re-sends archived replays to collect the match ids of uploads made before we
     * started recording them. Newest first, so the rows on screen are linked
     * first. `scope` limits it to that many of the newest entries — the eager
     * pass over the visible rows; without it the whole history is covered.
     */
    const runBackfill = useCallback(
        (scope?: number, options: { quiet?: boolean } = {}) => {
            const state = stateRef.current;
            if (state === null || config.watchDir === "" || backfillAbort.current !== null) {
                return;
            }
            const controller = new AbortController();
            backfillAbort.current = controller;

            void (async () => {
                try {
                    const summary = await backfillReplayIds({
                        watchDir: config.watchDir,
                        state,
                        uploader: new Uploader({ maxTries: config.maxTries, onLog: appendLog }),
                        signal: controller.signal,
                        scope,
                        onLog: appendLog,
                        // The eager pass is housekeeping; only the opt-in run over
                        // the whole history is worth a progress bar.
                        onProgress: options.quiet ? undefined : setBackfill,
                    });
                    setEntriesVersion((v) => v + 1);
                    if (!options.quiet && summary.total > 0) {
                        notify(
                            summary.stopped
                                ? `Stopped after linking ${summary.linked} replays`
                                : `Linked ${summary.linked} of ${summary.total} replays`,
                        );
                    }
                } finally {
                    backfillAbort.current = null;
                    setBackfill(null);
                }
            })();
        },
        [appendLog, config.maxTries, config.watchDir, notify],
    );

    const stopBackfill = useCallback(() => {
        backfillAbort.current?.abort();
    }, []);

    // Who you are, and therefore which player in each replay is yours. Recomputed
    // when the setting or the folder changes, so a correction lands immediately.
    useEffect(() => {
        const state = stateRef.current;
        if (!isHistoryLoaded || state === null) {
            return;
        }
        const resolved = resolveToonId({
            configured: config.toonId,
            watchDir: config.watchDir,
            parsed: state.states.flatMap((entry) =>
                entry.details === undefined
                    ? []
                    : [
                          {
                              map: entry.details.map,
                              players: entry.details.players.map(([toonId, hero, result]) => ({
                                  toonId,
                                  hero,
                                  team: 0,
                                  result,
                              })),
                          },
                      ],
            ),
        });
        setToon(resolved);
        setEntries(toEntries(state, resolved.toonId));
    }, [config.toonId, config.watchDir, isHistoryLoaded, entriesVersion]);

    // The rows the window actually shows are linked without being asked for, so
    // the front page is never the last thing to get links.
    const eagerDone = useRef(false);
    useEffect(() => {
        if (!isHistoryLoaded || config.watchDir === "" || eagerDone.current) {
            return;
        }
        eagerDone.current = true;
        runBackfill(FRONT_PAGE_ROWS, { quiet: true });
    }, [config.watchDir, isHistoryLoaded, runBackfill]);

    // Reading a replay's own `details` costs nothing but a local file read, so
    // unlike linking to Heroes Profile, it is never gated behind a setting: the
    // whole history is read once per launch, not just the front page.
    const parseDone = useRef(false);
    useEffect(() => {
        const state = stateRef.current;
        if (!isHistoryLoaded || config.watchDir === "" || state === null || parseDone.current) {
            return;
        }
        parseDone.current = true;
        void (async () => {
            const summary = await parseLocalDetails({
                watchDir: config.watchDir,
                state,
                onLog: appendLog,
            });
            if (summary.parsed > 0) {
                setEntriesVersion((v) => v + 1);
            }
        })();
    }, [appendLog, config.watchDir, isHistoryLoaded]);

    // Covering the rest is hundreds of requests, so it only runs while the
    // setting is on, and switching it off stops the run.
    useEffect(() => {
        if (!isHistoryLoaded || config.watchDir === "" || !config.linkAllReplays) {
            return;
        }
        const timer = setTimeout(() => runBackfill(), 0);
        return () => {
            clearTimeout(timer);
            backfillAbort.current?.abort();
        };
    }, [config.linkAllReplays, config.watchDir, isHistoryLoaded, runBackfill]);

    const unlinkedCount = useMemo(
        () => (stateRef.current === null ? 0 : needsBackfill(stateRef.current)),
        // Recount whenever the visible list changes, which is when it can differ.
        [entries],
    );

    const counts = useMemo(
        () => ({
            uploaded: entries.filter((e) => e.status === "uploaded").length,
            rejected: entries.filter((e) => e.status === "rejected").length,
            failed: entries.filter((e) => e.status === "failed").length,
        }),
        [entries],
    );

    return {
        config,
        updateConfig,
        flushConfig,
        isHistoryLoaded,
        entries,
        counts,
        status,
        log,
        scan,
        notice,
        notify,
        toon,
        start,
        stop,
        rescan,
        backfill,
        stopBackfill,
        unlinkedCount,
    };
};

export type UploaderModel = ReturnType<typeof useUploader>;
