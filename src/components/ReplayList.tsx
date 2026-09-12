import * as Gtk from "@gtkx/gi/gtk";
import { AdwActionRow, AdwButtonContent } from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkLabel, GtkListBox, GtkScrolledWindow } from "@gtkx/jsx/gtk";
import type { ReplayEntry } from "../hooks/use-uploader.js";
import { RecordSummary } from "./RecordSummary.js";
import { OutcomeBadge, PlayedAtBadge, showsStatusBadge, StatusBadge } from "./StatusBadge.js";
import { formatIsoDateTime } from "../lib/format.js";

/** Why Heroes Profile turned a replay down, in words rather than an API code. */
const REJECTION_REASONS: Record<string, string> = {
    AiDetected: "Rejected: against AI",
    CustomGame: "Rejected: custom game",
    PtrRegion: "Rejected: PTR region",
    TooOld: "Rejected: too old",
    Incomplete: "Rejected: incomplete replay",
    UnknownCode: "Rejected by Heroes Profile",
};

/** What a row is called: the map when the replay has been read, else its filename. */
export const titleFor = (entry: ReplayEntry): string => entry.map ?? entry.name;

const matchParts = (entry: ReplayEntry): string[] =>
    entry.hero === undefined ? [] : [entry.hero];

export const subtitleFor = (entry: ReplayEntry): string => {
    if (entry.status === "uploading") {
        return "Uploading…";
    }
    if (entry.status === "rejected") {
        return REJECTION_REASONS[entry.detail ?? ""] ?? "Rejected by Heroes Profile";
    }
    if (entry.status === "failed") {
        return entry.detail ?? "Upload failed";
    }
    return [...matchParts(entry), formatIsoDateTime(entry.at)].join(" · ");
};

/** Shipped by libadwaita itself; plain "external-link-symbolic" does not exist. */
export const MATCH_ICON = "adw-external-link-symbolic";

/**
 * Accent-coloured text without a filled background: a filled button on every row
 * competes with the status badges. Both classes are Adwaita's own.
 */
export const MATCH_BUTTON_CLASSES = ["flat", "accent"];

export const OPEN_MATCH_TOOLTIP = "Open this match on heroesprofile.com";
export const NO_MATCH_TOOLTIP =
    "Disabled: no Heroes Profile match id was found for this replay";

const RowSuffix = ({
    entry,
    onOpenMatch,
}: {
    entry: ReplayEntry;
    onOpenMatch: (replayId: number) => void;
}) => {
    const replayId = entry.replayId;
    return (
        <GtkBox orientation={Gtk.Orientation.HORIZONTAL} spacing={8} valign={Gtk.Align.CENTER}>
            {showsStatusBadge(entry.status) && <StatusBadge entry={entry} />}
            {entry.playedAt !== undefined && <PlayedAtBadge playedAt={entry.playedAt} />}
            {entry.outcome !== undefined && <OutcomeBadge outcome={entry.outcome} />}
            <GtkButton
                cssClasses={MATCH_BUTTON_CLASSES}
                sensitive={replayId !== undefined}
                tooltipText={replayId === undefined ? NO_MATCH_TOOLTIP : OPEN_MATCH_TOOLTIP}
                onClicked={() => {
                    if (replayId !== undefined) {
                        onOpenMatch(replayId);
                    }
                }}
            >
                <AdwButtonContent iconName={MATCH_ICON} label="View Match" />
            </GtkButton>
        </GtkBox>
    );
};

/** The main window is a recent-activity view; the rest is behind Show Full History. */
const MAX_ROWS = 10;

export interface ReplayListProps {
    entries: ReplayEntry[];
    onShowHistory: () => void;
    onOpenMatch: (replayId: number) => void;
}

export const ReplayList = ({ entries, onShowHistory, onOpenMatch }: ReplayListProps) => {
    const visible = entries.slice(0, MAX_ROWS);
    const hidden = entries.length - visible.length;

    return (
        <GtkBox orientation={Gtk.Orientation.VERTICAL} vexpand={true}>
            <RecordSummary entries={entries} />
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
                    {visible.map((entry) => (
                        <AdwActionRow
                            key={entry.name}
                            title={titleFor(entry)}
                            subtitle={subtitleFor(entry)}
                            subtitleLines={1}
                            suffix={<RowSuffix entry={entry} onOpenMatch={onOpenMatch} />}
                        />
                    ))}
                </GtkListBox>
            </GtkScrolledWindow>
            <GtkButton
                label={hidden > 0 ? `Show Full History (${entries.length})` : "Show Full History"}
                halign={Gtk.Align.CENTER}
                marginTop={6}
                marginBottom={12}
                cssClasses={["pill"]}
                onClicked={onShowHistory}
            />
        </GtkBox>
    );
};

export const NoReplaysYet = ({ folder }: { folder: string }) => (
    <GtkLabel
        cssClasses={["dim-label"]}
        vexpand={true}
        wrap={true}
        justify={Gtk.Justification.CENTER}
        label={`No replays uploaded yet.\nWatching ${folder}`}
    />
);
