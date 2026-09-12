import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { processArgs } from "../lib/args.js";
import { formatTime } from "../lib/format.js";
import { type Config, loadConfigSync, saveConfig } from "../lib/config.js";
import { FileHandler } from "../lib/filehandler.js";
import {
    backfillReplayIds,
    FRONT_PAGE_ROWS,
    needsBackfill,
    type BackfillProgress,
} from "../lib/backfill.js";
import { importState } from "../lib/migrate.js";
import { StateFile } from "../lib/state.js";
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
}

export interface Notice {
    id: number;
    text: string;
}

/** Keeps the log pane bounded; it is a rolling view, not an archive. */
const MAX_LOG_LINES = 500;

/** How long to coalesce config writes, so a drag-resize writes once. */
const SAVE_DEBOUNCE_MS = 400;

const toEntries = (state: StateFile): ReplayEntry[] =>
    state.states.map((s) => ({
        name: s.name,
        // A verdict without is_uploaded means Heroes Profile turned it down;
        // anything else unfinished is a failed attempt.
        status: s.is_uploaded ? "uploaded" : s.replay?.status ? "rejected" : "failed",
        at: s.seen_at,
        detail: s.is_uploaded ? undefined : s.replay?.status,
        replayId: s.replay?.replay_id,
    }));

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
    const backfillAbort = useRef<AbortController | null>(null);

    const stateRef = useRef<StateFile | null>(null);
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
            if (index < 0) {
                return [entry, ...current];
            }
            const next = [...current];
            next[index] = entry;
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
            setEntries(toEntries(loadedState));
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
            onUploadStart: (name) => {
                upsert({ name, status: "uploading", at: new Date().toISOString() });
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
                    upsert({
                        name: result.entry.name,
                        status: "uploaded",
                        at: result.entry.seen_at,
                        replayId: result.entry.replay?.replay_id,
                    });
                    notify(`Uploaded ${result.entry.name}`);
                } else if (result.kind === "rejected") {
                    const status = result.entry.replay?.status ?? "UnknownCode";
                    upsert({
                        name: result.entry.name,
                        status: "rejected",
                        at: result.entry.seen_at,
                        detail: status,
                        replayId: result.entry.replay?.replay_id,
                    });
                    notify(`Heroes Profile rejected ${result.entry.name}: ${status}`);
                } else if (result.kind === "failed") {
                    upsert({
                        name: result.entry.name,
                        status: "failed",
                        at: result.entry.seen_at,
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
     * first. `limit` runs the short eager pass over the visible rows; without it
     * the whole history is covered.
     */
    const runBackfill = useCallback(
        (limit?: number, options: { quiet?: boolean } = {}) => {
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
                        limit,
                        onLog: appendLog,
                        // The eager pass is housekeeping; only the opt-in run over
                        // the whole history is worth a progress bar.
                        onProgress: options.quiet ? undefined : setBackfill,
                    });
                    setEntries(toEntries(state));
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
        start,
        stop,
        rescan,
        backfill,
        stopBackfill,
        unlinkedCount,
    };
};

export type UploaderModel = ReturnType<typeof useUploader>;
