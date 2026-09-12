export interface Season {
    name: string;
    /** Inclusive. */
    start: Date;
    /** Exclusive. */
    end: Date;
}

/**
 * Ranked season boundaries, confirmed from
 * https://nexuscompendium.com/ranked/{2025-season-1,2025-season-2,2025-season-3,2026-season-1}.
 * There is no season field anywhere in the replay or the Heroes Profile API
 * (checked `replay.details`, `replay.attributes.events`, and every endpoint
 * `/openApi/endpoint-limits` lists) — see roadmap.md. This table, plus the
 * played-at timestamp already read from `replay.details`, is the only way to
 * derive one.
 */
const KNOWN_SEASONS: Season[] = [
    {
        name: "2025 Season 1",
        start: new Date("2025-02-02T00:00:00Z"),
        end: new Date("2025-06-02T00:00:00Z"),
    },
    {
        name: "2025 Season 2",
        start: new Date("2025-06-02T00:00:00Z"),
        end: new Date("2025-10-02T00:00:00Z"),
    },
    {
        name: "2025 Season 3",
        start: new Date("2025-10-02T00:00:00Z"),
        end: new Date("2026-02-02T00:00:00Z"),
    },
    {
        name: "2026 Season 1",
        start: new Date("2026-02-02T00:00:00Z"),
        end: new Date("2026-06-02T00:00:00Z"),
    },
];

const SLOT_NAMES = ["Season 1", "Season 2", "Season 3"];

const addMonthsUtc = (date: Date, months: number): Date =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));

/** Every confirmed season starts in February, June or October. */
const nameForStart = (start: Date): string => {
    const slot = start.getUTCMonth() === 1 ? 0 : start.getUTCMonth() === 5 ? 1 : 2;
    return `${start.getUTCFullYear()} ${SLOT_NAMES[slot]}`;
};

/**
 * Which ranked season a date falls in, or undefined for anything before the
 * first confirmed season (2025-02-02) — there is no boundary to anchor it to.
 *
 * Every confirmed season has run exactly 4 calendar months, starting the 2nd of
 * February, June or October. Past the last confirmed one (2026 Season 1, ending
 * 2026-06-02 — the newest Nexus Compendium has published), boundaries are
 * projected forward using that same cadence. That projection is not a confirmed
 * date: if Blizzard ever breaks the cadence, only the current, projected season
 * is wrong — the confirmed table above is unaffected either way.
 */
export const seasonOf = (date: Date): Season | undefined => {
    const first = KNOWN_SEASONS[0]!;
    if (date.getTime() < first.start.getTime()) {
        return undefined;
    }

    for (const season of KNOWN_SEASONS) {
        if (date >= season.start && date < season.end) {
            return season;
        }
    }

    let start = KNOWN_SEASONS[KNOWN_SEASONS.length - 1]!.end;
    for (;;) {
        const end = addMonthsUtc(start, 4);
        if (date >= start && date < end) {
            return { name: nameForStart(start), start, end };
        }
        start = end;
    }
};
