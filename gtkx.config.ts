import { defineConfig } from "@gtkx/config";

export default defineConfig({
    applicationId: "com.mygtkxapp.app",
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
        name: "My Gtkx App",
        summary: "A GTK4 application built with GTKX",
        description: [
            "My Gtkx App is a GTK4 and Adwaita application built with GTKX, which renders native GObject "
            + "widgets from React. Replace this paragraph with a description of what your application does.",
        ],
        categories: ["Utility"],
    },
});
