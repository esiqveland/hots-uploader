import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileHandler } from "../../src/lib/filehandler.js";
import { StateFile } from "../../src/lib/state.js";
import type { Uploader, UploadResult } from "../../src/lib/uploader.js";
import { ReplayWatcher, type WatcherStatus } from "../../src/lib/watcher.js";

/** A minimal MPQ user-data header, which every real .StormReplay starts with. */
const mpq = (body: string): Buffer => Buffer.concat([Buffer.from("MPQ\x1b", "latin1"), Buffer.from(body)]);

const fakeUploader = (result: UploadResult = { status: "Success", replayId: 65133342 }): Uploader =>
    ({ upload: async () => result }) as unknown as Uploader;

describe("ReplayWatcher", () => {
    let dir: string;
    let handler: FileHandler;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "hots-watcher-test-"));
        handler = new FileHandler({
            watchDir: dir,
            state: StateFile.empty(join(dir, "state.json")),
            uploader: fakeUploader(),
            settleMs: 0,
        });
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    /** An `onResult` callback plus the promise it resolves the first time it fires. */
    const deferredResult = (timeoutMs = 2000): { onResult: () => void; done: Promise<void> } => {
        let onResult: () => void = () => {};
        const done = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timed out waiting for a result")), timeoutMs);
            onResult = () => {
                clearTimeout(timer);
                resolve();
            };
        });
        return { onResult, done };
    };

    it("picks up a file present before start, via the initial scan", async () => {
        await writeFile(join(dir, "seen.StormReplay"), mpq("already there"));
        const results: string[] = [];
        const watcher = new ReplayWatcher({
            watchDir: dir,
            handler,
            onResult: (r) => results.push(r.kind),
        });

        await watcher.start();
        watcher.stop();

        expect(results).toEqual(["uploaded"]);
    });

    it("uses inotify by default and picks up a file written after start", async () => {
        const { onResult, done } = deferredResult();
        const watcher = new ReplayWatcher({ watchDir: dir, handler, onResult });
        await watcher.start();

        await writeFile(join(dir, "new.StormReplay"), mpq("fresh"));
        await done;

        watcher.stop();
    });

    it("polls instead of using inotify when shouldPoll is set", async () => {
        const { onResult, done } = deferredResult();
        const watcher = new ReplayWatcher({
            watchDir: dir,
            handler,
            onResult,
            shouldPoll: true,
            pollIntervalMs: 20,
        });
        await watcher.start();

        await writeFile(join(dir, "polled.StormReplay"), mpq("via polling"));
        await done;

        watcher.stop();
    });

    it("reports status transitions", async () => {
        const statuses: WatcherStatus[] = [];
        const watcher = new ReplayWatcher({ watchDir: dir, handler, onStatus: (s) => statuses.push(s) });

        await watcher.start();
        watcher.stop();

        expect(statuses).toEqual(["scanning", "watching", "stopped"]);
    });

    it("stops polling once stop() is called", async () => {
        let calls = 0;
        const watcher = new ReplayWatcher({
            watchDir: dir,
            handler,
            shouldPoll: true,
            pollIntervalMs: 10,
            onLog: (message) => {
                if (message.startsWith("Found")) {
                    calls++;
                }
            },
        });

        await watcher.start();
        const afterStart = calls;
        watcher.stop();
        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(calls).toBe(afterStart);
    });
});
