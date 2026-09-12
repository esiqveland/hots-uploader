import { AdwHeaderBar, AdwWindowTitle } from "@gtkx/jsx/adw";
import { GtkButton } from "@gtkx/jsx/gtk";
import type { WatcherStatus } from "../lib/watcher.js";

export interface HeaderBarProps {
    status: WatcherStatus;
    hasFolder: boolean;
    onStart: () => void;
    onStop: () => void;
    onRescan: () => void;
    onOpenFolder: () => void;
    onOpenPreferences: () => void;
}

const subtitleFor = (status: WatcherStatus): string => {
    switch (status) {
        case "watching":
            return "Watching for new replays";
        case "scanning":
            return "Scanning folder…";
        default:
            return "Not watching";
    }
};

export const HeaderBar = ({
    status,
    hasFolder,
    onStart,
    onStop,
    onRescan,
    onOpenFolder,
    onOpenPreferences,
}: HeaderBarProps) => {
    const isRunning = status !== "stopped";

    return (
        <AdwHeaderBar
            titleWidget={
                <AdwWindowTitle title="HotS Replay Uploader" subtitle={subtitleFor(status)} />
            }
            start={
                <GtkButton
                    iconName={
                        isRunning ? "media-playback-stop-symbolic" : "media-playback-start-symbolic"
                    }
                    tooltipText={isRunning ? "Stop watching" : "Start watching"}
                    accessibleLabel={isRunning ? "Stop watching" : "Start watching"}
                    sensitive={hasFolder}
                    onClicked={isRunning ? onStop : onStart}
                />
            }
            end={
                <>
                    <GtkButton
                        iconName="open-menu-symbolic"
                        tooltipText="Preferences"
                        accessibleLabel="Preferences"
                        onClicked={onOpenPreferences}
                    />
                    <GtkButton
                        iconName="view-refresh-symbolic"
                        tooltipText="Rescan folder"
                        accessibleLabel="Rescan folder"
                        sensitive={hasFolder && status !== "scanning"}
                        onClicked={onRescan}
                    />
                    <GtkButton
                        iconName="folder-open-symbolic"
                        tooltipText="Open replay folder"
                        accessibleLabel="Open replay folder"
                        sensitive={hasFolder}
                        onClicked={onOpenFolder}
                    />
                </>
            }
        />
    );
};
