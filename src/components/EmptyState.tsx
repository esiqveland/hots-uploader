import * as Gtk from "@gtkx/gi/gtk";
import { AdwStatusPage } from "@gtkx/jsx/adw";
import { GtkButton } from "@gtkx/jsx/gtk";

export const EmptyState = ({ onChooseFolder }: { onChooseFolder: () => void }) => (
    <AdwStatusPage
        iconName="folder-symbolic"
        title="No Replay Folder"
        description="Pick the Multiplayer folder that Heroes of the Storm writes replays into, and every new match will be uploaded to Heroes Profile automatically."
        vexpand={true}
    >
        <GtkButton
            label="Choose Replay Folder"
            cssClasses={["suggested-action", "pill"]}
            halign={Gtk.Align.CENTER}
            onClicked={onChooseFolder}
        />
    </AdwStatusPage>
);
