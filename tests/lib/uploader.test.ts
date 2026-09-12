import { describe, expect, it, vi } from "vitest";
import {
    asUploadStatus,
    isAccepted,
    matchUrl,
    UPLOAD_URL,
    Uploader,
    USER_AGENT,
} from "../../src/lib/uploader.js";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

/** A fetch stub that records every upload request and replies with `onUpload`. */
const stubFetch = (onUpload: (call: number) => Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return onUpload(calls.length);
    }) as unknown as typeof fetch;
    return { impl, calls };
};

const uploaderFor = (
    impl: typeof fetch,
    maxTries: number,
    sleep = vi.fn(async (_ms: number) => {}),
) => new Uploader({ maxTries, fetchImpl: impl, sleep });

describe("status helpers", () => {
    it("accepts Success and Duplicate", () => {
        expect(isAccepted("Success")).toBe(true);
        expect(isAccepted("Duplicate")).toBe(true);
    });

    it("rejects the verdicts that mean Heroes Profile will not use the replay", () => {
        for (const status of ["AiDetected", "CustomGame", "PtrRegion", "TooOld", "Incomplete"] as const) {
            expect(isAccepted(status), status).toBe(false);
        }
    });

    it("maps an unrecognised status to UnknownCode rather than trusting it", () => {
        expect(asUploadStatus("Sideways")).toBe("UnknownCode");
        expect(asUploadStatus(undefined)).toBe("UnknownCode");
        expect(asUploadStatus("Success")).toBe("Success");
    });

    it("builds the match page URL", () => {
        expect(matchUrl(65133342)).toBe(
            "https://www.heroesprofile.com/Match/Single/?replayID=65133342",
        );
    });
});

describe("Uploader", () => {
    it("posts to the endpoint that returns a replayID, with a version parameter", async () => {
        const { impl, calls } = stubFetch(() => json({ status: "Success", replayID: 1 }));

        await uploaderFor(impl, 1).upload("game.StormReplay", Buffer.from("bytes"));

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toMatch(new RegExp(`^${UPLOAD_URL}\\?version=`));
        expect(calls[0]!.init.method).toBe("POST");
    });

    // The Go original fetched XSRF-TOKEN and heroesprofileapi_session first; this
    // endpoint needs neither, so there should be no session request at all.
    it("sends no cookies and makes no session request", async () => {
        const { impl, calls } = stubFetch(() => json({ status: "Success", replayID: 1 }));

        await uploaderFor(impl, 1).upload("game.StormReplay", Buffer.from("bytes"));

        expect(calls).toHaveLength(1);
        const headers = calls[0]!.init.headers as Record<string, string>;
        expect(headers.Cookie).toBeUndefined();
        expect(headers["User-Agent"]).toBe(USER_AGENT);
        expect(headers.Accept).toBe("application/json");
    });

    it("posts the file under the 'file' field, named after the replay", async () => {
        const { impl, calls } = stubFetch(() => json({ status: "Success", replayID: 1 }));

        await uploaderFor(impl, 1).upload("sub/game.StormReplay", Buffer.from("replay-bytes"));

        const file = (calls[0]!.init.body as FormData).get("file");
        expect((file as File).name).toBe("sub/game.StormReplay");
        expect(await (file as Blob).text()).toBe("replay-bytes");
    });

    it("returns the replayID, fingerprint and status", async () => {
        const { impl } = stubFetch(() =>
            json({ fingerprint: "397876d4-f18b-d46d-e683-31eabbf30ea1", replayID: 65133342, status: "Duplicate" }),
        );

        const result = await uploaderFor(impl, 1).upload("game.StormReplay", Buffer.from("x"));

        expect(result).toEqual({
            status: "Duplicate",
            replayId: 65133342,
            fingerprint: "397876d4-f18b-d46d-e683-31eabbf30ea1",
        });
    });

    it("tolerates a reply with only a status", async () => {
        const { impl } = stubFetch(() => json({ status: "Success" }));

        const result = await uploaderFor(impl, 1).upload("game.StormReplay", Buffer.from("x"));

        expect(result).toEqual({ status: "Success", replayId: undefined, fingerprint: undefined });
    });

    it("retries a failing upload up to maxTries and then throws", async () => {
        const { impl, calls } = stubFetch(() => new Response("nope", { status: 500 }));

        await expect(
            uploaderFor(impl, 3).upload("game.StormReplay", Buffer.from("x")),
        ).rejects.toThrow(/status=500/);
        expect(calls).toHaveLength(3);
    });

    it("retries a 2xx whose body cannot be read rather than recording it as done", async () => {
        const { impl, calls } = stubFetch((n) =>
            n < 2 ? new Response("<html>maintenance</html>", { status: 200 }) : json({ status: "Success" }),
        );

        const result = await uploaderFor(impl, 3).upload("game.StormReplay", Buffer.from("x"));

        expect(calls).toHaveLength(2);
        expect(result.status).toBe("Success");
    });

    it("backs off linearly, capped at 15s, and does not sleep after the last try", async () => {
        const sleep = vi.fn(async (_ms: number) => {});
        const { impl } = stubFetch(() => new Response("nope", { status: 500 }));

        await expect(
            uploaderFor(impl, 4, sleep).upload("game.StormReplay", Buffer.from("x")),
        ).rejects.toThrow();

        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([0, 15_000, 15_000]);
    });

    // The Go implementation reused one already-consumed io.Reader across retries,
    // so every attempt after the first uploaded an empty body.
    it("sends the full file body on every retry", async () => {
        const { impl, calls } = stubFetch((n) =>
            n < 3 ? new Response("nope", { status: 500 }) : json({ status: "Success" }),
        );

        await uploaderFor(impl, 5).upload("game.StormReplay", Buffer.from("replay-bytes"));

        expect(calls).toHaveLength(3);
        for (const call of calls) {
            expect(await ((call.init.body as FormData).get("file") as Blob).text()).toBe(
                "replay-bytes",
            );
        }
    });
});
