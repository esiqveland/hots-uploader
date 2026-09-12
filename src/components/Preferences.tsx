import * as Gtk from "@gtkx/gi/gtk";
import {
    AdwActionRow,
    AdwButtonRow,
    AdwPreferencesDialog,
    AdwPreferencesGroup,
    AdwPreferencesPage,
    AdwSpinRow,
    AdwSwitchRow,
} from "@gtkx/jsx/adw";
import { GtkAdjustment } from "@gtkx/jsx/gtk";
import { useParentWindow } from "@gtkx/react";
import { useMemo } from "react";
import type { Config } from "../lib/config.js";

export interface PreferencesProps {
    config: Config;
    onChange: (changes: Partial<Config>) => void;
    onClose: () => void;
    /** How many history entries have no Heroes Profile match id yet. */
    unlinkedCount: number;
    backfill: { done: number; total: number; linked: number } | null;
}

export const Preferences = ({
    config,
    onChange,
    onClose,
    unlinkedCount,
    backfill,
}: PreferencesProps) => {
    const window = useParentWindow();

    // A FileDialog is not a widget, so it is built directly rather than rendered.
    const fileDialog = useMemo(() => {
        const dialog = new Gtk.FileDialog();
        dialog.setTitle("Select Replay Folder");
        dialog.setAcceptLabel("Watch This Folder");
        dialog.setModal(true);
        return dialog;
    }, []);

    const chooseFolder = async () => {
        try {
            const folder = await fileDialog.selectFolder(window);
            const path = folder.getPath();
            if (path !== null) {
                onChange({ watchDir: path });
            }
        } catch {
            // The user dismissed the chooser.
        }
    };

    return (
        <AdwPreferencesDialog title="Preferences" onClosed={onClose}>
            <AdwPreferencesPage title="General" iconName="preferences-system-symbolic">
                <AdwPreferencesGroup
                    title="Replay Folder"
                    // Angle brackets are parsed as markup here and silently drop
                    // the text, so the path placeholders are spelled out.
                    description={
                        "The Multiplayer folder inside your Heroes of the Storm account, "
                        + "usually under your Wine prefix at drive_c/users/YOU/Documents/"
                        + "Heroes of the Storm/Accounts/ACCOUNT/HERO-ID/Replays/Multiplayer"
                    }
                >
                    <AdwActionRow
                        title="Watched folder"
                        subtitle={config.watchDir === "" ? "Not set" : config.watchDir}
                        subtitleLines={2}
                    />
                    <AdwButtonRow
                        title="Choose Folder…"
                        startIconName="folder-open-symbolic"
                        onActivated={() => void chooseFolder()}
                    />
                </AdwPreferencesGroup>

                <AdwPreferencesGroup
                    title="Uploads"
                    description="Uploaded replays are moved into an 'archived' folder inside the watched folder, so later scans have less to re-check."
                >
                    <AdwSpinRow
                        title="Upload attempts"
                        subtitle="How many times to retry a failed upload before giving up"
                        numeric={true}
                        value={config.maxTries}
                        adjustment={
                            <GtkAdjustment
                                lower={1}
                                upper={20}
                                stepIncrement={1}
                                pageIncrement={5}
                                value={config.maxTries}
                            />
                        }
                        onNotifyValue={(value) => {
                            if (value !== null && value !== config.maxTries) {
                                onChange({ maxTries: value });
                            }
                        }}
                    />
                    <AdwSwitchRow
                        title="Watch on launch"
                        subtitle="Start watching the folder as soon as the app opens"
                        active={config.autoStart}
                        onNotifyActive={(active) => {
                            if (active !== null && active !== config.autoStart) {
                                onChange({ autoStart: active });
                            }
                        }}
                    />
                </AdwPreferencesGroup>

                <AdwPreferencesGroup
                    title="Match Links"
                    description="The replays shown in the window are linked to their Heroes Profile match automatically. Linking the rest of your history means re-sending every archived replay, one per second, so it is off by default. Progress is kept, so this can be switched off and on again."
                >
                    <AdwSwitchRow
                        title="Link my whole history"
                        subtitle={
                            backfill !== null
                                ? `Linking ${backfill.done} of ${backfill.total}, ${backfill.linked} found`
                                : unlinkedCount === 0
                                  ? "Everything is linked"
                                  : `${unlinkedCount} replays still unlinked`
                        }
                        active={config.linkAllReplays}
                        sensitive={config.watchDir !== ""}
                        onNotifyActive={(active) => {
                            if (active !== null && active !== config.linkAllReplays) {
                                onChange({ linkAllReplays: active });
                            }
                        }}
                    />
                </AdwPreferencesGroup>
            </AdwPreferencesPage>
        </AdwPreferencesDialog>
    );
};
