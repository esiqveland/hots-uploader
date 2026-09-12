import * as Gio from "@gtkx/gi/gio";
import * as Gtk from "@gtkx/gi/gtk";
import { useParentWindow } from "@gtkx/react";
import { useCallback } from "react";

/**
 * Opens a folder in the desktop's file manager.
 *
 * `Gtk.FileLauncher` goes through the portal, so it works the same inside and
 * outside a sandbox, unlike spawning xdg-open.
 */
export const useOpenFolder = (onError?: (message: string) => void) => {
    const window = useParentWindow();

    return useCallback(
        async (path: string) => {
            if (path === "") {
                return;
            }
            const launcher = new Gtk.FileLauncher();
            launcher.setFile(Gio.File.newForPath(path));
            try {
                await launcher.launch(window);
            } catch (cause) {
                const error = cause instanceof Error ? cause : new Error(String(cause));
                onError?.(`Could not open ${path}: ${error.message}`);
            }
        },
        [onError, window],
    );
};

/**
 * Opens a URL in the desktop's browser. Same portal-backed route as
 * {@link useOpenFolder}, so it behaves the same inside and outside a sandbox.
 */
export const useOpenUri = (onError?: (message: string) => void) => {
    const window = useParentWindow();

    return useCallback(
        async (uri: string) => {
            if (uri === "") {
                return;
            }
            const launcher = new Gtk.UriLauncher({ uri });
            try {
                await launcher.launch(window);
            } catch (cause) {
                const error = cause instanceof Error ? cause : new Error(String(cause));
                onError?.(`Could not open ${uri}: ${error.message}`);
            }
        },
        [onError, window],
    );
};
