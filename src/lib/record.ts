/** How many recent games the overview covers. */
export const RECORD_WINDOW = 100;

export interface Record {
    wins: number;
    losses: number;
    /** Games counted: at most RECORD_WINDOW, and only those with a known result. */
    total: number;
    /** Percentage, rounded. Zero when nothing is counted. */
    winRate: number;
}

/**
 * Wins and losses over the most recent games.
 *
 * Only replays with a known outcome count. A replay whose file was never parsed,
 * or that was played before we knew which player is you, has no result — leaving
 * it out keeps the rate honest rather than silently treating it as a loss.
 */
export const recordOf = (
    outcomes: readonly ("win" | "loss" | undefined)[],
    window: number = RECORD_WINDOW,
): Record => {
    let wins = 0;
    let losses = 0;

    for (const outcome of outcomes) {
        if (outcome === undefined) {
            continue;
        }
        if (outcome === "win") {
            wins++;
        } else {
            losses++;
        }
        if (wins + losses >= window) {
            break;
        }
    }

    const total = wins + losses;
    return { wins, losses, total, winRate: total === 0 ? 0 : Math.round((wins / total) * 100) };
};
