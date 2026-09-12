import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { ARCHIVE_DIR_NAME, type FileHandler, type HandleResult } from "./filehandler.js";

export type WatcherStatus = "stopped" | "scanning" | "watching";

export interface WatcherEvents {
    onResult?: (result: HandleResult) => void;
    onLog?: (message: string) => void;
    onStatus?: (status: WatcherStatus) => void;
    /** Backfill progress: how many of the initial listing have been handled. */
    onScanProgress?: (done: number, total: number) => void;
    onError?: (error: Error) => void;
}

export interface WatcherOptions extends WatcherEvents {
    watchDir: string;
    handler: FileHandler;
}

/**
 * Watches one directory, non-recursively, for new replays.
 *
 * On start it first walks the directory so files that appeared while the app was
 * closed still get uploaded, then keeps watching. Everything runs through a
 * single queue: the Go version ran the backfill and the watcher concurrently and
 * raced on shared state.
 */
export class ReplayWatcher {
    private watcher: FSWatcher | null = null;
    private queue: Promise<void> = Promise.resolve();
    private readonly pending = new Set<string>();
    private running = false;

    constructor(private readonly options: WatcherOptions) {}

    get isRunning(): boolean {
        return this.running;
    }

    async start(): Promise<void> {
        if (this.running) {
            return;
        }
        this.running = true;

        this.options.onStatus?.("scanning");
        await this.scan();
        if (!this.running) {
            return;
        }

        try {
            this.watcher = watch(this.options.watchDir, { persistent: true }, (_event, filename) => {
                if (filename) {
                    this.enqueue(filename.toString());
                }
            });
            this.watcher.on("error", (error) => {
                this.options.onLog?.(`Watcher got error: ${error.message}`);
                this.options.onError?.(error);
            });
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            this.running = false;
            this.options.onStatus?.("stopped");
            this.options.onError?.(error);
            return;
        }

        this.options.onLog?.(`Now watching directory: ${this.options.watchDir}`);
        this.options.onStatus?.("watching");
    }

    stop(): void {
        this.running = false;
        this.watcher?.close();
        this.watcher = null;
        this.pending.clear();
        this.options.onStatus?.("stopped");
    }

    /** Re-walks the directory without restarting the watcher. */
    async rescan(): Promise<void> {
        const previous: WatcherStatus = this.running ? "watching" : "stopped";
        this.options.onStatus?.("scanning");
        await this.scan();
        this.options.onStatus?.(previous);
    }

    private async scan(): Promise<void> {
        let names: string[];
        try {
            names = await readdir(this.options.watchDir);
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            this.options.onLog?.(`Could not read ${this.options.watchDir}: ${error.message}`);
            this.options.onError?.(error);
            return;
        }

        this.options.onLog?.(`Found ${names.length} files from ${this.options.watchDir}`);

        const candidates = names.filter((name) => name !== ARCHIVE_DIR_NAME);
        let done = 0;
        this.options.onScanProgress?.(0, candidates.length);
        for (const name of candidates) {
            await this.handle(name);
            this.options.onScanProgress?.(++done, candidates.length);
        }
    }

    /**
     * Queues a file seen by the watcher. A path already waiting is dropped:
     * Wine emits several writes per replay and they would otherwise pile up.
     */
    private enqueue(relPath: string): void {
        // Archiving an upload writes into the watched directory; ignore the
        // events that causes rather than re-examining our own moves.
        if (relPath === ARCHIVE_DIR_NAME || relPath.startsWith(`${ARCHIVE_DIR_NAME}/`)) {
            return;
        }
        if (this.pending.has(relPath)) {
            return;
        }
        this.pending.add(relPath);
        this.queue = this.queue.then(async () => {
            this.pending.delete(relPath);
            if (this.running) {
                await this.handle(relPath);
            }
        });
    }

    private async handle(relPath: string): Promise<void> {
        try {
            const result = await this.options.handler.handleFile(relPath);
            this.options.onResult?.(result);
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            this.options.onLog?.(`Error handling ${relPath}: ${error.message}`);
            this.options.onError?.(error);
        }
    }
}
