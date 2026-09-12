import { css } from "@gtkx/css";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkLabel, GtkSeparator } from "@gtkx/jsx/gtk";
import type { ReplayEntry } from "../hooks/use-uploader.js";
import { recordOf } from "../lib/record.js";
import { seasonOf } from "../lib/seasons.js";

const value = css({ fontSize: "1.6em", fontWeight: 800 });
const win = css({ color: "@success_color" });
const loss = css({ color: "@error_color" });
const rate = css({ color: "@accent_color" });

const Stat = ({
    label,
    text,
    tint,
}: {
    label: string;
    text: string;
    tint?: string;
}) => (
    <GtkBox
        orientation={Gtk.Orientation.VERTICAL}
        spacing={2}
        hexpand={true}
        halign={Gtk.Align.CENTER}
    >
        <GtkLabel label={text} cssClasses={tint === undefined ? [value] : [value, tint]} />
        <GtkLabel label={label} cssClasses={["caption", "dim-label"]} />
    </GtkBox>
);

/**
 * Wins, losses and win rate over the current ranked season.
 *
 * Only entries whose replay has been parsed carry a `playedAt`, so games not
 * yet read are silently left out rather than guessed into the wrong season.
 * Hidden entirely when nothing has a known result — an empty card saying 0 of 0
 * is worse than no card, and that is the state before any replay has been parsed
 * or while the player id is still unknown.
 */
export const RecordSummary = ({ entries }: { entries: ReplayEntry[] }) => {
    const season = seasonOf(new Date());
    const seasonEntries =
        season === undefined
            ? []
            : entries.filter((entry) => {
                  if (entry.playedAt === undefined) {
                      return false;
                  }
                  const playedAt = new Date(entry.playedAt);
                  return playedAt >= season.start && playedAt < season.end;
              });
    const record = recordOf(
        seasonEntries.map((entry) => entry.outcome),
        Number.POSITIVE_INFINITY,
    );

    if (record.total === 0) {
        return null;
    }

    return (
        <GtkBox
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={12}
            cssClasses={["card"]}
            marginTop={12}
            marginStart={12}
            marginEnd={12}
            marginBottom={0}
        >
            <GtkBox
                orientation={Gtk.Orientation.HORIZONTAL}
                spacing={12}
                hexpand={true}
                marginTop={12}
                marginBottom={12}
                marginStart={6}
                marginEnd={6}
            >
                <Stat label="Wins" text={String(record.wins)} tint={win} />
                <GtkSeparator orientation={Gtk.Orientation.VERTICAL} />
                <Stat label="Losses" text={String(record.losses)} tint={loss} />
                <GtkSeparator orientation={Gtk.Orientation.VERTICAL} />
                <Stat label="Win rate" text={`${record.winRate}%`} tint={rate} />
                <GtkSeparator orientation={Gtk.Orientation.VERTICAL} />
                <Stat label={season?.name ?? "This season"} text={String(record.total)} />
            </GtkBox>
        </GtkBox>
    );
};
