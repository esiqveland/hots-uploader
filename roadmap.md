# Roadmap

Ideas looked at but not built, with enough of the findings that nobody has to
re-derive them.

- [Party vs solo](#party-vs-solo--not-possible) — not possible
- [Local fingerprinting](#local-fingerprinting--impossible-and-pointless) — impossible, and would buy nothing
- [Pre-game functionality](#pre-game-functionality) — investigate what the official Heroes Profile desktop client offers, decide if it's worth building here

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

## Pre-game functionality

The official Heroes Profile desktop uploader has some kind of pre-game feature —
not yet investigated here. Worth digging into what it actually shows and how it
gets its data (draft-time stats? hero/matchup win rates read from the game while
a lobby is up?), whether it needs anything this app cannot get (this app only
ever reads a *finished* `.StormReplay`, never a live game state), and whether
it is worth building something similar, or at all.
