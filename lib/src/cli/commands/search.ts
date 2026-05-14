/**
 * F-07 — Top-level `search` alias to `index search`.
 *
 * Provides a user-friendly shortcut for the most frequent daily action.
 * Delegates to IndexSearchCommand with identical flags.
 */
import {
  IndexSearchCommand,
} from './index-search';

/**
 * Search command class (thin alias to IndexSearchCommand).
 */
export class SearchCommand extends IndexSearchCommand {
  public static readonly paths = [['search']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = IndexSearchCommand.Usage({
    description: 'Search primitives by query (alias for `index search`).',
    category: 'Search',
    details: `
      Usage: prompt-registry search <query> [options]

      This is a convenience alias for \`index search\`. All flags are identical.

      Examples:
        prompt-registry search "code review"
        prompt-registry search "code review" --kinds prompt skill
        prompt-registry search "code review" --limit 10
    `
  });
}
