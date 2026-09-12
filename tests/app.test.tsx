import * as Gtk from "@gtkx/gi/gtk";
import { render, screen, userEvent } from "@gtkx/testing";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../src/components/EmptyState.js";
import { HeaderBar } from "../src/components/HeaderBar.js";
import { HistoryDialog } from "../src/components/HistoryDialog.js";
import { ReplayList } from "../src/components/ReplayList.js";
import type { ReplayEntry } from "../src/hooks/use-uploader.js";

// These render the presentational components directly. The App itself reads the
// real config and upload history on mount, so it is covered by tests/lib instead.

const entry = (name: string, overrides: Partial<ReplayEntry> = {}): ReplayEntry => ({
    name,
    status: "uploaded",
    at: "2024-11-11T23:38:06.000Z",
    ...overrides,
});

describe("EmptyState", () => {
    it("offers to pick a replay folder", async () => {
        await render(<EmptyState onChooseFolder={() => {}} />);

        const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, {
            name: "Choose Replay Folder",
        });
        expect(button).toBeDefined();
    });

    it("calls back when the button is clicked", async () => {
        const onChooseFolder = vi.fn();
        await render(<EmptyState onChooseFolder={onChooseFolder} />);

        const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, {
            name: "Choose Replay Folder",
        });
        await userEvent.click(button);

        expect(onChooseFolder).toHaveBeenCalledOnce();
    });
});

describe("ReplayList", () => {
    it("renders one row per replay, newest first", async () => {
        await render(
            <ReplayList onShowHistory={() => {}} onOpenMatch={() => {}} entries={[entry("newest.StormReplay"), entry("older.StormReplay")]} />,
        );

        expect(await screen.findByText("newest.StormReplay")).toBeDefined();
        expect(await screen.findByText("older.StormReplay")).toBeDefined();
    });

    it("shows the upload time in day-first format", async () => {
        await render(<ReplayList onShowHistory={() => {}} onOpenMatch={() => {}} entries={[entry("game.StormReplay")]} />);

        expect(await screen.findByText(/^12\.11\.2024/)).toBeDefined();
    });

    it("shows the failure reason instead of a time when an upload failed", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("game.StormReplay", { status: "failed", detail: "status=500" })]}
            />,
        );

        expect(await screen.findByText("status=500")).toBeDefined();
    });

    it("shows only the ten most recent replays", async () => {
        const entries = Array.from({ length: 150 }, (_, i) => entry(`replay-${i}.StormReplay`));

        await render(<ReplayList onShowHistory={() => {}} onOpenMatch={() => {}} entries={entries} />);

        expect(await screen.findByText("replay-9.StormReplay")).toBeDefined();
        expect(screen.queryByText("replay-10.StormReplay")).toBeNull();
    });

    it("offers the full history, with its size, when there is more to see", async () => {
        const onShowHistory = vi.fn();
        const entries = Array.from({ length: 150 }, (_, i) => entry(`replay-${i}.StormReplay`));

        await render(
            <ReplayList onShowHistory={onShowHistory} onOpenMatch={() => {}} entries={entries} />,
        );

        const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, {
            name: "Show Full History (150)",
        });
        await userEvent.click(button);

        expect(onShowHistory).toHaveBeenCalledOnce();
    });

    it("drops the count when everything is already on screen", async () => {
        await render(<ReplayList onShowHistory={() => {}} onOpenMatch={() => {}} entries={[entry("only.StormReplay")]} />);

        expect(
            await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show Full History" }),
        ).toBeDefined();
    });
});

describe("HeaderBar", () => {
    const props = {
        status: "watching" as const,
        hasFolder: true,
        onStart: () => {},
        onStop: () => {},
        onRescan: () => {},
        onOpenFolder: () => {},
        onOpenPreferences: () => {},
    };

    it("offers to open the watched folder", async () => {
        const onOpenFolder = vi.fn();
        await render(<HeaderBar {...props} onOpenFolder={onOpenFolder} />);

        const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, {
            name: "Open replay folder",
        });
        await userEvent.click(button);

        expect(onOpenFolder).toHaveBeenCalledOnce();
    });

    it("disables the folder, start and rescan buttons when no folder is set", async () => {
        await render(<HeaderBar {...props} hasFolder={false} status="stopped" />);

        for (const name of ["Open replay folder", "Rescan folder", "Start watching"]) {
            const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name });
            expect(button.sensitive, name).toBe(false);
        }
    });

    it("offers Stop while watching and Start once stopped", async () => {
        const { rerender } = await render(<HeaderBar {...props} />);
        expect(
            await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Stop watching" }),
        ).toBeDefined();

        await rerender(<HeaderBar {...props} status="stopped" />);
        expect(
            await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Start watching" }),
        ).toBeDefined();
    });
});

describe("HistoryDialog", () => {
    it("renders the rows that are on screen", async () => {
        await render(
            <HistoryDialog
                entries={[entry("newest.StormReplay"), entry("older.StormReplay")]}
                onClose={() => {}}
                onOpenMatch={() => {}}
            />,
        );

        expect(await screen.findByText("newest.StormReplay")).toBeDefined();
        expect(await screen.findByText("older.StormReplay")).toBeDefined();
    });

    it("builds only the visible rows out of a long history", async () => {
        const entries = Array.from({ length: 2000 }, (_, i) => entry(`replay-${i}.StormReplay`));

        await render(<HistoryDialog entries={entries} onClose={() => {}} onOpenMatch={() => {}} />);

        // The first rows exist; a row far past the viewport is never built, which
        // is the whole reason this dialog uses GtkListView instead of GtkListBox.
        expect(await screen.findByText("replay-0.StormReplay")).toBeDefined();
        expect(screen.queryByText("replay-1999.StormReplay")).toBeNull();
    });

    it("shows why an upload failed", async () => {
        await render(
            <HistoryDialog
                entries={[entry("game.StormReplay", { status: "failed", detail: "status=500" })]}
                onClose={() => {}}
                onOpenMatch={() => {}}
            />,
        );

        expect(await screen.findByText("status=500")).toBeDefined();
    });
});

describe("match links", () => {
    it("disables the link, rather than hiding it, when there is no match id", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[
                    entry("linked.StormReplay", { replayId: 65133342 }),
                    entry("unlinked.StormReplay"),
                ]}
            />,
        );

        const links = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, {
            name: "View Match",
        });
        expect(links).toHaveLength(2);
        expect(links[0]!.sensitive).toBe(true);
        expect(links[1]!.sensitive).toBe(false);
    });

    it("says why the link is disabled", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("unlinked.StormReplay")]}
            />,
        );

        const link = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Match" });
        expect(link.tooltipText).toBe(
            "Disabled: no Heroes Profile match id was found for this replay",
        );
    });

    it("does not call the handler when the disabled link is clicked", async () => {
        const onOpenMatch = vi.fn();
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={onOpenMatch}
                entries={[entry("unlinked.StormReplay")]}
            />,
        );

        const link = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Match" });
        await userEvent.click(link).catch(() => {});

        expect(onOpenMatch).not.toHaveBeenCalled();
    });

    it("passes the replay id to the handler when the link is clicked", async () => {
        const onOpenMatch = vi.fn();
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={onOpenMatch}
                entries={[entry("linked.StormReplay", { replayId: 65133342 })]}
            />,
        );

        const link = await screen.findByRole(Gtk.AccessibleRole.BUTTON, {
            name: "View Match",
        });
        await userEvent.click(link);

        expect(onOpenMatch).toHaveBeenCalledWith(65133342);
    });

    it("shows a rejection in words rather than as an API code", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("ai.StormReplay", { status: "rejected", detail: "AiDetected" })]}
            />,
        );

        expect(await screen.findByText("Rejected: against AI")).toBeDefined();
    });

    it("links rows in the full history too", async () => {
        await render(
            <HistoryDialog
                entries={[entry("linked.StormReplay", { replayId: 42 })]}
                onClose={() => {}}
                onOpenMatch={() => {}}
            />,
        );

        expect(
            await screen.findByRole(Gtk.AccessibleRole.BUTTON, {
                name: "View Match",
            }),
        ).toBeDefined();
    });
});

describe("match details in a row", () => {
    it("titles the row with the map once the replay has been read", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("2026-09-12 00.30.22 Sky Temple.StormReplay", { map: "Sky Temple" })]}
            />,
        );

        expect(await screen.findByText("Sky Temple")).toBeDefined();
    });

    it("falls back to the filename when the replay has not been read", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("2026-09-12 00.30.22 Sky Temple.StormReplay")]}
            />,
        );

        expect(
            await screen.findByText("2026-09-12 00.30.22 Sky Temple.StormReplay"),
        ).toBeDefined();
    });

    it("shows your hero alongside the time", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("g.StormReplay", { map: "Sky Temple", hero: "Chen" })]}
            />,
        );

        expect(await screen.findByText(/^Chen · /)).toBeDefined();
    });

    it("shows the result as its own badge, not as subtitle text", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[
                    entry("win.StormReplay", { map: "Sky Temple", hero: "Chen", outcome: "win" }),
                    entry("loss.StormReplay", { map: "Braxis", hero: "Sonya", outcome: "loss" }),
                ]}
            />,
        );

        expect(await screen.findByText("Victory")).toBeDefined();
        expect(await screen.findByText("Defeat")).toBeDefined();
        // The subtitle keeps the hero and time only.
        expect(await screen.findByText(/^Chen · /)).toBeDefined();
    });

    it("shows no result badge when the player id could not be worked out", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("g.StormReplay", { map: "Sky Temple", hero: "Chen" })]}
            />,
        );

        expect(screen.queryByText("Victory")).toBeNull();
        expect(screen.queryByText("Defeat")).toBeNull();
    });

    it("omits the result when the player id could not be worked out", async () => {
        await render(
            <ReplayList
                onShowHistory={() => {}}
                onOpenMatch={() => {}}
                entries={[entry("g.StormReplay", { map: "Sky Temple" })]}
            />,
        );

        expect(await screen.findByText(/^12\.11\.2024/)).toBeDefined();
    });
});

describe("upload status badge", () => {
    const rows = (entries: ReplayEntry[]) => (
        <ReplayList onShowHistory={() => {}} onOpenMatch={() => {}} entries={entries} />
    );

    // A successful upload is the normal case and needs no badge of its own.
    it("shows nothing for a successful upload", async () => {
        await render(rows([entry("g.StormReplay", { map: "Sky Temple", outcome: "win" })]));

        expect(await screen.findByText("Victory")).toBeDefined();
        expect(screen.queryByText("Uploaded")).toBeNull();
    });

    it("shows a badge while an upload is in flight", async () => {
        await render(rows([entry("g.StormReplay", { status: "uploading" })]));

        expect(await screen.findByText("Uploading")).toBeDefined();
    });

    it("shows a badge when the upload failed", async () => {
        await render(rows([entry("g.StormReplay", { status: "failed", detail: "status=500" })]));

        expect(await screen.findByText("Failed")).toBeDefined();
    });

    it("shows a badge when Heroes Profile rejected the replay", async () => {
        await render(rows([entry("g.StormReplay", { status: "rejected", detail: "AiDetected" })]));

        expect(await screen.findByText("Against AI")).toBeDefined();
    });

    it("puts the upload badge before the result", async () => {
        await render(
            rows([
                entry("g.StormReplay", { status: "failed", detail: "boom", outcome: "loss" }),
            ]),
        );

        // The status badge is a box (it can hold a spinner), so compare the box
        // itself against the outcome label within the row's suffix.
        const statusBadge = (await screen.findByText("Failed")).getParent();
        const defeat = await screen.findByText("Defeat");
        const suffix = defeat.getParent();
        const order: unknown[] = [];
        for (let child = suffix?.getFirstChild(); child; child = child.getNextSibling()) {
            order.push(child);
        }
        expect(order).toContain(statusBadge);
        expect(order.indexOf(statusBadge)).toBeLessThan(order.indexOf(defeat));
    });

    it("spins inside the badge while an upload is in flight", async () => {
        await render(rows([entry("g.StormReplay", { status: "uploading" })]));

        const badge = (await screen.findByText("Uploading")).getParent();
        const kinds: string[] = [];
        for (let child = badge?.getFirstChild(); child; child = child.getNextSibling()) {
            kinds.push(child.constructor.name);
        }
        expect(kinds).toContain("Spinner");
    });

    it("has no spinner in the failed badge", async () => {
        await render(rows([entry("g.StormReplay", { status: "failed", detail: "boom" })]));

        const badge = (await screen.findByText("Failed")).getParent();
        const kinds: string[] = [];
        for (let child = badge?.getFirstChild(); child; child = child.getNextSibling()) {
            kinds.push(child.constructor.name);
        }
        expect(kinds).not.toContain("Spinner");
    });
});
