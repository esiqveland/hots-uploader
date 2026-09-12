import { describe, expect, it } from "vitest";
import { StateFile, type UploadState } from "../../src/lib/state.js";

const entry = (sha256: string, overrides: Partial<UploadState> = {}): UploadState => ({
    name: `${sha256}.StormReplay`,
    sha256,
    seen_at: "2024-11-11T23:38:06.011Z",
    ts: "2024-11-11T23:38:05.092Z",
    is_uploaded: true,
    ...overrides,
});

describe("StateFile", () => {
    it("prepends unseen entries so the list stays newest-first", () => {
        const state = StateFile.empty("/tmp/unused.json");
        state.add(entry("a"));
        state.add(entry("b"));
        state.add(entry("c"));

        expect(state.states.map((s) => s.sha256)).toEqual(["c", "b", "a"]);
    });

    it("replaces a matching sha in place rather than adding a duplicate", () => {
        const state = StateFile.empty("/tmp/unused.json");
        state.add(entry("a"));
        state.add(entry("b"));
        state.add(entry("a", { name: "renamed.StormReplay" }));

        expect(state.states).toHaveLength(2);
        expect(state.states.map((s) => s.sha256)).toEqual(["b", "a"]);
        expect(state.find("a")?.name).toBe("renamed.StormReplay");
    });

    it("maps sha to upload status", () => {
        const state = StateFile.empty("/tmp/unused.json");
        state.add(entry("done", { is_uploaded: true }));
        state.add(entry("pending", { is_uploaded: false }));

        expect(state.filesDone().get("done")).toBe(true);
        expect(state.filesDone().get("pending")).toBe(false);
        expect(state.filesDone().get("unknown")).toBeUndefined();
    });

    it("round-trips the Go state.json shape without losing fields", () => {
        const json = JSON.stringify({
            states: [
                {
                    name: "2024-11-11 23.38.04 Sky Temple.StormReplay",
                    sha256: "maEudb0R+rhzeHbzN28E6ADI3uFeQYGBM+FMY0/OoY8=",
                    seen_at: "2024-11-11T23:38:06.011640356+01:00",
                    ts: "2024-11-11T23:38:05.092392876+01:00",
                    is_uploaded: true,
                },
            ],
        });

        const reserialized = StateFile.fromJson(json, "/tmp/unused.json").toJson();

        expect(JSON.parse(reserialized)).toEqual(JSON.parse(json));
    });

    it("treats a missing states key as an empty history", () => {
        expect(StateFile.fromJson("{}", "/tmp/unused.json").states).toEqual([]);
    });
});
