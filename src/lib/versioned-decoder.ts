/**
 * Reader for Blizzard's "versioned" serialisation, the format `replay.details`
 * uses.
 *
 * The point of this file is that the format is **self-describing**: every value
 * is preceded by a tag byte saying what it is, and an unknown struct field can be
 * skipped by walking its tags alone. That is why this needs none of the per-build
 * protocol tables that `replay.initdata` (a different, bit-packed format with no
 * tags at all) cannot be read without.
 *
 * Structs come back keyed by their numeric field tag, because without the
 * protocol tables the tags are all the names there are.
 */

export const Tag = {
    ARRAY: 0,
    BITBLOB: 1,
    BLOB: 2,
    CHOICE: 3,
    OPTIONAL: 4,
    STRUCT: 5,
    U8: 6,
    U32: 7,
    U64: 8,
    VINT: 9,
} as const;

export type VersionedValue =
    | VersionedValue[]
    | Buffer
    | number
    | bigint
    | null
    | { [tag: number]: VersionedValue }
    | { choice: number; value: VersionedValue };

export class VersionedDecoder {
    private offset = 0;

    constructor(private readonly buffer: Buffer) {}

    /** How far through the buffer the decoder is; equal to its length when done. */
    get position(): number {
        return this.offset;
    }

    get isAtEnd(): boolean {
        return this.offset >= this.buffer.length;
    }

    private byte(): number {
        if (this.offset >= this.buffer.length) {
            throw new Error("versioned: read past end of buffer");
        }
        return this.buffer[this.offset++]!;
    }

    private slice(length: number): Buffer {
        if (length < 0 || this.offset + length > this.buffer.length) {
            throw new Error("versioned: blob runs past end of buffer");
        }
        const value = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
    }

    /**
     * The variable-length integer from Blizzard's decoders: seven bits per byte,
     * with the low bit of the first byte carrying the sign.
     *
     * Arithmetic rather than bit shifts, because these exceed 32 bits and `<<`
     * would silently wrap.
     */
    vint(): number {
        let byte = this.byte();
        const isNegative = (byte & 0x01) !== 0;
        let value = (byte >> 1) & 0x3f;
        let shift = 6;

        while ((byte & 0x80) !== 0) {
            byte = this.byte();
            value += (byte & 0x7f) * 2 ** shift;
            shift += 7;
        }

        return isNegative ? -value : value;
    }

    /** Reads the next value, whatever it is, from its tag. */
    instance(): VersionedValue {
        const tag = this.byte();

        switch (tag) {
            case Tag.ARRAY: {
                const length = this.vint();
                const items: VersionedValue[] = [];
                for (let i = 0; i < length; i++) {
                    items.push(this.instance());
                }
                return items;
            }
            case Tag.BITBLOB:
                return this.slice(Math.ceil(this.vint() / 8));
            case Tag.BLOB:
                return this.slice(this.vint());
            case Tag.CHOICE:
                return { choice: this.vint(), value: this.instance() };
            case Tag.OPTIONAL:
                return this.byte() !== 0 ? this.instance() : null;
            case Tag.STRUCT: {
                const length = this.vint();
                const fields: { [tag: number]: VersionedValue } = {};
                for (let i = 0; i < length; i++) {
                    fields[this.vint()] = this.instance();
                }
                return fields;
            }
            case Tag.U8:
                return this.slice(1)[0]!;
            case Tag.U32: {
                const value = this.buffer.readUInt32LE(this.offset);
                this.offset += 4;
                return value;
            }
            case Tag.U64: {
                const value = this.buffer.readBigUInt64LE(this.offset);
                this.offset += 8;
                return value;
            }
            case Tag.VINT:
                return this.vint();
            default:
                throw new Error(`versioned: unknown tag ${tag} at offset ${this.offset - 1}`);
        }
    }
}

/** Reads one value and insists the whole buffer was consumed. */
export const decodeVersioned = (buffer: Buffer): VersionedValue => {
    const decoder = new VersionedDecoder(buffer);
    const value = decoder.instance();
    if (!decoder.isAtEnd) {
        throw new Error(
            `versioned: ${buffer.length - decoder.position} bytes left after decoding`,
        );
    }
    return value;
};
