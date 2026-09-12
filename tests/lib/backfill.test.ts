import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillReplayIds, needsBackfill, parseLocalDetails } from "../../src/lib/backfill.js";
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

    const addArchived = async (
        name: string,
        body: string,
        replayId?: number,
        parsed = false,
        ts = new Date().toISOString(),
    ) => {
        const content = mpq(body);
        await writeFile(join(archive, name), content);
        state.add({
            name,
            sha256: sha512Base64(content),
            seen_at: ts,
            ts,
            is_uploaded: true,
            ...(replayId === undefined ? {} : { replay: { replay_id: replayId } }),
            // The fixtures are not real MPQ archives, so details never parse from
            // them; set them explicitly when a test needs a finished entry.
            ...(parsed
                ? { details: { map: "Sky Temple", players: [], playedAt: "2024-01-01T00:00:00Z" } }
                : {}),
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

    it("skips replays that are already linked and parsed, so a stopped run resumes", async () => {
        await addArchived("done.StormReplay", "one", 111, true);
        await addArchived("todo.StormReplay", "two");
        const uploader = fakeUploader({ status: "Duplicate", replayId: 222 });

        const summary = await run(uploader);

        expect(summary.total).toBe(1);
        expect(uploader.upload).toHaveBeenCalledOnce();
        expect(state.find(sha512Base64(mpq("one")))?.replay?.replay_id).toBe(111);
    });

    // A replay linked before match parsing existed still needs its match read,
    // but re-sending it would be a wasted request.
    it("reads the match of an already-linked replay without uploading it again", async () => {
        await addArchived("linked.StormReplay", "one", 111);
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await run(uploader);

        expect(summary.total).toBe(1);
        expect(uploader.upload).not.toHaveBeenCalled();
        expect(state.find(sha512Base64(mpq("one")))?.replay?.replay_id).toBe(111);
    });

    // `playedAt` was added to `details` after some replays already had a
    // details block without it, so those need a second look, at no network cost.
    it("re-reads an already-linked, already-parsed replay that is missing playedAt", async () => {
        const content = mpq("one");
        await writeFile(join(archive, "old.StormReplay"), content);
        state.add({
            name: "old.StormReplay",
            sha256: sha512Base64(content),
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: true,
            replay: { replay_id: 111 },
            details: { map: "Sky Temple", players: [] },
        });
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await run(uploader);

        expect(summary.total).toBe(1);
        expect(uploader.upload).not.toHaveBeenCalled();
        expect(state.find(sha512Base64(content))?.replay?.replay_id).toBe(111);
    });

    // Every request is load on a service we do not run, so a replay old enough
    // to be very unlikely to matter is left unlinked on purpose, forever.
    it("never links a replay played more than 12 months ago", async () => {
        const content = mpq("one");
        await writeFile(join(archive, "ancient.StormReplay"), content);
        state.add({
            name: "ancient.StormReplay",
            sha256: sha512Base64(content),
            seen_at: "2023-01-01T00:00:00Z",
            ts: "2023-01-01T00:00:00Z",
            is_uploaded: false,
            details: { map: "Sky Temple", players: [], playedAt: "2023-01-01T00:00:00Z" },
        });
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await backfillReplayIds({
            watchDir: dir,
            state,
            uploader,
            throttleMs: 0,
            now: new Date("2024-06-01T00:00:00Z"),
        });

        expect(summary).toMatchObject({ total: 0, tooOld: 1 });
        expect(uploader.upload).not.toHaveBeenCalled();
        expect(state.find(sha512Base64(content))?.replay).toBeUndefined();
    });

    it("falls back to the file's mtime when playedAt is not known yet", async () => {
        const content = mpq("one");
        await writeFile(join(archive, "old.StormReplay"), content);
        state.add({
            name: "old.StormReplay",
            sha256: sha512Base64(content),
            seen_at: "2023-01-01T00:00:00Z",
            ts: "2023-01-01T00:00:00Z",
            is_uploaded: false,
        });
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await backfillReplayIds({
            watchDir: dir,
            state,
            uploader,
            throttleMs: 0,
            now: new Date("2024-06-01T00:00:00Z"),
        });

        expect(summary.tooOld).toBe(1);
        expect(uploader.upload).not.toHaveBeenCalled();
    });

    it("still links a replay within the last 12 months", async () => {
        const content = mpq("one");
        await writeFile(join(archive, "recent.StormReplay"), content);
        state.add({
            name: "recent.StormReplay",
            sha256: sha512Base64(content),
            seen_at: "2024-01-01T00:00:00Z",
            ts: "2024-01-01T00:00:00Z",
            is_uploaded: false,
            details: { map: "Sky Temple", players: [], playedAt: "2024-01-01T00:00:00Z" },
        });
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await backfillReplayIds({
            watchDir: dir,
            state,
            uploader,
            throttleMs: 0,
            now: new Date("2024-06-01T00:00:00Z"),
        });

        expect(summary).toMatchObject({ total: 1, linked: 1, tooOld: 0 });
        expect(uploader.upload).toHaveBeenCalledOnce();
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

    it("covers only the most recent entries when given a scope", async () => {
        await addArchived("oldest.StormReplay", "one");
        await addArchived("newest.StormReplay", "two");
        const uploader = fakeUploader({ status: "Duplicate", replayId: 7 });

        const summary = await backfillReplayIds({
            watchDir: dir,
            state,
            uploader,
            throttleMs: 0,
            scope: 1,
        });

        expect(summary).toMatchObject({ total: 1, linked: 1 });
        expect(uploader.upload).toHaveBeenCalledOnce();
        expect(state.find(sha512Base64(mpq("two")))?.replay?.replay_id).toBe(7);
        expect(state.find(sha512Base64(mpq("one")))?.replay).toBeUndefined();
    });

    /**
     * The eager pass runs at every startup. Scoping by "how much work to do"
     * rather than "how far back to look" made it walk deeper into the history
     * each time, uploading a fresh batch on every launch forever.
     */
    it("does nothing once the scoped entries are finished, however much older work remains", async () => {
        // Older than the "recent" entries' own 2024-01-01 playedAt, so scoping by
        // date still puts them behind the recent ones however fast the test runs.
        await addArchived("old-3.StormReplay", "c", undefined, false, "2020-01-03T00:00:00Z");
        await addArchived("old-2.StormReplay", "b", undefined, false, "2020-01-02T00:00:00Z");
        await addArchived("old-1.StormReplay", "a", undefined, false, "2020-01-01T00:00:00Z");
        // The two newest are already linked and parsed.
        await addArchived("recent-2.StormReplay", "y", 222, true);
        await addArchived("recent-1.StormReplay", "z", 111, true);
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await backfillReplayIds({
            watchDir: dir,
            state,
            uploader,
            throttleMs: 0,
            scope: 2,
        });

        expect(summary).toMatchObject({ total: 0, linked: 0 });
        expect(uploader.upload).not.toHaveBeenCalled();
    });

    it("still reaches older entries when no scope is given", async () => {
        await addArchived("old.StormReplay", "a");
        await addArchived("recent.StormReplay", "z", 111, true);
        const uploader = fakeUploader({ status: "Duplicate", replayId: 999 });

        const summary = await backfillReplayIds({ watchDir: dir, state, uploader, throttleMs: 0 });

        expect(summary).toMatchObject({ total: 1 });
        expect(uploader.upload).toHaveBeenCalledOnce();
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

describe("parseLocalDetails", () => {
    let dir: string;
    let archive: string;
    let state: StateFile;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "hots-parse-"));
        archive = join(dir, "archived");
        await mkdir(archive);
        state = StateFile.empty(join(dir, "state.json"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const addArchived = async (name: string, body: string, parsed = false) => {
        const content = mpq(body);
        await writeFile(join(archive, name), content);
        state.add({
            name,
            sha256: sha512Base64(content),
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: true,
            ...(parsed
                ? { details: { map: "Sky Temple", players: [], playedAt: "2024-01-01T00:00:00Z" } }
                : {}),
        });
    };

    it("counts entries missing details, skipping ones that already have playedAt", async () => {
        await addArchived("done.StormReplay", "one", true);
        await addArchived("todo.StormReplay", "two");

        const summary = await parseLocalDetails({ watchDir: dir, state });

        expect(summary.total).toBe(1);
    });

    // The fixtures are not real MPQ archives, so `readReplayDetails` cannot
    // actually parse them — that round trip is covered in replay-details.test.ts.
    // This only exercises what the entry is left with when parsing fails.
    it("leaves an entry unparsed when the file cannot be read as a replay", async () => {
        await addArchived("bad.StormReplay", "not a real archive");

        const summary = await parseLocalDetails({ watchDir: dir, state });

        expect(summary).toMatchObject({ total: 1, parsed: 0 });
        expect(state.states[0]?.details).toBeUndefined();
    });

    it("counts entries whose file is gone, without failing", async () => {
        state.add({
            name: "gone.StormReplay",
            sha256: "gone-sha",
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: true,
        });

        const summary = await parseLocalDetails({ watchDir: dir, state });

        expect(summary).toMatchObject({ total: 0, parsed: 0, missing: 1 });
    });

    it("leaves an entry alone when the file on disk is not the one it describes", async () => {
        await addArchived("game.StormReplay", "one");
        await writeFile(join(archive, "game.StormReplay"), mpq("something else"));

        const summary = await parseLocalDetails({ watchDir: dir, state });

        expect(summary.parsed).toBe(0);
        expect(state.states[0]?.details).toBeUndefined();
    });

    it("never touches replay/upload status — only details", async () => {
        await addArchived("todo.StormReplay", "two");

        await parseLocalDetails({ watchDir: dir, state });

        expect(state.states[0]?.replay).toBeUndefined();
    });

    it("survives a missing archive folder", async () => {
        await rm(archive, { recursive: true });

        const summary = await parseLocalDetails({ watchDir: dir, state });

        expect(summary).toMatchObject({ total: 0, parsed: 0, missing: 0 });
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

    it("excludes unlinked entries too old to ever be linked", () => {
        const state = StateFile.empty("/tmp/unused.json");
        state.add({
            name: "recent",
            sha256: "recent",
            seen_at: "",
            ts: "2024-01-01T00:00:00Z",
            is_uploaded: false,
        });
        state.add({
            name: "ancient",
            sha256: "ancient",
            seen_at: "",
            ts: "2020-01-01T00:00:00Z",
            is_uploaded: false,
        });

        expect(needsBackfill(state, new Date("2024-06-01T00:00:00Z"))).toBe(1);
    });
});
