# Repository Merge Request Alerts

## Behavior

- The repository sidebar shows a merge request icon and open, unlinked merge request count beside the existing issue count. Hide the merge request indicator when the count is zero or unknown.
- Count pull requests independently from issues, deduplicate projects that resolve to the same Forge repository, and exclude items already linked to a work task.
- Notify when a newly discovered open merge request appears after the initial quiet baseline. Reuse the issue notification delivery and click-through behavior.

## Ownership And Event Order

- The Host `RepositoryIssueSummary` service owns Forge reads, per-kind cache entries, bounded discovery facts, repository grouping, and count derivation. `WorkTaskRepository` remains the owner of task associations; associations are read after Forge I/O so a newly linked item is excluded immediately.
- The UI shared read model owns only a reusable projection of Host results. The sidebar renders known positive counts and does not infer new items from count changes.
- The notification hook owns in-memory delivery deduplication watermarks and click targets. Issue and merge request discovery watermarks are separate, while desktop and browser delivery continue through the existing platform notification adapters.
- Refresh order: UI requests a summary -> Host resolves repositories -> Host reads issues and merge requests independently -> Host rereads task associations -> Host returns counts and discoveries -> UI updates the sidebar and sends unseen discoveries through platform notifications.

## Failure And Compatibility

- An unavailable merge request list must not erase issue counts or discoveries. Mark the summary incomplete and leave that repository's merge request count unknown.
- Preserve compatibility with older Hosts by keeping new summary fields optional; clients without merge request fields render no merge request indicator.
- The first read after mounting or changing Host establishes a quiet notification baseline. Repeated reads of the same discovery do not notify again.

## Acceptance

- A positive open merge request count renders its icon, count, tooltip description, and localized label beside the issue indicator; zero, unknown, loading, and unavailable counts do not show a false zero badge.
- Linked merge requests are removed from the pending count, and duplicate workspace aliases of one repository are counted once.
- A newly opened merge request produces one desktop/browser notification with the merge request URL as its click target; the first snapshot and later duplicate snapshots produce no notification.
- A failed merge request read preserves issue results and marks the response incomplete.
