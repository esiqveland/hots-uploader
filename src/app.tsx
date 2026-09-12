import * as Adw from "@gtkx/gi/adw";
import * as GLib from "@gtkx/gi/glib";
import { AdwApplication, AdwApplicationWindow, AdwToastOverlay, AdwToolbarView } from "@gtkx/jsx/adw";
import { GtkBox } from "@gtkx/jsx/gtk";
import { quit } from "@gtkx/react";
import * as Gtk from "@gtkx/gi/gtk";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "./components/EmptyState.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { HistoryDialog } from "./components/HistoryDialog.js";
import { LogView } from "./components/LogView.js";
import { Preferences } from "./components/Preferences.js";
import { NoReplaysYet, ReplayList } from "./components/ReplayList.js";
import { StatusBar } from "./components/StatusBar.js";
import { useOpenFolder, useOpenUri } from "./hooks/use-open-folder.js";
import { useUploader } from "./hooks/use-uploader.js";
import { matchUrl } from "./lib/uploader.js";

const MainWindow = () => {
    const uploader = useUploader();
    const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const overlayRef = useRef<Adw.ToastOverlay | null>(null);
    const openFolder = useOpenFolder(uploader.notify);
    const openUri = useOpenUri(uploader.notify);
    const openMatch = (replayId: number) => void openUri(matchUrl(replayId));

    const hasFolder = uploader.config.watchDir !== "";

    // The saved size seeds the window once. Feeding the live config back into
    // these props would fight the user mid-resize, so the restored value is
    // frozen at mount and later sizes only travel outwards, to the config.
    const [restoredSize] = useState(() => ({
        width: uploader.config.windowWidth,
        height: uploader.config.windowHeight,
        maximized: uploader.config.windowMaximized,
    }));

    useEffect(() => {
        if (uploader.notice !== null) {
            overlayRef.current?.addToast(new Adw.Toast({ title: uploader.notice.text }));
        }
    }, [uploader.notice]);

    return (
        <AdwApplicationWindow
            title="HotS Replay Uploader"
            defaultWidth={restoredSize.width}
            defaultHeight={restoredSize.height}
            maximized={restoredSize.maximized}
            // GTK keeps default-width/height in step with the current size while
            // the window is neither maximized nor fullscreen, so these report the
            // size worth restoring without measuring anything.
            onNotifyDefaultWidth={(width) => {
                if (width !== null && width > 0) {
                    uploader.updateConfig({ windowWidth: width });
                }
            }}
            onNotifyDefaultHeight={(height) => {
                if (height !== null && height > 0) {
                    uploader.updateConfig({ windowHeight: height });
                }
            }}
            onNotifyMaximized={(maximized) => {
                if (maximized !== null) {
                    uploader.updateConfig({ windowMaximized: maximized });
                }
            }}
            onCloseRequest={() => {
                // The config write is debounced, so flush it before the loop ends.
                void uploader.flushConfig();
                return quit();
            }}
        >
            <AdwToastOverlay ref={overlayRef}>
                <AdwToolbarView
                    topBar={
                        <HeaderBar
                            status={uploader.status}
                            hasFolder={hasFolder}
                            onStart={uploader.start}
                            onStop={uploader.stop}
                            onRescan={uploader.rescan}
                            onOpenFolder={() => void openFolder(uploader.config.watchDir)}
                            onOpenPreferences={() => setIsPreferencesOpen(true)}
                        />
                    }
                    bottomBar={
                        <GtkBox orientation={Gtk.Orientation.VERTICAL}>
                            <LogView lines={uploader.log} />
                            <StatusBar
                                status={uploader.status}
                                uploaded={uploader.counts.uploaded}
                                failed={uploader.counts.failed}
                                scan={uploader.scan}
                            />
                        </GtkBox>
                    }
                >
                    {!hasFolder ? (
                        <EmptyState onChooseFolder={() => setIsPreferencesOpen(true)} />
                    ) : uploader.entries.length === 0 ? (
                        <NoReplaysYet folder={uploader.config.watchDir} />
                    ) : (
                        <ReplayList
                            entries={uploader.entries}
                            onShowHistory={() => setIsHistoryOpen(true)}
                            onOpenMatch={openMatch}
                        />
                    )}
                </AdwToolbarView>
            </AdwToastOverlay>

            {/* GTKX presents an AdwDialog when it mounts and closes it on unmount,
                so a dialog is shown by rendering it, not by calling present(). */}
            {isHistoryOpen && (
                <HistoryDialog
                    entries={uploader.entries}
                    onClose={() => setIsHistoryOpen(false)}
                    onOpenMatch={openMatch}
                />
            )}
            {isPreferencesOpen && (
                <Preferences
                    config={uploader.config}
                    onChange={uploader.updateConfig}
                    onClose={() => setIsPreferencesOpen(false)}
                    unlinkedCount={uploader.unlinkedCount}
                    backfill={uploader.backfill}
                />
            )}
        </AdwApplicationWindow>
    );
};

// GApplication parses argv itself and aborts on an option it does not know, so
// --dir has to be declared here even though the value is read from process.argv.
const MAIN_OPTIONS = [
    {
        longName: "dir",
        shortName: "d",
        arg: GLib.OptionArg.STRING,
        description: "Watch this replay folder instead of the saved one",
        argDescription: "PATH",
    },
];

export const App = () => (
    <AdwApplication mainOptions={MAIN_OPTIONS}>
        <MainWindow />
    </AdwApplication>
);

export default App;
