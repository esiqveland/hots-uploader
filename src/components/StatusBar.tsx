import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkLabel, GtkProgressBar } from "@gtkx/jsx/gtk";
import type { WatcherStatus } from "../lib/watcher.js";

export interface StatusBarProps {
    status: WatcherStatus;
    uploaded: number;
    failed: number;
    scan: { done: number; total: number } | null;
}

export const StatusBar = ({ status, uploaded, failed, scan }: StatusBarProps) => (
    <GtkBox
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={12}
        marginTop={6}
        marginBottom={6}
        marginStart={12}
        marginEnd={12}
    >
        <GtkLabel
            cssClasses={["dim-label", "caption"]}
            label={status === "watching" ? "Watching" : status === "scanning" ? "Scanning" : "Stopped"}
        />
        {scan !== null && (
            <GtkProgressBar
                fraction={scan.total === 0 ? 0 : scan.done / scan.total}
                valign={Gtk.Align.CENTER}
                hexpand={true}
                showText={true}
                text={`${scan.done} / ${scan.total}`}
            />
        )}
        <GtkLabel
            hexpand={scan === null}
            halign={Gtk.Align.END}
            cssClasses={["dim-label", "caption"]}
            label={failed > 0 ? `${uploaded} uploaded · ${failed} failed` : `${uploaded} uploaded`}
        />
    </GtkBox>
);
