# Roadmap

Ideas looked at but not built, with enough of the findings that nobody has to
re-derive them.

- [Win rate per hero in the full history screen](#win-rate-per-hero-in-the-full-history-screen) — wanted, all the data is already stored
- [Party vs solo](#party-vs-solo--not-possible) — not possible
- [Local fingerprinting](#local-fingerprinting--impossible-and-pointless) — impossible, and would buy nothing

## Win rate per hero in the full history screen

The full-history window currently lists replays and nothing else. It should also
break the record down per hero: games played, wins, losses and win rate for each
hero you have played.

Everything needed is already stored. `state.json` keeps the parsed match on each
entry as `details.players` — `[toonId, hero, result]` tuples — and
`src/lib/toon.ts` resolves which toon is you, so the breakdown is a grouping over
data already on disk, with no replay re-reading and no network.

Notes for whoever picks it up:

- `src/lib/record.ts` already computes wins/losses/win rate from a list of
  outcomes; the per-hero version should reuse `recordOf` per group rather than
  counting again.
- Only entries with `details` count, and only while the player id resolves —
  the same honesty rule the summary card uses, so heroes are not silently
  credited with games whose result is unknown.
- Worth sorting by games played, and worth a minimum-games threshold before a
  percentage is shown at all: one game at 100% is noise.
- The history window is virtualised (`GtkListView`), so the breakdown wants to be
  its own section or page rather than rows spliced into that list.

## Party vs solo — not possible

Whether a game was played solo or in a party is **not recoverable from the
replay**. Checked `replay.details` (player struct is name, toon, race, colour,
control, teamId, handicap, observe, result, workingSetSlotId, hero — no party
field) and `replay.attributes.events` (dumped in full, per-player and
game-wide; nothing groups players there either). This is
consistent with the game anonymising player names in these replays (they come
through as strings like `fbtckbmxio`) — party grouping would partly undo that.

Toon ids, unlike names, are *not* anonymised, which is what makes "which player
is you" work at all.

## Local fingerprinting — impossible, and pointless

Computing the Heroes Profile fingerprint locally would need `m_randomValue` from
`replay.initdata`. That file uses the bit-packed format, which carries no type
tags at all: field order and widths come entirely from a per-build typeinfo
table. Without those tables it cannot be read. (`replay.details` is fine because
its versioned format *is* self-describing — see the README.)

It would buy nothing anyway. The only fingerprint endpoint,
`GET /replays/fingerprints/{fingerprint}`, returns `{"exists": bool}` and no
`replayID`, so it could not make the match-link backfill cheaper. A replay id
only ever comes back from an actual upload.
