import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import {
    AdwHeaderBar,
    AdwToolbarView,
    AdwViewStack,
    AdwViewStackPage,
    AdwViewSwitcher,
    AdwWindow,
} from "@gtkx/jsx/adw";
import {
    GtkListView,
    GtkNoSelection,
    GtkScrolledWindow,
    GtkSignalListItemFactory,
    GtkStringList,
} from "@gtkx/jsx/gtk";
import { useParentWindow } from "@gtkx/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayEntry } from "../hooks/use-uploader.js";
import { HeroStatsList } from "./HeroStatsList.js";
import { groupBySeason, type HistoryRow } from "../lib/history-sections.js";
import {
    MATCH_BUTTON_CLASSES,
    MATCH_ICON,
    NO_MATCH_TOOLTIP,
    OPEN_MATCH_TOOLTIP,
    subtitleFor,
    titleFor,
} from "./ReplayList.js";
import {
    BADGE_SPINNER_PX,
    badgeClasses,
    badgeText,
    outcomeClasses,
    outcomeText,
    PLAYED_AT_CLASSES,
    showsStatusBadge,
} from "./StatusBadge.js";
import { formatRelativeTime } from "../lib/format.js";

/**
 * The widgets of one recycled row: a season header and a replay row, one of
 * which is hidden on every bind depending on what the row now holds.
 */
interface RowWidgets {
    header: Gtk.Label;
    entryRow: Gtk.Box;
    title: Gtk.Label;
    subtitle: Gtk.Label;
    badge: Gtk.Box;
    badgeLabel: Gtk.Label;
    badgeSpinner: Adw.Spinner;
    playedAt: Gtk.Label;
    outcome: Gtk.Label;
    link: Gtk.Button;
    /** The match the link currently points at; rewritten on every bind. */
    replayId?: number;
    /** The timestamp `playedAt` currently renders; re-read every minute to refresh it. */
    playedAtIso?: string;
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
    // AdwViewSwitcher needs the live ViewStack instance, not the JSX that
    // creates it, so it's threaded through state set by AdwViewStack's ref.
    const [stack, setStack] = useState<Adw.ViewStack | null>(null);
    // onBind runs outside React's render, so it reads the latest entries here
    // rather than closing over the ones from the render that created it.
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const onOpenMatchRef = useRef(onOpenMatch);
    onOpenMatchRef.current = onOpenMatch;

    const rowWidgets = useMemo(() => new WeakMap<Gtk.ListItem, RowWidgets>(), []);
    // WeakMap isn't iterable, so bound rows are tracked here too, purely to
    // refresh their playedAt label on the timer below.
    const boundRows = useMemo(() => new Set<RowWidgets>(), []);

    useEffect(() => {
        const id = setInterval(() => {
            for (const state of boundRows) {
                if (state.playedAtIso !== undefined) {
                    state.playedAt.setLabel(formatRelativeTime(state.playedAtIso));
                }
            }
        }, 60_000);
        return () => clearInterval(id);
    }, [boundRows]);

    // Season headers are rows too, so the list is never re-sorted to group
    // them; see groupBySeason.
    const sections = useMemo(() => groupBySeason(entries), [entries]);
    const sectionsRef = useRef(sections);
    sectionsRef.current = sections;

    // The model holds positions; the section row itself is looked up on bind.
    const positions = useMemo(() => sections.map((_, index) => String(index)), [sections]);

    const setup = (object: object) => {
        const listItem = object as Gtk.ListItem;

        const header = new Gtk.Label({
            xalign: 0,
            cssClasses: ["heading", "dim-label"],
            marginTop: 12,
            marginBottom: 4,
            marginStart: 12,
            marginEnd: 12,
        });

        const title = new Gtk.Label({ xalign: 0, ellipsize: 3 /* PangoEllipsizeMode.END */ });
        const subtitle = new Gtk.Label({
            xalign: 0,
            ellipsize: 3,
            cssClasses: ["dim-label", "caption"],
        });
        // Built as a box so the in-flight badge can hold a spinner beside its
        // text; the spinner is simply hidden in every other state.
        const badge = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });
        const badgeSpinner = new Adw.Spinner({
            widthRequest: BADGE_SPINNER_PX,
            heightRequest: BADGE_SPINNER_PX,
            valign: Gtk.Align.CENTER,
        });
        const badgeLabel = new Gtk.Label();
        badge.append(badgeSpinner);
        badge.append(badgeLabel);
        const playedAt = new Gtk.Label({ valign: Gtk.Align.CENTER, cssClasses: PLAYED_AT_CLASSES });
        const outcome = new Gtk.Label({ valign: Gtk.Align.CENTER });

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
        // Upload state sits left of the result, and only when it has something
        // to say.
        row.append(badge);
        row.append(playedAt);
        row.append(outcome);
        row.append(link);

        const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
        container.append(header);
        container.append(row);

        const state: RowWidgets = {
            header,
            entryRow: row,
            title,
            subtitle,
            badge,
            badgeLabel,
            badgeSpinner,
            playedAt,
            outcome,
            link,
        };
        // Connected once. Reconnecting on every bind would pile up handlers on a
        // recycled row, so the handler reads the id the last bind left behind.
        link.connect("clicked", () => {
            if (state.replayId !== undefined) {
                onOpenMatchRef.current(state.replayId);
            }
        });

        rowWidgets.set(listItem, state);
        boundRows.add(state);
        listItem.setChild(container);
    };

    const bind = (object: object) => {
        const listItem = object as Gtk.ListItem;
        const state = rowWidgets.get(listItem);
        if (state === undefined) {
            return;
        }

        const item = listItem.getItem() as Gtk.StringObject | null;
        const section: HistoryRow | undefined =
            item === null ? undefined : sectionsRef.current[Number(item.getString())];
        if (section === undefined) {
            return;
        }

        if (section.kind === "header") {
            state.header.setLabel(section.label);
            state.header.setVisible(true);
            state.entryRow.setVisible(false);
            return;
        }
        state.header.setVisible(false);
        state.entryRow.setVisible(true);

        const entry = entriesRef.current[section.index];
        if (entry === undefined) {
            return;
        }

        state.title.setLabel(titleFor(entry));
        state.subtitle.setLabel(subtitleFor(entry));
        state.badge.setVisible(showsStatusBadge(entry.status));
        if (showsStatusBadge(entry.status)) {
            state.badgeLabel.setLabel(badgeText(entry));
            state.badge.setCssClasses(badgeClasses(entry.status));
            state.badgeSpinner.setVisible(entry.status === "uploading");
        }

        state.playedAtIso = entry.playedAt;
        state.playedAt.setVisible(entry.playedAt !== undefined);
        if (entry.playedAt !== undefined) {
            state.playedAt.setLabel(formatRelativeTime(entry.playedAt));
        }

        state.outcome.setVisible(entry.outcome !== undefined);
        if (entry.outcome !== undefined) {
            state.outcome.setLabel(outcomeText(entry.outcome));
            state.outcome.setCssClasses(outcomeClasses(entry.outcome));
        }

        state.replayId = entry.replayId;
        // Kept in place but disabled, so rows do not change shape as the history
        // gains links.
        state.link.setSensitive(entry.replayId !== undefined);
        state.link.setTooltipText(
            entry.replayId === undefined ? NO_MATCH_TOOLTIP : OPEN_MATCH_TOOLTIP,
        );
    };

    const teardown = (object: object) => {
        const listItem = object as Gtk.ListItem;
        const state = rowWidgets.get(listItem);
        if (state !== undefined) {
            boundRows.delete(state);
        }
        rowWidgets.delete(listItem);
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
            <AdwToolbarView
                topBar={
                    <AdwHeaderBar
                        titleWidget={
                            stack === null ? undefined : (
                                <AdwViewSwitcher
                                    stack={stack}
                                    policy={Adw.ViewSwitcherPolicy.WIDE}
                                />
                            )
                        }
                    />
                }
            >
                <AdwViewStack ref={setStack}>
                    <AdwViewStackPage name="history" title="History" iconName="view-list-symbolic">
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
                    </AdwViewStackPage>
                    <AdwViewStackPage name="heroes" title="By Hero" iconName="avatar-default-symbolic">
                        <HeroStatsList entries={entries} />
                    </AdwViewStackPage>
                </AdwViewStack>
            </AdwToolbarView>
        </AdwWindow>
    );
};
