import { access, mkdir, readFile, rename, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { sha512Base64 } from "./hash.js";
import { readReplayDetails, toMatchDetails } from "./replay-details.js";
import type { StateFile, UploadState } from "./state.js";
import { isAccepted, type Uploader } from "./uploader.js";

export type SkipReason =
    | "not-a-replay"
    | "directory"
    | "too-small"
    | "not-an-mpq"
    | "already-uploaded";

export type HandleResult =
    | { kind: "skipped"; reason: SkipReason; name: string; archivedTo?: string | null }
    | { kind: "uploaded"; entry: UploadState; archivedTo: string | null }
    /** Heroes Profile took the file but will not use it. Final, not retryable. */
    | { kind: "rejected"; entry: UploadState; archivedTo: string | null }
    | { kind: "failed"; entry: UploadState; error: Error };

/**
 * Uploaded replays are moved into this folder inside the watched directory, so
 * later scans have far less to hash. The scan is non-recursive, so it is skipped
 * as an ordinary directory.
 */
export const ARCHIVE_DIR_NAME = "archived";

/**
 * Wine writes a replay in several passes, at least three of which are partial.
 * Waiting before reading makes it very likely we hash the finished file.
 */
export const SETTLE_MS = 1_000;

/** Anything smaller than the MPQ header cannot be a finished replay. */
const MIN_SIZE_BYTES = 4;

/**
 * Every .StormReplay is an MPQ archive, so it opens with "MPQ" and either the
 * user-data (0x1b) or archive-header (0x1a) marker.
 *
 * The Go version only checked `size < 2`, which let a half-written file — or any
 * junk with the right extension — through to the uploader.
 */
const MPQ_MAGIC = "MPQ";
const MPQ_MARKERS = [0x1a, 0x1b];

const isMpq = (content: Buffer): boolean =>
    content.length >= 4
    && content.subarray(0, 3).toString("latin1") === MPQ_MAGIC
    && MPQ_MARKERS.includes(content[3] ?? 0);

export interface FileHandlerOptions {
    watchDir: string;
    /** Move uploaded replays into `<watchDir>/archived`. On by default. */
    archive?: boolean;
    state: StateFile;
    uploader: Uploader;
    settleMs?: number;
    onLog?: (message: string) => void;
    /**
     * Called when a file begins uploading, so the UI can show it in flight. The
     * entry already has `details` (map, players) when the replay could be parsed,
     * so the UI does not have to wait for the upload to finish to show them.
     */
    onUploadStart?: (entry: UploadState) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const exists = async (path: string): Promise<boolean> => {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
};

/**
 * Finds a free name in the archive. Replay filenames embed a timestamp so
 * collisions are rare, but re-uploading a restored backup would hit one.
 */
const freeArchivePath = async (dir: string, name: string): Promise<string> => {
    const candidate = join(dir, name);
    if (!(await exists(candidate))) {
        return candidate;
    }
    const suffix = extname(name);
    const stem = name.slice(0, name.length - suffix.length);
    for (let n = 2; ; n++) {
        const next = join(dir, `${stem} (${n})${suffix}`);
        if (!(await exists(next))) {
            return next;
        }
    }
};

/**
 * Decides what to do with one file and does it: settle, hash, dedup, upload,
 * persist. Port of the Go `filehandler`.
 */
export class FileHandler {
    private readonly filesDone: Map<string, boolean>;
    private readonly log: (message: string) => void;
    private readonly settleMs: number;

    constructor(private readonly options: FileHandlerOptions) {
        this.filesDone = options.state.filesDone();
        this.log = options.onLog ?? (() => {});
        this.settleMs = options.settleMs ?? SETTLE_MS;
    }

    /** `relPath` is relative to the watch directory, matching the Go signature. */
    async handleFile(relPath: string): Promise<HandleResult> {
        const name = basename(relPath);
        const absPath = join(this.options.watchDir, relPath);

        // The cheap filename check runs first. Go did it after hashing the file
        // twice, which meant every stray file in the folder got hashed.
        if (!name.toLowerCase().endsWith(".stormreplay")) {
            return { kind: "skipped", reason: "not-a-replay", name };
        }

        const stats = await stat(absPath);
        if (stats.isDirectory()) {
            return { kind: "skipped", reason: "directory", name };
        }
        if (stats.size < MIN_SIZE_BYTES) {
            return { kind: "skipped", reason: "too-small", name };
        }

        await sleep(this.settleMs);

        const started = Date.now();
        const content = await readFile(absPath);

        if (!isMpq(content)) {
            this.log(`Skipping ${name}: not an MPQ archive, so not a finished replay`);
            return { kind: "skipped", reason: "not-an-mpq", name };
        }

        const sha256 = sha512Base64(content);

        if (this.filesDone.get(sha256) === true) {
            this.log(`Skipping done file=${relPath}`);
            // Archive it too. Replays uploaded by an earlier run are the bulk of
            // what a scan re-hashes, and moving them aside is the whole point.
            const archivedTo = await this.archive(absPath, name);
            return { kind: "skipped", reason: "already-uploaded", name, archivedTo };
        }

        // The file is already open and validated, so reading the match out of it
        // costs no extra I/O.
        const details = readReplayDetails(absPath);

        const entry = this.options.state.add({
            name,
            sha256,
            seen_at: new Date().toISOString(),
            ts: stats.mtime.toISOString(),
            is_uploaded: false,
            ...(details === null ? {} : { details: toMatchDetails(details) }),
        });
        this.filesDone.set(sha256, false);

        this.options.onUploadStart?.(entry);

        let result;
        try {
            result = await this.options.uploader.upload(relPath, content);
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            this.log(`Upload of ${relPath} failed: ${error.message}`);
            return { kind: "failed", entry, error };
        }

        entry.replay = {
            fingerprint: result.fingerprint,
            replay_id: result.replayId,
            status: result.status,
        };

        // A rejection is a settled outcome: Heroes Profile received the replay and
        // will not use it, so it is recorded and archived like a success. Only a
        // transport failure is worth retrying.
        const accepted = isAccepted(result.status);
        entry.is_uploaded = accepted;
        this.filesDone.set(sha256, true);
        await this.options.state.save();

        const archivedTo = await this.archive(absPath, name);

        this.log(`File=${relPath} took ${Date.now() - started}ms (${result.status})`);
        return { kind: accepted ? "uploaded" : "rejected", entry, archivedTo };
    }

    /**
     * Moves an uploaded replay into the archive folder. Failure here is logged
     * but not fatal: the upload already succeeded and is recorded as done.
     */
    private async archive(absPath: string, name: string): Promise<string | null> {
        if (this.options.archive === false) {
            return null;
        }
        const archiveDir = join(this.options.watchDir, ARCHIVE_DIR_NAME);
        try {
            await mkdir(archiveDir, { recursive: true });
            const target = await freeArchivePath(archiveDir, name);
            await rename(absPath, target);
            this.log(`Archived ${name} to ${target}`);
            return target;
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            this.log(`Could not archive ${name}: ${error.message}`);
            return null;
        }
    }
}
