import { MpqFile } from "mpq-file";
import { decodeVersioned, type VersionedValue } from "./versioned-decoder.js";

/**
 * `replay.details` field tags, read off a decoded real replay rather than taken
 * from a protocol table. They are verified by the map cross-check in
 * tests/lib/replay-details.test.ts: a replay's decoded map must equal the map in
 * its own filename.
 */
const DETAILS = { PLAYERS: 0, MAP: 1, TIMESTAMP: 5 } as const;
const PLAYER = { NAME: 0, TOON: 1, TEAM: 5, RESULT: 8, HERO: 10 } as const;
const TOON = { ID: 4 } as const;

/** `m_result` as the game records it. */
export const RESULT_WIN = 1;
export const RESULT_LOSS = 2;

/** Ticks (100 ns each) between the FILETIME epoch (1601-01-01) and the Unix one. */
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000;

/**
 * `replay.details` tag 5: a Windows FILETIME, 100 ns ticks since 1601-01-01.
 *
 * On disk this is a VINT, not a U64 — the versioned format picks whichever tag
 * the encoder used, and a real replay's decodes to a `number`, not a `bigint`.
 * A `number` this large (~1.3e17) is well past `Number.MAX_SAFE_INTEGER`, but it
 * was already built by `VersionedDecoder.vint()` as a sum of exact powers of
 * two, so it is still an integer `BigInt()` can take directly — losing at most
 * a handful of low-order ticks, which is nothing at millisecond resolution
 * (10,000 ticks = 1 ms).
 */
const filetimeToIso = (ticks: number | bigint): string => {
    const wholeTicks = typeof ticks === "bigint" ? ticks : BigInt(Math.round(ticks));
    return new Date(Number(wholeTicks / 10_000n) - FILETIME_EPOCH_OFFSET_MS).toISOString();
};

export interface ReplayPlayer {
    toonId: number;
    hero: string;
    team: number;
    /** 1 won, 2 lost, 0 undecided. */
    result: number;
}

export interface ReplayDetails {
    map: string;
    players: ReplayPlayer[];
    /** When the game was played, ISO, if the timestamp field could be read. */
    playedAt?: string;
}

const asStruct = (value: VersionedValue): { [tag: number]: VersionedValue } | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
        ? (value as { [tag: number]: VersionedValue })
        : null;

const asText = (value: VersionedValue): string =>
    Buffer.isBuffer(value) ? value.toString("utf8") : "";

const asNumber = (value: VersionedValue): number =>
    typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : 0;

/**
 * Pulls the match out of a decoded `replay.details`.
 *
 * Player *names* are deliberately not read: Heroes of the Storm anonymises them
 * in the replay, so they are meaningless strings. Toon ids and heroes are real.
 */
export const parseReplayDetails = (raw: Buffer): ReplayDetails | null => {
    let root: { [tag: number]: VersionedValue } | null;
    try {
        root = asStruct(decodeVersioned(raw));
    } catch {
        // The null return is a promise to callers that this never throws.
        return null;
    }

    const playerList = root?.[DETAILS.PLAYERS];
    if (root === null || !Array.isArray(playerList)) {
        return null;
    }

    const players: ReplayPlayer[] = [];
    for (const entry of playerList) {
        const player = asStruct(entry);
        const toon = player === null ? null : asStruct(player[PLAYER.TOON]);
        if (player === null || toon === null) {
            continue;
        }
        players.push({
            toonId: asNumber(toon[TOON.ID]),
            hero: asText(player[PLAYER.HERO]),
            team: asNumber(player[PLAYER.TEAM]),
            result: asNumber(player[PLAYER.RESULT]),
        });
    }

    const timestamp = root[DETAILS.TIMESTAMP];
    const playedAt =
        typeof timestamp === "number" || typeof timestamp === "bigint"
            ? filetimeToIso(timestamp)
            : undefined;

    return { map: asText(root[DETAILS.MAP]), players, playedAt };
};

/**
 * Reads the match out of a `.StormReplay` on disk, or null if it cannot be read.
 * Never throws: a replay we cannot parse should still upload.
 */
export const readReplayDetails = (path: string): ReplayDetails | null => {
    try {
        const archive = new MpqFile(path, false);
        return parseReplayDetails(archive.openFile("replay.details").readFile().buffer);
    } catch {
        // Not an MPQ archive, or no details block in it.
        return null;
    }
};

/** The compact form stored in state.json. */
export const toMatchDetails = (details: ReplayDetails) => ({
    map: details.map,
    players: details.players.map(
        (p) => [p.toonId, p.hero, p.result] as [number, string, number],
    ),
    playedAt: details.playedAt,
});
