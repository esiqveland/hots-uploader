# HotS Replay Uploader

Watches your Heroes of the Storm replay folder and uploads every new match to
[Heroes Profile](https://heroesprofile.com) as soon as the game has finished
writing it.

A GTK4 + libadwaita app, written in React via [GTKX](https://github.com/gtkx/gtkx).
It is a port of [esiqveland/replayuploader](https://github.com/esiqveland/replayuploader),
whose working parts lived in a headless Go CLI; the GTK UI there was never
finished.

## Running

```bash
npm run dev                                    # run with fast refresh
```

To pass `--dir` by hand, note that `gtkx dev` needs its own `--` first, or it
reads the path as the entry file to load:

```bash
npx gtkx dev -- --dir /path/to/Replays/Multiplayer
npm run dev -- -- --dir /path/to/Replays/Multiplayer
```

The folder is remembered in the config file, so `--dir` is only needed to change
it — everything is also settable in Preferences.

```
Options:
  -d, --dir <path>       Watch this replay folder instead of the saved one
      --import-state <f> Adopt an upload history written by the Go uploader
  -h, --help             Show usage and exit
```

## The replay folder

Heroes of the Storm under Wine writes replays to:

```
<wine-prefix>/drive_c/users/<you>/Documents/Heroes of the Storm/Accounts/<account>/<hero-id>/Replays/Multiplayer
```

One folder is watched at a time, non-recursively.

## What it does

- **Scans on start**, so replays added while the app was closed still get uploaded.
- **Waits a second** before reading a new file — Wine writes a replay in several
  passes, some of them partial.
- **Checks the MPQ header**, so a half-written file or a stray file that merely
  ends in `.StormReplay` is never uploaded.
- **Deduplicates by content** — base64 of the file's SHA-512 — so a renamed or
  re-copied replay is not uploaded twice.
- **Retries** a failed upload with linear backoff, capped at 15 seconds.
- **Archives** each finished replay into `<watch folder>/archived/`, so later
  scans have far less to re-hash. Files that fail to upload stay put.

The header bar has buttons to start and stop watching, rescan the folder, open
the watched folder in your file manager, and open Preferences.

The main window lists the ten most recent replays; **Show Full History** opens the
whole history in a modal window. That list is virtualized, so a history of
thousands of replays opens instantly.

The window reopens at the size it was last closed at, maximized state included.

- **Links each replay** to its Heroes Profile match page.

Uploads go to `https://www.heroesprofile.com/api/external/v1/upload/heroesprofile/desktop`,
the endpoint Heroes Profile's own desktop uploader uses. There is no authentication
at all — no API key and no session cookie — and the server fingerprints the replay
itself, so nothing here has to parse the file.

The reply carries the match id:

```json
{"fingerprint":"397876d4-…","replayID":65133342,"status":"Duplicate"}
```

which becomes a link to `https://www.heroesprofile.com/Match/Single/?replayID=65133342`.
The `api.heroesprofile.com` host answers the same upload but strips the reply to
`{status, message}`, which is why the host matters.

### Upload outcomes

`Success` and `Duplicate` mean Heroes Profile has the replay. `AiDetected`,
`CustomGame`, `PtrRegion`, `TooOld` and `Incomplete` mean it was received and
turned down — those are final, not errors, so the replay is recorded and archived
rather than retried, and shown as rejected rather than uploaded.

### Match links for older replays

Replays uploaded before the app recorded match ids have no link. Because a
re-upload of a known replay comes back as `Duplicate` **with its id**, those ids
can be recovered by sending the archived file again.

That work is driven by the history index, which is newest-first, so it happens in
the order you care about:

- **The rows on screen are linked automatically** on startup — at most ten
  requests, and none once they are linked.
- **The rest of the history is opt-in**, behind *Link my whole history* in
  Preferences, because it is one request per archived replay. It runs one per
  second, saves as it goes, and switching it off stops it; switching it back on
  resumes rather than starting over.

## Files

| Path | Contents |
| --- | --- |
| `~/.config/hotsreplayuploader/config.json` | Watch folder, retry count, watch-on-launch, window size |
| `~/.local/share/hotsreplayuploader/state.json` | Upload history, newest first, with a `replay` object per linked match |

Coming from the Go uploader? Point `--import-state` at its `state.json` on the
first run and its history is adopted, so replays it already sent are not sent
again. The file format is unchanged, including the `sha256` field name — which
has always held a SHA-512 digest.

```bash
npm run dev -- -- --import-state /path/to/replayuploader/state.json
```

## Development

```bash
npm run typecheck                   # gtkx codegen && tsc
npm test                            # everything
npx vitest run --project lib        # backend only, no compositor needed
npx vitest run --project widgets    # widget tests only
npm run build
```

Tests are split in two: `lib` covers the watcher, uploader, state and argument
parsing as plain TypeScript, and `widgets` renders real GTK4. The widget project
starts a headless `sway` compositor, so `sway` must be installed; without it,
`--project lib` still runs.

## Differences from the Go version

- `-ladderonly` is gone. It defaulted to on but never did anything: the replay
  parsing that would have honoured it was commented out.
- Uploads go to the `www` `/desktop` endpoint instead of `api` `/web`, because only
  that one returns the `replayID` a match link needs.
- The session-cookie bootstrap is gone; the endpoint does not need it.
- Heroes Profile's verdict is recorded, so a rejected replay is no longer shown as
  a successful upload.
- Retries actually re-send the file. The Go version reused one already-consumed
  `io.Reader`, so every attempt after the first uploaded an empty body.
- The upload timeout covers 30s rather than 5s for the whole transfer.
- `state.json` is written to a temp file and renamed, instead of being truncated
  in place.
- Replays are validated as MPQ archives rather than just checked for being at
  least 2 bytes long.
- Config lives in XDG directories instead of the working directory.
