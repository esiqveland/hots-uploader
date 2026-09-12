import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureDir, stateFile } from "./paths.js";
import type { UploadStatus } from "./uploader.js";

/**
 * What Heroes Profile told us about a replay. Grouped into one optional object so
 * "do we have Heroes Profile details for this?" is a single presence check — every
 * entry written before this existed simply has no `replay` key.
 */
export interface ReplayInfo {
    /** Computed server-side from the replay's players and random value. */
    fingerprint?: string;
    /** Heroes Profile's match id, and the key to its match page. */
    replay_id?: number;
    status?: UploadStatus;
}

/**
 * Whether there is nothing left to do for an entry: either it uploaded, or Heroes
 * Profile gave a verdict on it. Entries written before `replay` existed fall back
 * to `is_uploaded` alone.
 */
export const isSettled = (entry: UploadState): boolean =>
    entry.is_uploaded || entry.replay?.status !== undefined;

/** One row of `state.json`, wire-compatible with the Go `state.UploadState`. */
export interface UploadState {
    name: string;
    /** base64(SHA-512) of the file contents. Misnamed in the original; kept as-is. */
    sha256: string;
    seen_at: string;
    /** The file's modification time. */
    ts: string;
    is_uploaded: boolean;
    /** Absent when Heroes Profile has never told us anything about this replay. */
    replay?: ReplayInfo;
}

interface StateFileJson {
    states: UploadState[];
}

/**
 * The upload history. Entries are newest-first, matching the Go implementation's
 * `prepend`, so the UI can render the list top-down without sorting.
 */
export class StateFile {
    private constructor(
        public states: UploadState[],
        private readonly path: string,
    ) {}

    static empty(path: string = stateFile()): StateFile {
        return new StateFile([], path);
    }

    static fromJson(json: string, path: string = stateFile()): StateFile {
        const parsed = JSON.parse(json) as Partial<StateFileJson> | null;
        return new StateFile(parsed?.states ?? [], path);
    }

    static async load(path: string = stateFile()): Promise<StateFile> {
        try {
            return StateFile.fromJson(await readFile(path, "utf8"), path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return StateFile.empty(path);
            }
            throw error;
        }
    }

    /**
     * sha -> whether we are finished with that content.
     *
     * "Finished" is wider than "uploaded": a replay Heroes Profile rejected
     * (AiDetected, TooOld, …) was delivered successfully and will never be
     * accepted, so re-sending it would only waste a request.
     */
    filesDone(): Map<string, boolean> {
        return new Map(this.states.map((s) => [s.sha256, isSettled(s)]));
    }

    find(sha256: string): UploadState | undefined {
        return this.states.find((s) => s.sha256 === sha256);
    }

    /**
     * Replaces the entry with a matching sha in place, or prepends a new one.
     * Returns the entry now held in the list, which is the object callers mutate.
     */
    add(entry: UploadState): UploadState {
        const index = this.states.findIndex((s) => s.sha256 === entry.sha256);
        if (index >= 0) {
            this.states[index] = entry;
        } else {
            this.states.unshift(entry);
        }
        return entry;
    }

    toJson(): string {
        return JSON.stringify({ states: this.states } satisfies StateFileJson);
    }

    /**
     * Writes the whole file, via a temp file and a rename. The Go version used
     * `os.Create`, which truncates first and loses the entire history if the
     * process dies mid-write.
     */
    async save(): Promise<void> {
        await ensureDir(dirname(this.path));
        const temp = join(dirname(this.path), `.${process.pid}.state.json.tmp`);
        await writeFile(temp, this.toJson(), "utf8");
        await rename(temp, this.path);
    }
}
