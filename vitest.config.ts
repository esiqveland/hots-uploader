import gtkx from "@gtkx/cli/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        bail: 1,
        // Widget tests transform the generated bindings, which dominates the run.
        fsModuleCache: true,
        projects: [
            {
                // Backend tests are plain TypeScript. Keeping them out of the gtkx
                // plugin means they run without a headless compositor.
                test: {
                    name: "lib",
                    include: ["tests/lib/**/*.test.ts"],
                },
            },
            {
                // Widget tests render real GTK4, so they need the gtkx plugin and
                // the headless compositor it starts.
                plugins: [gtkx()],
                test: {
                    name: "widgets",
                    include: ["tests/**/*.test.tsx"],
                },
            },
        ],
    },
});
