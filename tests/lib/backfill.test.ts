import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillReplayIds, needsBackfill } from "../../src/lib/backfill.js";
import { sha512Base64 } from "../../src/lib/hash.js";
import { StateFile } from "../../src/lib/state.js";
import type { Uploader, UploadResult } from "../../src/lib/uploader.js";

const mpq = (body: string): Buffer =>
    Buffer.concat([Buffer.from("MPQ\x1b", "latin1"), Buffer.from(body)]);

const fakeUploader = (results: UploadResult[] | UploadResult) => {
    const queue = Array.isArray(results) ? [...results] : null;
    const upload = vi.fn(async () =>
        queue === null ? (results as UploadResult) : (queue.shift() ?? { status: "Success" }),
    );
    return { upload } as unknown as Uploader & { upload: typeof upload };
};

describe("backfillReplayIds", () => {
    let dir: string;
    let archive: string;
    let state: StateFile;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "hots-backfill-"));
        archive = join(dir, "archived");
        await mkdir(archive);
        state = StateFile.empty(join(dir, "state.json"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const addArchived = async (name: string, body: string, replayId?: number) => {
        const content = mpq(body);
        await writeFile(join(archive, name), content);
        state.add({
            name,
            sha256: sha512Base64(content),
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: true,
            ...(replayId === undefined ? {} : { replay: { replay_id: replayId } }),
        });
    };

    const run = (uploader: Uploader, signal?: AbortSignal) =>
        backfillReplayIds({ watchDir: dir, state, uploader, signal, throttleMs: 0 });

    it("links archived replays with the id Heroes Profile returns", async () => {
        await addArchived("a.StormReplay", "one");
        await addArchived("b.StormReplay", "two");
        // Newest first, so "b" is sent before "a".
        const uploader = fakeUploader([
            { status: "Duplicate", replayId: 222, fingerprint: "f2" },
            { status: "Duplicate", replayId: 111, fingerprint: "f1" },
        ]);

        const summary = await run(uploader);

        expect(summary).toMatchObject({ done: 2, total: 2, linked: 2, stopped: false });
        expect(state.find(sha512Base64(mpq("one")))?.replay).toEqual({
            fingerprint: "f1",
            replay_id: 111,
            status: "Duplicate",
        });
        expect(state.find(sha512Base64(mpq("two")))?.replay?.replay_id).toBe(222);
    });

    it("skips replays that already have an id, so a stopped run resumes", async () => {
        await addArchived("done.StormReplay", "one", 111);
        await addArchived("todo.StormReplay", "two");
        const uploader = fakeUploader({ status: "Duplicate", replayId: 222 });

        const summary = await run(uploader);

        expect(summary.total).toBe(1);
        expect(uploader.upload).toHaveBeenCalledOnce();
        expect(state.find(sha512Base64(mpq("one")))?.replay?.replay_id).toBe(111);
    });

    it("stops when aborted and reports how far it got", async () => {
        await addArchived("a.StormReplay", "one");
        await addArchived("b.StormReplay", "two");
        const controller = new AbortController();
        const upload = vi.fn(async () => {
            controller.abort();
            return { status: "Duplicate", replayId: 111 } as UploadResult;
        });
        const uploader = { upload } as unknown as Uploader;

        const summary = await run(uploader, controller.signal);

        expect(summary.stopped).toBe(true);
        expect(summary.done).toBe(1);
        expect(upload).toHaveBeenCalledOnce();
    });

    it("keeps going when one replay fails", async () => {
        await addArchived("a.StormReplay", "one");
        await addArchived("b.StormReplay", "two");
        let call = 0;
        const upload = vi.fn(async () => {
            // The first send is the newest entry, "b".
            if (++call === 1) throw new Error("boom");
            return { status: "Duplicate", replayId: 111 } as UploadResult;
        });

        const summary = await run({ upload } as unknown as Uploader);

        expect(summary).toMatchObject({ done: 2, linked: 1, stopped: false });
        expect(state.find(sha512Base64(mpq("two")))?.replay).toBeUndefined();
        expect(state.find(sha512Base64(mpq("one")))?.replay?.replay_id).toBe(111);
    });

    it("ignores files in the archive that are not in the history", async () => {
        await writeFile(join(archive, "stray.StormReplay"), mpq("unknown"));
        const uploader = fakeUploader({ status: "Success", replayId: 1 });

        const summary = await run(uploader);

        expect(summary.total).toBe(0);
        expect(uploader.upload).not.toHaveBeenCalled();
    });

    it("counts history entries whose file is gone, without trying to send them", async () => {
        await addArchived("here.StormReplay", "one");
        state.add({
            name: "gone.StormReplay",
            sha256: "gone-sha",
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: true,
        });
        const uploader = fakeUploader({ status: "Duplicate", replayId: 1 });

        const summary = await run(uploader);

        expect(summary).toMatchObject({ total: 1, missing: 1 });
        expect(uploader.upload).toHaveBeenCalledOnce();
    });

    it("leaves an entry alone when the file on disk is not the one it describes", async () => {
        await addArchived("game.StormReplay", "one");
        // Same name, different bytes: the hash guard must catch this.
        await writeFile(join(archive, "game.StormReplay"), mpq("something else"));
        const uploader = fakeUploader({ status: "Duplicate", replayId: 1 });

        const summary = await run(uploader);

        expect(uploader.upload).not.toHaveBeenCalled();
        expect(summary.linked).toBe(0);
        expect(state.states[0]?.replay).toBeUndefined();
    });

    it("works newest first, so the rows on screen are linked before the rest", async () => {
        // add() prepends, so the last added is newest.
        await addArchived("oldest.StormReplay", "one");
        await addArchived("middle.StormReplay", "two");
        await addArchived("newest.StormReplay", "three");
        const sent: string[] = [];
        const upload = vi.fn(async (name: string) => {
            sent.push(name);
            return { status: "Duplicate", replayId: sent.length } as UploadResult;
        });

        await run({ upload } as unknown as Uploader);

        expect(sent).toEqual([
            "newest.StormReplay",
            "middle.StormReplay",
            "oldest.StormReplay",
        ]);
    });

    it("covers only the most recent entries when given a limit", async () => {
        await addArchived("oldest.StormReplay", "one");
        await addArchived("newest.StormReplay", "two");
        const uploader = fakeUploader({ status: "Duplicate", replayId: 7 });

        const summary = await backfillReplayIds({
            watchDir: dir,
            state,
            uploader,
            throttleMs: 0,
            limit: 1,
        });

        expect(summary).toMatchObject({ total: 1, linked: 1 });
        expect(uploader.upload).toHaveBeenCalledOnce();
        expect(state.find(sha512Base64(mpq("two")))?.replay?.replay_id).toBe(7);
        expect(state.find(sha512Base64(mpq("one")))?.replay).toBeUndefined();
    });

    it("reports progress as it goes", async () => {
        await addArchived("a.StormReplay", "one");
        await addArchived("b.StormReplay", "two");
        const seen: number[] = [];

        await backfillReplayIds({
            watchDir: dir,
            state,
            uploader: fakeUploader({ status: "Duplicate", replayId: 1 }),
            throttleMs: 0,
            onProgress: (p) => seen.push(p.done),
        });

        expect(seen).toEqual([0, 1, 2]);
    });

    it("survives a missing archive folder", async () => {
        await rm(archive, { recursive: true });

        const summary = await run(fakeUploader({ status: "Success" }));

        expect(summary).toMatchObject({ total: 0, done: 0, stopped: false });
    });
});

describe("needsBackfill", () => {
    it("counts entries with no match id", () => {
        const state = StateFile.empty("/tmp/unused.json");
        const base = { seen_at: "", ts: "", is_uploaded: true };
        state.add({ ...base, name: "a", sha256: "a", replay: { replay_id: 1 } });
        state.add({ ...base, name: "b", sha256: "b" });
        state.add({ ...base, name: "c", sha256: "c", replay: { status: "AiDetected" } });

        expect(needsBackfill(state)).toBe(2);
    });
});
