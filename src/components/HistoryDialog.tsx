import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { AdwHeaderBar, AdwToolbarView, AdwWindow } from "@gtkx/jsx/adw";
import {
    GtkListView,
    GtkNoSelection,
    GtkScrolledWindow,
    GtkSignalListItemFactory,
    GtkStringList,
} from "@gtkx/jsx/gtk";
import { useParentWindow } from "@gtkx/react";
import { useMemo, useRef } from "react";
import type { ReplayEntry } from "../hooks/use-uploader.js";
import {
    MATCH_BUTTON_CLASSES,
    MATCH_ICON,
    NO_MATCH_TOOLTIP,
    OPEN_MATCH_TOOLTIP,
    subtitleFor,
} from "./ReplayList.js";
import { badgeClasses, badgeText } from "./StatusBadge.js";

/**
 * The widgets of one row, kept so `onBind` can refill a recycled row instead of
 * rebuilding it.
 */
interface Row {
    title: Gtk.Label;
    subtitle: Gtk.Label;
    badge: Gtk.Label;
    link: Gtk.Button;
    /** The match the link currently points at; rewritten on every bind. */
    replayId?: number;
}

export interface HistoryDialogProps {
    entries: ReplayEntry[];
    onClose: () => void;
    onOpenMatch: (replayId: number) => void;
}

/**
 * The full upload history, as a modal window.
 *
 * Two deliberate choices here:
 *
 * GtkListView rather than the GtkListBox the main window uses, because GtkListBox
 * mounts every row and a history of a thousand replays stalls the first paint.
 * GtkListView only builds the rows on screen, which is why the factory below is
 * imperative — there is no JSX equivalent for recycling a row.
 *
 * A modal AdwWindow rather than an AdwDialog. A presented AdwDialog here attached
 * to the dialog host but never mapped its floating sheet, leaving an empty shell —
 * reproduced with nothing but a label as its child, so it was not this content.
 * AdwPreferencesDialog (used by Preferences) is unaffected.
 */
export const HistoryDialog = ({ entries, onClose, onOpenMatch }: HistoryDialogProps) => {
    const parent = useParentWindow();
    // onBind runs outside React's render, so it reads the latest entries here
    // rather than closing over the ones from the render that created it.
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const onOpenMatchRef = useRef(onOpenMatch);
    onOpenMatchRef.current = onOpenMatch;

    const rows = useMemo(() => new WeakMap<Gtk.ListItem, Row>(), []);

    // The model holds positions; the entry itself is looked up on bind.
    const positions = useMemo(() => entries.map((_, index) => String(index)), [entries]);

    const setup = (object: object) => {
        const listItem = object as Gtk.ListItem;

        const title = new Gtk.Label({ xalign: 0, ellipsize: 3 /* PangoEllipsizeMode.END */ });
        const subtitle = new Gtk.Label({
            xalign: 0,
            ellipsize: 3,
            cssClasses: ["dim-label", "caption"],
        });
        const badge = new Gtk.Label({ valign: Gtk.Align.CENTER });

        // Built once and hidden per row, since a recycled row may or may not have
        // a match id.
        const link = new Gtk.Button({
            cssClasses: MATCH_BUTTON_CLASSES,
            valign: Gtk.Align.CENTER,
        });
        link.setChild(new Adw.ButtonContent({ iconName: MATCH_ICON, label: "View Match" }));

        const text = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            hexpand: true,
        });
        text.append(title);
        text.append(subtitle);

        const row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            marginTop: 8,
            marginBottom: 8,
            marginStart: 12,
            marginEnd: 12,
        });
        row.append(text);
        row.append(badge);
        row.append(link);

        const state: Row = { title, subtitle, badge, link };
        // Connected once. Reconnecting on every bind would pile up handlers on a
        // recycled row, so the handler reads the id the last bind left behind.
        link.connect("clicked", () => {
            if (state.replayId !== undefined) {
                onOpenMatchRef.current(state.replayId);
            }
        });

        rows.set(listItem, state);
        listItem.setChild(row);
    };

    const bind = (object: object) => {
        const listItem = object as Gtk.ListItem;
        const row = rows.get(listItem);
        if (row === undefined) {
            return;
        }

        const item = listItem.getItem() as Gtk.StringObject | null;
        const entry = item === null ? undefined : entriesRef.current[Number(item.getString())];
        if (entry === undefined) {
            return;
        }

        row.title.setLabel(entry.name);
        row.subtitle.setLabel(subtitleFor(entry));
        row.badge.setLabel(badgeText(entry));
        row.badge.setCssClasses(badgeClasses(entry.status));

        row.replayId = entry.replayId;
        // Kept in place but disabled, so rows do not change shape as the history
        // gains links.
        row.link.setSensitive(entry.replayId !== undefined);
        row.link.setTooltipText(
            entry.replayId === undefined ? NO_MATCH_TOOLTIP : OPEN_MATCH_TOOLTIP,
        );
    };

    const teardown = (object: object) => {
        rows.delete(object as Gtk.ListItem);
    };

    return (
        <AdwWindow
            title="Upload History"
            defaultWidth={640}
            defaultHeight={520}
            modal={true}
            transientFor={parent}
            onCloseRequest={() => {
                onClose();
                return true;
            }}
        >
            <AdwToolbarView topBar={<AdwHeaderBar />}>
                <GtkScrolledWindow
                    hscrollbarPolicy={Gtk.PolicyType.NEVER}
                    vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                    vexpand={true}
                >
                    <GtkListView
                        showSeparators={true}
                        model={
                            <GtkNoSelection
                                model={<GtkStringList strings={positions} />}
                            />
                        }
                        factory={
                            <GtkSignalListItemFactory
                                onSetup={setup}
                                onBind={bind}
                                onTeardown={teardown}
                            />
                        }
                    />
                </GtkScrolledWindow>
            </AdwToolbarView>
        </AdwWindow>
    );
};
