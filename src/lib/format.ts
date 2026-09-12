const pad = (value: number): string => String(value).padStart(2, "0");

/** `01:04:56`, 24-hour. */
export const formatTime = (date: Date): string =>
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

/** `12.09.2026`, day first. */
export const formatDate = (date: Date): string =>
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;

/** `12.09.2026 01:04:56`. */
export const formatDateTime = (date: Date): string => `${formatDate(date)} ${formatTime(date)}`;

/** Formats an ISO timestamp, falling back to the raw value if it is unparseable. */
export const formatIsoDateTime = (iso: string): string => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : formatDateTime(date);
};

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

const UNITS: [number, string][] = [
    [YEAR, "year"],
    [MONTH, "month"],
    [WEEK, "week"],
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
];

/**
 * `4 hours ago`, `3 minutes ago`. Spelled out by hand rather than through
 * `Intl.RelativeTimeFormat`, matching the rest of this file.
 */
export const formatRelativeTime = (iso: string, now: Date = new Date()): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }

    const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
    if (seconds < MINUTE) {
        return "just now";
    }

    for (const [unitSeconds, label] of UNITS) {
        if (seconds >= unitSeconds) {
            const count = Math.floor(seconds / unitSeconds);
            return `${count} ${label}${count === 1 ? "" : "s"} ago`;
        }
    }

    const count = Math.floor(seconds / MINUTE);
    return `${count} minute${count === 1 ? "" : "s"} ago`;
};
