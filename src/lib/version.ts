// Imported statically so the bundler inlines it at build time. Reading
// package.json at runtime would only resolve from the source tree, which the
// self-contained build rejects.
import pkg from "../../package.json" with { type: "json" };

/** Sent as the `version` query parameter on uploads. */
export const version: string = pkg.version;
