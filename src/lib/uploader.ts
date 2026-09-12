import { version as appVersion } from "./version.js";

/**
 * The endpoint Heroes Profile's own desktop uploader posts to.
 *
 * The `api.heroesprofile.com` host answers too, but strips the reply down to
 * `{status, message}`. Only this one returns the `replayID` a match page needs,
 * and it fingerprints the replay server-side, so nothing has to parse the file.
 */
export const UPLOAD_URL =
    "https://www.heroesprofile.com/api/external/v1/upload/heroesprofile/desktop";

/** Where a replay ends up once Heroes Profile has it. */
export const MATCH_URL = "https://www.heroesprofile.com/Match/Single/?replayID=";

/** Sent verbatim by the Go uploader; Heroes Profile keys off it. */
export const USER_AGENT =
    "HeroesProfile Electron Uploader / version 1.0.0 "
    + "(https://github.com/Heroes-Profile/heroesprofile-electron-uploader)";

const UPLOAD_TIMEOUT_MS = 60_000;
const BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 15_000;

/** Statuses the API returns, as listed in the official uploader's constants. */
export const UPLOAD_STATUSES = [
    "Success",
    "Duplicate",
    "AiDetected",
    "CustomGame",
    "PtrRegion",
    "TooOld",
    "Incomplete",
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number] | "UnknownCode";

/** Statuses meaning Heroes Profile has the replay. */
const ACCEPTED: ReadonlySet<string> = new Set(["Success", "Duplicate"]);

/**
 * Whether the replay made it in. Anything else is a rejection: final, not a
 * failure, so the caller records it as done rather than retrying forever.
 */
export const isAccepted = (status: UploadStatus): boolean => ACCEPTED.has(status);

export const asUploadStatus = (value: unknown): UploadStatus =>
    UPLOAD_STATUSES.includes(value as (typeof UPLOAD_STATUSES)[number])
        ? (value as UploadStatus)
        : "UnknownCode";

export const matchUrl = (replayId: number): string => `${MATCH_URL}${replayId}`;

export interface UploadResult {
    status: UploadStatus;
    /** Heroes Profile's id for the match, and the key to its match page. */
    replayId?: number;
    /** Computed server-side from the replay's players and random value. */
    fingerprint?: string;
}

export interface UploaderOptions {
    maxTries: number;
    /** Injectable for tests. Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Injectable for tests, so backoff does not really sleep. */
    sleep?: (ms: number) => Promise<void>;
    onLog?: (message: string) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads replays to Heroes Profile.
 *
 * There is no authentication at all: no API key, and no session cookie either.
 * The Go original fetched `XSRF-TOKEN` and `heroesprofileapi_session` before
 * every run; this endpoint accepts the upload without them.
 */
export class Uploader {
    private readonly fetchImpl: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly log: (message: string) => void;

    constructor(private readonly options: UploaderOptions) {
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.sleep = options.sleep ?? defaultSleep;
        this.log = options.onLog ?? (() => {});
    }

    /** A single upload attempt. Throws on any non-2xx, or on a malformed reply. */
    async uploadOnce(filename: string, file: Blob): Promise<UploadResult> {
        const form = new FormData();
        form.append("file", file, filename);

        const url = `${UPLOAD_URL}?version=${encodeURIComponent(appVersion)}`;
        const response = await this.fetchImpl(url, {
            method: "POST",
            headers: { Accept: "application/json", "User-Agent": USER_AGENT },
            body: form,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        const body = await response.text();
        this.log(`[POST ${UPLOAD_URL}] ${response.status} ${body}`);

        if (![200, 201, 204].includes(response.status)) {
            throw new Error(`Upload failed: status=${response.status} body=${body}`);
        }

        let parsed: { status?: unknown; replayID?: unknown; fingerprint?: unknown };
        try {
            parsed = (JSON.parse(body) ?? {}) as typeof parsed;
        } catch {
            // A 2xx we cannot read is worth retrying rather than silently
            // recording as done.
            throw new Error(`Upload returned unreadable body: ${body.slice(0, 200)}`);
        }

        return {
            status: asUploadStatus(parsed.status),
            replayId: typeof parsed.replayID === "number" ? parsed.replayID : undefined,
            fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : undefined,
        };
    }

    /**
     * Uploads with linear backoff, capped at 15s.
     *
     * Unlike the Go original, every attempt builds a fresh request body from the
     * same buffer. The Go version reused one already-consumed `io.Reader`, so its
     * retries uploaded an empty file.
     */
    async upload(filename: string, content: Buffer): Promise<UploadResult> {
        // A Blob can be read any number of times, so every attempt gets the full
        // file without re-reading it from disk.
        const body = new Blob([new Uint8Array(content)]);
        let lastError: unknown;

        for (let attempt = 0; attempt < this.options.maxTries; attempt++) {
            try {
                return await this.uploadOnce(filename, body);
            } catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                this.log(`[${attempt}] Upload of replay='${filename}' failed: ${message}`);

                if (attempt === this.options.maxTries - 1) {
                    break;
                }
                const delay = Math.min(BACKOFF_MS * attempt, MAX_BACKOFF_MS);
                this.log(`[${attempt}] Retrying in ${delay / 1000}s`);
                await this.sleep(delay);
            }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
}
