import * as Gtk from "@gtkx/gi/gtk";
import { AdwActionRow } from "@gtkx/jsx/adw";
import { GtkLabel, GtkListBox, GtkScrolledWindow } from "@gtkx/jsx/gtk";
import { useMemo } from "react";
import type { ReplayEntry } from "../hooks/use-uploader.js";
import { heroStatsOf } from "../lib/hero-stats.js";

const gamesLabel = (games: number): string => `${games} game${games === 1 ? "" : "s"}`;

export interface HeroStatsListProps {
    entries: ReplayEntry[];
}

/**
 * Win/loss record per hero, sorted by games played. Bounded to the hero
 * roster (dozens, not thousands of rows), so a plain GtkListBox is fine here —
 * unlike the match list, which needs GtkListView's recycling to stay fast.
 */
export const HeroStatsList = ({ entries }: HeroStatsListProps) => {
    const stats = useMemo(() => heroStatsOf(entries), [entries]);

    if (stats.length === 0) {
        return (
            <GtkLabel
                cssClasses={["dim-label"]}
                vexpand={true}
                label="No hero data yet"
            />
        );
    }

    return (
        <GtkScrolledWindow
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            vexpand={true}
        >
            <GtkListBox
                selectionMode={Gtk.SelectionMode.NONE}
                cssClasses={["boxed-list"]}
                marginTop={12}
                marginBottom={12}
                marginStart={12}
                marginEnd={12}
                valign={Gtk.Align.START}
            >
                {stats.map((stat) => (
                    <AdwActionRow
                        key={stat.hero}
                        title={stat.hero}
                        subtitle={gamesLabel(stat.games)}
                        suffix={
                            <GtkLabel
                                valign={Gtk.Align.CENTER}
                                label={`${stat.wins}W – ${stat.losses}L · ${stat.winRate}%`}
                            />
                        }
                    />
                ))}
            </GtkListBox>
        </GtkScrolledWindow>
    );
};
