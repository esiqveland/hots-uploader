import { describe, expect, it } from "vitest";
import { decodeVersioned, Tag, VersionedDecoder } from "../../src/lib/versioned-decoder.js";
import { array, blob, int, struct, vint } from "./versioned-fixtures.js";

const buf = (bytes: number[]): Buffer => Buffer.from(bytes);

describe("vint", () => {
    it("round-trips small, large and negative values", () => {
        for (const value of [0, 1, 63, 64, 127, 128, 8191, 1_000_000, 14_283_239, -1, -1000]) {
            expect(new VersionedDecoder(buf(vint(value))).vint(), String(value)).toBe(value);
        }
    });

    it("reads values beyond 32 bits without wrapping", () => {
        const value = 134_336_394_227_681_700;
        expect(new VersionedDecoder(buf(vint(value))).vint()).toBe(value);
    });
});

describe("decodeVersioned", () => {
    it("reads each tag", () => {
        expect(decodeVersioned(buf(blob("Sky Temple")))).toEqual(Buffer.from("Sky Temple"));
        expect(decodeVersioned(buf(int(42)))).toBe(42);
        expect(decodeVersioned(buf([Tag.U8, 7]))).toBe(7);
        expect(decodeVersioned(buf([Tag.U32, 1, 0, 0, 0]))).toBe(1);
        expect(decodeVersioned(buf([Tag.U64, 2, 0, 0, 0, 0, 0, 0, 0]))).toBe(2n);
        expect(decodeVersioned(buf([Tag.OPTIONAL, 0]))).toBeNull();
        expect(decodeVersioned(buf([Tag.OPTIONAL, 1, ...int(5)]))).toBe(5);
        expect(decodeVersioned(buf([Tag.CHOICE, ...vint(3), ...int(9)]))).toEqual({
            choice: 3,
            value: 9,
        });
    });

    it("keys structs by their field tag", () => {
        const encoded = struct([
            [1, blob("Sky Temple")],
            [11, int(0)],
        ]);

        expect(decodeVersioned(buf(encoded))).toEqual({
            1: Buffer.from("Sky Temple"),
            11: 0,
        });
    });

    it("reads nested arrays of structs", () => {
        const encoded = struct([
            [0, array([struct([[10, blob("Genji")]]), struct([[10, blob("Muradin")]])])],
        ]);

        const root = decodeVersioned(buf(encoded)) as Record<number, unknown>;
        const players = root[0] as Record<number, Buffer>[];
        expect(players.map((p) => p[10]!.toString())).toEqual(["Genji", "Muradin"]);
    });

    // This is the property the whole approach rests on: a field nobody has a
    // name for can still be walked past, using only the tags in the stream.
    it("walks past a field it knows nothing about", () => {
        const encoded = struct([
            [0, blob("before")],
            [99, array([struct([[1, [Tag.U64, 8, 7, 6, 5, 4, 3, 2, 1]]]), blob("junk")])],
            [1, blob("after")],
        ]);

        const root = decodeVersioned(buf(encoded)) as Record<number, Buffer>;
        expect(root[0]!.toString()).toBe("before");
        expect(root[1]!.toString()).toBe("after");
    });

    it("insists the whole buffer was consumed", () => {
        expect(() => decodeVersioned(buf([...int(1), 0x00]))).toThrow(/bytes left/);
    });

    it("rejects an unknown tag rather than guessing", () => {
        expect(() => decodeVersioned(buf([0x0f]))).toThrow(/unknown tag 15/);
    });

    it("rejects a blob that runs past the end", () => {
        expect(() => decodeVersioned(buf([Tag.BLOB, ...vint(50), 1, 2, 3]))).toThrow(/past end/);
    });
});
