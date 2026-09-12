import { css } from "@gtkx/css";
import * as Gtk from "@gtkx/gi/gtk";
import { AdwSpinner } from "@gtkx/jsx/adw";
import { GtkBox, GtkLabel } from "@gtkx/jsx/gtk";
import type { ReplayEntry } from "../hooks/use-uploader.js";
import { useNow } from "../hooks/use-now.js";
import { formatRelativeTime } from "../lib/format.js";

/**
 * Generated once and shared by the React list and the history dialog's
 * imperative row factory, so both render the same badge.
 */
const badge = css({
    // Adwaita's own status chips are a tinted ground with coloured text, not a
    // saturated fill, and they use the 6px card radius rather than a full pill.
    borderRadius: "6px",
    paddingTop: "3px",
    paddingBottom: "3px",
    paddingLeft: "10px",
    paddingRight: "10px",
    minHeight: "24px",
    fontSize: "0.8em",
    fontWeight: 700,
});

// The semantic foreground colours, tinted for the ground. Using these rather than
// fixed values keeps the badge in step with the light/dark theme and the accent
// the user has picked.
const variant = (color: string): string =>
    css({ background: `alpha(${color}, 0.15)`, color });

const VARIANTS: Record<ReplayEntry["status"], string> = {
    uploading: variant("@accent_color"),
    uploaded: variant("@success_color"),
    rejected: variant("@warning_color"),
    failed: variant("@error_color"),
};

const OUTCOME_VARIANTS = {
    win: variant("@success_color"),
    loss: variant("@error_color"),
} as const;

/** Neutral, since when a match was played is not a status worth colour-coding. */
export const PLAYED_AT_CLASSES = [badge, variant("@dim_label_color")];

export const outcomeText = (outcome: "win" | "loss"): string =>
    outcome === "win" ? "Victory" : "Defeat";

export const outcomeClasses = (outcome: "win" | "loss"): string[] => [
    badge,
    OUTCOME_VARIANTS[outcome],
];

/** Short enough to sit in a row; the subtitle carries the detail. */
const REJECTION_LABELS: Record<string, string> = {
    AiDetected: "Against AI",
    CustomGame: "Custom game",
    PtrRegion: "PTR",
    TooOld: "Too old",
    Incomplete: "Incomplete",
};

export const badgeText = (entry: ReplayEntry): string => {
    switch (entry.status) {
        case "uploading":
            return "Uploading";
        case "uploaded":
            return "Uploaded";
        case "failed":
            return "Failed";
        default:
            return REJECTION_LABELS[entry.detail ?? ""] ?? "Rejected";
    }
};

export const badgeClasses = (status: ReplayEntry["status"]): string[] => [badge, VARIANTS[status]];

/**
 * A successful upload is the overwhelmingly common case, so it says nothing worth
 * a badge. Only work in flight and outcomes that need attention get one.
 */
export const showsStatusBadge = (status: ReplayEntry["status"]): boolean =>
    status !== "uploaded";

/** Sized to sit on the badge's cap height rather than tower over the text. */
export const BADGE_SPINNER_PX = 12;

export const StatusBadge = ({ entry }: { entry: ReplayEntry }) => (
    <GtkBox
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={6}
        cssClasses={badgeClasses(entry.status)}
        valign={Gtk.Align.CENTER}
    >
        {entry.status === "uploading" && (
            <AdwSpinner
                widthRequest={BADGE_SPINNER_PX}
                heightRequest={BADGE_SPINNER_PX}
                valign={Gtk.Align.CENTER}
            />
        )}
        <GtkLabel label={badgeText(entry)} />
    </GtkBox>
);

/** Whether you won, shown only when the player id resolved. */
export const OutcomeBadge = ({ outcome }: { outcome: "win" | "loss" }) => (
    <GtkLabel
        label={outcomeText(outcome)}
        cssClasses={outcomeClasses(outcome)}
        valign={Gtk.Align.CENTER}
    />
);

/** How long ago the match was played, shown only once the replay has been read. */
export const PlayedAtBadge = ({ playedAt }: { playedAt: string }) => {
    // Refreshed every minute so a row doesn't sit at "1 minute ago" for an hour.
    const now = useNow();
    return (
        <GtkLabel
            label={formatRelativeTime(playedAt, now)}
            cssClasses={PLAYED_AT_CLASSES}
            valign={Gtk.Align.CENTER}
        />
    );
};
