import { createHash } from "node:crypto";

/**
 * The dedup key used by the original Go uploader: base64(SHA-512(content)).
 *
 * The field is called `sha256` in `state.json`, but it never was SHA-256. The
 * name is kept for compatibility with existing state files.
 */
export const sha512Base64 = (content: Buffer): string =>
    createHash("sha512").update(content).digest("base64");
