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
        categories: ["Game", "Utility"],
    },
});
