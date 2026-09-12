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
