# Usage meter

The sidebar shows today's Claude token consumption ("N tokens today"), expandable into a
per-model breakdown. Token counts only — no dollar estimates.

## How it counts

`src-tauri/src/usage.rs` scans `~/.claude/projects/**/*.jsonl`:

- Only files **modified today** are opened (cheap even with months of history).
- Only `type == "assistant"` entries whose `timestamp` is today (UTC).
- **Dedupe** by `message.id` (fallback `requestId`) — Claude Code can log a turn twice.
- **Fresh tokens** = `input + output + cache_creation` per model. **Cache reads** are
  excluded from the headline (they're near-free re-reads that would dwarf everything)
  and shown as a separate line in the breakdown.

`get_usage_stats` is an async command; `UsageMeter.tsx` polls it every 60s and renders
nothing when there's no activity.

## Files

- `src-tauri/src/usage.rs` (+ unit tests: summing, dedupe, date filter, bad json)
- `src/components/UsageMeter.tsx` (+ `UsageMeter.test.tsx`)
