import * as Gtk from "@gtkx/gi/gtk";
import {
    AdwActionRow,
    AdwButtonRow,
    AdwEntryRow,
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
    /** Which player id is in use, and whether it had to be detected. */
    toon: { toonId?: number; source: "configured" | "path" | "replays" | "none" };
}

/** Says whether we worked the player out, and what to do when we did not. */
const detectionSubtitle = (toon: PreferencesProps["toon"]): string => {
    switch (toon.source) {
        case "configured":
            return `Using the ID you entered: ${toon.toonId}`;
        case "path":
            return `Detected from your replay folder: ${toon.toonId}`;
        case "replays":
            return `Detected from your replays: ${toon.toonId}`;
        default:
            return "Could not detect it — enter your player ID above to see your hero and result";
    }
};

export const Preferences = ({
    config,
    onChange,
    onClose,
    unlinkedCount,
    backfill,
    toon,
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
                    title="Your Player"
                    description={
                        "Used to work out which player in a replay is you, so the list can show "
                        + "your hero and whether you won. It is the last number in your replay "
                        + "folder — in Accounts/1564242/2-Hero-1-13481373/Replays/Multiplayer "
                        + "it is 13481373."
                    }
                >
                    <AdwEntryRow
                        title="Your player ID"
                        text={config.toonId === undefined ? "" : String(config.toonId)}
                        inputPurpose={Gtk.InputPurpose.DIGITS}
                        onChanged={(self) => {
                            const typed = self.text.trim();
                            // Empty means "go back to detecting it", not "no id".
                            const next = typed === "" ? undefined : Number(typed);
                            if (next !== undefined && !Number.isSafeInteger(next)) {
                                return;
                            }
                            if (next !== config.toonId) {
                                onChange({ toonId: next });
                            }
                        }}
                    />
                    <AdwActionRow
                        title="Detection"
                        subtitle={detectionSubtitle(toon)}
                        subtitleLines={2}
                    />
                </AdwPreferencesGroup>

                <AdwPreferencesGroup
                    title="Match Links"
                    description="The replays shown in the window are linked to their Heroes Profile match automatically. Linking the rest of your history means re-sending every archived replay, one per second, so it is off by default. Progress is kept, so this can be switched off and on again. Replays played more than 12 months ago are never sent, to save load on Heroes Profile — their map and heroes are still read locally, just not their match link."
                >
                    <AdwSwitchRow
                        title="Link my whole history"
                        subtitle={
                            backfill !== null
                                ? `Linking ${backfill.done} of ${backfill.total}, ${backfill.linked} found`
                                : unlinkedCount === 0
                                  ? "Nothing left to link"
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
