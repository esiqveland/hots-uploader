import { Tag } from "../../src/lib/versioned-decoder.js";

/**
 * Encoders for the versioned format, so tests can build byte streams by hand.
 *
 * Fixtures are synthetic on purpose: a real `replay.details` block carries the
 * account ids of ten actual players, which has no place in the repository.
 */
export const vint = (value: number): number[] => {
    const negative = value < 0;
    let remaining = Math.abs(value);
    let first = ((remaining & 0x3f) << 1) | (negative ? 1 : 0);
    remaining = Math.floor(remaining / 64);
    const bytes: number[] = [];
    if (remaining > 0) {
        first |= 0x80;
    }
    bytes.push(first);
    while (remaining > 0) {
        let byte = remaining & 0x7f;
        remaining = Math.floor(remaining / 128);
        if (remaining > 0) {
            byte |= 0x80;
        }
        bytes.push(byte);
    }
    return bytes;
};

export const blob = (text: string): number[] => [
    Tag.BLOB,
    ...vint(Buffer.byteLength(text)),
    ...Buffer.from(text),
];
export const int = (value: number): number[] => [Tag.VINT, ...vint(value)];

/**
 * Same encoding as `vint`, but bigint-based so it works past 2^53 — needed for
 * FILETIME timestamps, which a real replay encodes as a VINT despite being
 * ~1.3e17. `vint`'s bitwise ops (`&`, `<<`) coerce through int32 in JS, which
 * silently mangles anything this large.
 */
export const vintBig = (value: bigint): number[] => {
    const negative = value < 0n;
    let remaining = negative ? -value : value;
    let first = Number(remaining & 0x3fn) * 2 + (negative ? 1 : 0);
    remaining >>= 6n;
    const bytes: number[] = [];
    if (remaining > 0n) {
        first |= 0x80;
    }
    bytes.push(first);
    while (remaining > 0n) {
        let byte = Number(remaining & 0x7fn);
        remaining >>= 7n;
        if (remaining > 0n) {
            byte |= 0x80;
        }
        bytes.push(byte);
    }
    return bytes;
};
export const bigInt = (value: bigint): number[] => [Tag.VINT, ...vintBig(value)];
export const struct = (fields: [number, number[]][]): number[] => [
    Tag.STRUCT,
    ...vint(fields.length),
    ...fields.flatMap(([tag, value]) => [...vint(tag), ...value]),
];
export const array = (items: number[][]): number[] => [
    Tag.ARRAY,
    ...vint(items.length),
    ...items.flat(),
];

export interface FixturePlayer {
    toonId: number;
    hero: string;
    team: number;
    result: number;
}

/** A `replay.details` blob shaped exactly like the real thing. */
export const detailsFixture = (
    map: string,
    players: FixturePlayer[],
    playedAt?: bigint,
): Buffer =>
    Buffer.from(
        struct([
            [
                0,
                array(
                    players.map((p) =>
                        struct([
                            // Names are anonymised by the game itself.
                            [0, blob("anonymised")],
                            [1, struct([[0, int(2)], [2, int(1)], [4, int(p.toonId)]])],
                            [5, int(p.team)],
                            [8, int(p.result)],
                            [10, blob(p.hero)],
                        ]),
                    ),
                ),
            ],
            [1, blob(map)],
            ...(playedAt === undefined ? [] : ([[5, bigInt(playedAt)]] as [number, number[]][])),
            [11, int(0)],
        ]),
    );
