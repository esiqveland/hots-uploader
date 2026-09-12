import { describe, expect, it } from "vitest";
import {
    formatDate,
    formatDateTime,
    formatIsoDateTime,
    formatRelativeTime,
    formatTime,
} from "../../src/lib/format.js";

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

describe("formatRelativeTime", () => {
    const now = new Date(2026, 8, 12, 12, 0, 0);
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

    it("says just now for anything under a minute", () => {
        expect(formatRelativeTime(ago(30 * 1000), now)).toBe("just now");
        expect(formatRelativeTime(now.toISOString(), now)).toBe("just now");
    });

    it("counts minutes", () => {
        expect(formatRelativeTime(ago(3 * 60 * 1000), now)).toBe("3 minutes ago");
        expect(formatRelativeTime(ago(60 * 1000), now)).toBe("1 minute ago");
    });

    it("counts hours", () => {
        expect(formatRelativeTime(ago(4 * 60 * 60 * 1000), now)).toBe("4 hours ago");
        expect(formatRelativeTime(ago(60 * 60 * 1000), now)).toBe("1 hour ago");
    });

    it("counts days, weeks, months and years", () => {
        expect(formatRelativeTime(ago(2 * 24 * 60 * 60 * 1000), now)).toBe("2 days ago");
        expect(formatRelativeTime(ago(9 * 24 * 60 * 60 * 1000), now)).toBe("1 week ago");
        expect(formatRelativeTime(ago(65 * 24 * 60 * 60 * 1000), now)).toBe("2 months ago");
        expect(formatRelativeTime(ago(400 * 24 * 60 * 60 * 1000), now)).toBe("1 year ago");
    });

    it("returns the raw value when the timestamp cannot be parsed", () => {
        expect(formatRelativeTime("not a date", now)).toBe("not a date");
    });
});
