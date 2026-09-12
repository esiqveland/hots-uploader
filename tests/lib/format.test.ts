import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatIsoDateTime, formatTime } from "../../src/lib/format.js";

describe("date formatting", () => {
    const date = new Date(2026, 8, 5, 1, 4, 6);

    it("writes the day first, zero-padded", () => {
        expect(formatDate(date)).toBe("05.09.2026");
    });

    it("writes 24-hour time, zero-padded", () => {
        expect(formatTime(date)).toBe("01:04:06");
    });

    it("combines date and time", () => {
        expect(formatDateTime(date)).toBe("05.09.2026 01:04:06");
    });

    it("uses a 24-hour clock for afternoon times", () => {
        expect(formatTime(new Date(2026, 8, 5, 22, 39, 21))).toBe("22:39:21");
    });

    it("formats an ISO timestamp from state.json", () => {
        const iso = new Date(2024, 10, 11, 23, 38, 6).toISOString();
        expect(formatIsoDateTime(iso)).toBe("11.11.2024 23:38:06");
    });

    it("returns the raw value when the timestamp cannot be parsed", () => {
        expect(formatIsoDateTime("not a date")).toBe("not a date");
    });
});
