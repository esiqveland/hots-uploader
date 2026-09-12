import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileHandler } from "../../src/lib/filehandler.js";
import { sha512Base64 } from "../../src/lib/hash.js";
import { StateFile } from "../../src/lib/state.js";
import type { Uploader, UploadResult } from "../../src/lib/uploader.js";

/** A minimal MPQ user-data header, which every real .StormReplay starts with. */
const mpq = (body: string): Buffer => Buffer.concat([Buffer.from("MPQ\x1b", "latin1"), Buffer.from(body)]);

const fakeUploader = (result: UploadResult = { status: "Success", replayId: 65133342 }) => {
    const upload = vi.fn(async () => result);
    return { upload } as unknown as Uploader & { upload: typeof upload };
};

describe("FileHandler", () => {
    let dir: string;
    let state: StateFile;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "hots-test-"));
        state = StateFile.empty(join(dir, "state.json"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const handlerFor = (uploader: Uploader, archive = true) =>
        new FileHandler({ watchDir: dir, state, uploader, settleMs: 0, archive });

    const archived = () => readdir(join(dir, "archived"));

    it("uploads a replay and records it as done", async () => {
        const content = mpq("a real enough replay");
        await writeFile(join(dir, "game.StormReplay"), content);
        const uploader = fakeUploader();

        const result = await handlerFor(uploader).handleFile("game.StormReplay");

        expect(result.kind).toBe("uploaded");
        expect(uploader.upload).toHaveBeenCalledWith("game.StormReplay", content);
        expect(state.states).toHaveLength(1);
        expect(state.states[0]).toMatchObject({
            name: "game.StormReplay",
            sha256: sha512Base64(content),
            is_uploaded: true,
        });
    });

    it("persists state only after a successful upload", async () => {
        await writeFile(join(dir, "game.StormReplay"), mpq("content"));
        const save = vi.spyOn(state, "save");

        await handlerFor(fakeUploader()).handleFile("game.StormReplay");

        expect(save).toHaveBeenCalledTimes(1);
    });

    it("does not persist state when the upload fails", async () => {
        await writeFile(join(dir, "game.StormReplay"), mpq("content"));
        const save = vi.spyOn(state, "save");
        const uploader = fakeUploader();
        uploader.upload.mockRejectedValue(new Error("boom"));

        const result = await handlerFor(uploader).handleFile("game.StormReplay");

        expect(result.kind).toBe("failed");
        expect(save).not.toHaveBeenCalled();
        expect(state.states[0]?.is_uploaded).toBe(false);
    });

    it("skips files that are not .stormreplay, case-insensitively", async () => {
        await writeFile(join(dir, "notes.txt"), "hello");
        const uploader = fakeUploader();

        const result = await handlerFor(uploader).handleFile("notes.txt");

        expect(result).toMatchObject({ kind: "skipped", reason: "not-a-replay" });
        expect(uploader.upload).not.toHaveBeenCalled();
    });

    it("accepts the .StormReplay casing HotS actually writes", async () => {
        await writeFile(join(dir, "Sky Temple.StormReplay"), mpq("content"));

        const result = await handlerFor(fakeUploader()).handleFile("Sky Temple.StormReplay");

        expect(result.kind).toBe("uploaded");
    });

    it("skips directories", async () => {
        await mkdir(join(dir, "old.stormreplay"));

        const result = await handlerFor(fakeUploader()).handleFile("old.stormreplay");

        expect(result).toMatchObject({ kind: "skipped", reason: "directory" });
    });

    it("skips files too small to be a finished replay", async () => {
        await writeFile(join(dir, "partial.StormReplay"), "x");

        const result = await handlerFor(fakeUploader()).handleFile("partial.StormReplay");

        expect(result).toMatchObject({ kind: "skipped", reason: "too-small" });
    });

    it("skips content that was already uploaded, even under a new filename", async () => {
        const content = mpq("already uploaded replay");
        state.add({
            name: "original.StormReplay",
            sha256: sha512Base64(content),
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: true,
        });
        await writeFile(join(dir, "copy.StormReplay"), content);
        const uploader = fakeUploader();

        const result = await handlerFor(uploader).handleFile("copy.StormReplay");

        expect(result).toMatchObject({ kind: "skipped", reason: "already-uploaded" });
        expect(uploader.upload).not.toHaveBeenCalled();
    });

    it("retries content whose previous upload failed", async () => {
        const content = mpq("previously failed replay");
        state.add({
            name: "game.StormReplay",
            sha256: sha512Base64(content),
            seen_at: new Date().toISOString(),
            ts: new Date().toISOString(),
            is_uploaded: false,
        });
        await writeFile(join(dir, "game.StormReplay"), content);
        const uploader = fakeUploader();

        const result = await handlerFor(uploader).handleFile("game.StormReplay");

        expect(result.kind).toBe("uploaded");
        expect(uploader.upload).toHaveBeenCalledOnce();
        expect(state.states).toHaveLength(1);
    });

    describe("archiving", () => {
        it("moves an uploaded replay into <watchDir>/archived", async () => {
            const content = mpq("a real enough replay");
            await writeFile(join(dir, "game.StormReplay"), content);

            const result = await handlerFor(fakeUploader()).handleFile("game.StormReplay");

            expect(result).toMatchObject({
                kind: "uploaded",
                archivedTo: join(dir, "archived", "game.StormReplay"),
            });
            expect(await archived()).toEqual(["game.StormReplay"]);
            expect(await readFile(join(dir, "archived", "game.StormReplay"))).toEqual(content);
            await expect(stat(join(dir, "game.StormReplay"))).rejects.toThrow();
        });

        it("leaves a failed upload in place", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));
            const uploader = fakeUploader();
            uploader.upload.mockRejectedValue(new Error("boom"));

            const result = await handlerFor(uploader).handleFile("game.StormReplay");

            expect(result.kind).toBe("failed");
            await expect(stat(join(dir, "game.StormReplay"))).resolves.toBeDefined();
            await expect(archived()).rejects.toThrow();
        });

        it("does not overwrite a replay already in the archive", async () => {
            await mkdir(join(dir, "archived"));
            await writeFile(join(dir, "archived", "game.StormReplay"), mpq("the original"));
            await writeFile(join(dir, "game.StormReplay"), mpq("a different replay"));

            const result = await handlerFor(fakeUploader()).handleFile("game.StormReplay");

            expect(result).toMatchObject({
                kind: "uploaded",
                archivedTo: join(dir, "archived", "game (2).StormReplay"),
            });
            expect((await archived()).sort()).toEqual([
                "game (2).StormReplay",
                "game.StormReplay",
            ]);
            expect(await readFile(join(dir, "archived", "game.StormReplay"))).toEqual(
                mpq("the original"),
            );
        });

        it("still reports the upload as done when archiving fails", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));
            // A file where the archive directory should go makes mkdir fail.
            await writeFile(join(dir, "archived"), "not a directory");

            const result = await handlerFor(fakeUploader()).handleFile("game.StormReplay");

            expect(result).toMatchObject({ kind: "uploaded", archivedTo: null });
            expect(state.states[0]?.is_uploaded).toBe(true);
        });

        it("can be turned off", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));

            const result = await handlerFor(fakeUploader(), false).handleFile("game.StormReplay");

            expect(result).toMatchObject({ kind: "uploaded", archivedTo: null });
            await expect(stat(join(dir, "game.StormReplay"))).resolves.toBeDefined();
        });
        it("archives a replay that an earlier run already uploaded", async () => {
            const content = mpq("uploaded by a previous run");
            state.add({
                name: "old.StormReplay",
                sha256: sha512Base64(content),
                seen_at: new Date().toISOString(),
                ts: new Date().toISOString(),
                is_uploaded: true,
            });
            await writeFile(join(dir, "old.StormReplay"), content);
            const uploader = fakeUploader();

            const result = await handlerFor(uploader).handleFile("old.StormReplay");

            expect(result).toMatchObject({
                kind: "skipped",
                reason: "already-uploaded",
                archivedTo: join(dir, "archived", "old.StormReplay"),
            });
            expect(uploader.upload).not.toHaveBeenCalled();
            expect(await archived()).toEqual(["old.StormReplay"]);
            await expect(stat(join(dir, "old.StormReplay"))).rejects.toThrow();
        });
    });

    describe("format checking", () => {
        it("skips a file with the right extension but no MPQ header", async () => {
            // Exactly what a stray text file renamed to .StormReplay looks like.
            await writeFile(join(dir, "junk.StormReplay"), "not really a replay");
            const uploader = fakeUploader();

            const result = await handlerFor(uploader).handleFile("junk.StormReplay");

            expect(result).toMatchObject({ kind: "skipped", reason: "not-an-mpq" });
            expect(uploader.upload).not.toHaveBeenCalled();
            await expect(stat(join(dir, "junk.StormReplay"))).resolves.toBeDefined();
        });

        it("accepts the archive-header marker as well as the user-data one", async () => {
            const content = Buffer.concat([
                Buffer.from("MPQ\x1a", "latin1"),
                Buffer.from("archive header replay"),
            ]);
            await writeFile(join(dir, "game.StormReplay"), content);

            const result = await handlerFor(fakeUploader()).handleFile("game.StormReplay");

            expect(result.kind).toBe("uploaded");
        });
    });

    describe("Heroes Profile verdicts", () => {
        it("records the replay id, fingerprint and status on the entry", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));
            const uploader = fakeUploader({
                status: "Success",
                replayId: 65133342,
                fingerprint: "397876d4-f18b-d46d-e683-31eabbf30ea1",
            });

            await handlerFor(uploader).handleFile("game.StormReplay");

            expect(state.states[0]?.replay).toEqual({
                fingerprint: "397876d4-f18b-d46d-e683-31eabbf30ea1",
                replay_id: 65133342,
                status: "Success",
            });
        });

        it("treats Duplicate as uploaded", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));

            const result = await handlerFor(
                fakeUploader({ status: "Duplicate", replayId: 42 }),
            ).handleFile("game.StormReplay");

            expect(result.kind).toBe("uploaded");
            expect(state.states[0]?.is_uploaded).toBe(true);
        });

        it("reports a rejected replay as rejected, not uploaded", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));

            const result = await handlerFor(fakeUploader({ status: "AiDetected" })).handleFile(
                "game.StormReplay",
            );

            expect(result.kind).toBe("rejected");
            expect(state.states[0]).toMatchObject({
                is_uploaded: false,
                replay: { status: "AiDetected" },
            });
        });

        it("archives a rejected replay so it is never sent again", async () => {
            await writeFile(join(dir, "game.StormReplay"), mpq("content"));

            const result = await handlerFor(fakeUploader({ status: "TooOld" })).handleFile(
                "game.StormReplay",
            );

            expect(result).toMatchObject({
                kind: "rejected",
                archivedTo: join(dir, "archived", "game.StormReplay"),
            });
            await expect(stat(join(dir, "game.StormReplay"))).rejects.toThrow();
        });

        it("does not re-upload a replay a previous run had rejected", async () => {
            const content = mpq("rejected last time");
            state.add({
                name: "game.StormReplay",
                sha256: sha512Base64(content),
                seen_at: new Date().toISOString(),
                ts: new Date().toISOString(),
                is_uploaded: false,
                replay: { status: "CustomGame" },
            });
            await writeFile(join(dir, "game.StormReplay"), content);
            const uploader = fakeUploader();

            const result = await handlerFor(uploader).handleFile("game.StormReplay");

            expect(result).toMatchObject({ kind: "skipped", reason: "already-uploaded" });
            expect(uploader.upload).not.toHaveBeenCalled();
        });
    });
});
