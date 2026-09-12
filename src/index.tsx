import { createRoot } from "@gtkx/react";
import { App } from "./app.js";
import { processArgs, USAGE } from "./lib/args.js";

if (processArgs().help) {
    console.log(USAGE);
    process.exit(0);
}

createRoot().render(<App />);
