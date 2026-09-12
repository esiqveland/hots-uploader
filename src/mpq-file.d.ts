/**
 * `mpq-file` ships no types. Only the sliver this project uses is declared here:
 * opening an archive and reading one stored file out of it.
 */
declare module "mpq-file" {
    class MpqBuffer {
        readonly buffer: Buffer;
    }

    class MpqStream {
        readFile(): MpqBuffer;
    }

    export class MpqFile {
        /** `loadListFile` is off for replays: they carry no (listfile). */
        constructor(path: string, loadListFile?: boolean);
        openFile(filename: string): MpqStream;
    }
}
