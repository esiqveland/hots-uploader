import * as Gtk from "@gtkx/gi/gtk";
import { GtkExpander, GtkLabel, GtkScrolledWindow } from "@gtkx/jsx/gtk";

/** How many trailing lines to show; the full log lives in the hook. */
const VISIBLE_LINES = 200;

export const LogView = ({ lines }: { lines: string[] }) => (
    <GtkExpander
        label="Activity log"
        // Collapsed by default so the log does not crowd out the window content.
        expanded={false}
        marginTop={4}
        marginBottom={4}
        marginStart={12}
        marginEnd={12}
    >
        <GtkScrolledWindow
            hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            minContentHeight={120}
            propagateNaturalHeight={true}
        >
            <GtkLabel
                cssClasses={["monospace", "caption", "dim-label"]}
                selectable={true}
                xalign={0}
                valign={Gtk.Align.START}
                label={lines.slice(-VISIBLE_LINES).join("\n")}
            />
        </GtkScrolledWindow>
    </GtkExpander>
);
