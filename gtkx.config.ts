import { defineConfig } from "@gtkx/config";

export default defineConfig({
    applicationId: "com.github.esiqveland.hotsreplayuploader",
    applicationIcon: "data/icons",
    future: {
        v2ByteArrays: true,
        v2ValueReturns: true,
        v2FinishResults: true,
        v2InoutReturns: true,
        v2ResourceImports: true,
        v2DefaultLibraries: true,
        v2TreeShaking: true,
    },
    deploy: {
        name: "HotS Replay Uploader",
        summary: "Automatically upload Heroes of the Storm replays to Heroes Profile",
        description: [
            "Watches your Heroes of the Storm replay folder and uploads every new match to "
            + "Heroes Profile as soon as the game finishes writing it.",
            "Replays are deduplicated by content, so restarting the app or re-scanning a folder "
            + "never uploads the same match twice, and failed uploads are retried with backoff.",
        ],
        // A desktop entry may only have one freedesktop.org main category; "Game" and
        // "Utility" together fail desktop-file-validate.
        categories: ["Game"],
        // AppStream wants a developer id in reverse-DNS form, matching the applicationId's
        // vendor prefix, not a bare username.
        developer: { id: "com.github.esiqveland", name: "Eivind Siqveland Larsen", email: "eivind@siqve.land" },
        license: "MIT",
        homepage: "https://github.com/esiqveland/hots-uploader",
        urls: {
            bugtracker: "https://github.com/esiqveland/hots-uploader/issues",
            "vcs-browser": "https://github.com/esiqveland/hots-uploader",
        },
        releases: [{ version: "0.1.0", date: "2026-09-13", notes: ["First installable release."] }],
        screenshots: [
            { file: "screenshots/main-window.png", caption: "Recent replays and season record", isDefault: true },
            { file: "screenshots/full-history.png", caption: "Full upload history" },
            { file: "screenshots/hero-stats.png", caption: "Win rate by hero" },
        ],
        screenshotBaseUrl: "https://raw.githubusercontent.com/esiqveland/hots-uploader/main/",
        // The app uploads to Heroes Profile over HTTPS; the sandbox default has no
        // network access. The watched replay folder needs no extra grant here — it's
        // chosen through Gtk.FileDialog, which the portal handles on its own.
        flatpak: {
            finishArgs: ["--share=network"],
        },
    },
});
