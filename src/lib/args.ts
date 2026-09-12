export interface CliArgs {
    /** Replay folder to watch, overriding the saved setting. */
    watchDir?: string;
    /** A state.json from the Go uploader to adopt on first run. */
    importState?: string;
    help: boolean;
}

export const USAGE = `HotS Replay Uploader

Usage:
  hotsreplayuploader [options]

Options:
  -d, --dir <path>       Watch this replay folder instead of the saved one
      --import-state <f> Adopt an upload history written by the Go uploader,
                         so replays it already sent are not sent again
  -h, --help             Show this message and exit

The folder is remembered, so --dir is only needed to change it.`;

const DIR_FLAGS = new Set(["--dir", "-dir", "-d"]);
const IMPORT_FLAGS = new Set(["--import-state", "-import-state"]);
const HELP_FLAGS = new Set(["--help", "-help", "-h"]);

/**
 * Parses the arguments this app understands, ignoring anything else so the dev
 * runner's own flags do not break startup.
 *
 * Accepts both `--dir path` and `--dir=path`, and the single-dash `-dir` spelling
 * the Go version used.
 */
export const parseArgs = (argv: readonly string[]): CliArgs => {
    const args: CliArgs = { help: false };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        const equals = arg.indexOf("=");
        const [flag, inlineValue] =
            equals > 0 ? [arg.slice(0, equals), arg.slice(equals + 1)] : [arg, undefined];

        if (HELP_FLAGS.has(flag)) {
            args.help = true;
        } else if (DIR_FLAGS.has(flag)) {
            const value = inlineValue ?? argv[++i];
            if (value !== undefined && value !== "") {
                args.watchDir = value;
            }
        } else if (IMPORT_FLAGS.has(flag)) {
            const value = inlineValue ?? argv[++i];
            if (value !== undefined && value !== "") {
                args.importState = value;
            }
        }
    }

    return args;
};

/** Arguments this process was started with, excluding the node binary and script. */
export const processArgs = (): CliArgs => parseArgs(process.argv.slice(2));
