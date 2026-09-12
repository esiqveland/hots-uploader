import { css } from "@gtkx/css";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkLabel } from "@gtkx/jsx/gtk";
import type { ReplayEntry } from "../hooks/use-uploader.js";

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

export const StatusBadge = ({ entry }: { entry: ReplayEntry }) => (
    <GtkLabel
        label={badgeText(entry)}
        cssClasses={badgeClasses(entry.status)}
        valign={Gtk.Align.CENTER}
    />
);
