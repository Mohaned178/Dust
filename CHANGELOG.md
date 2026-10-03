# Changelog

All notable changes to Dust are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-04

Fix release: bulk cleanup now deletes every selected item, and results refresh after a clean.

### Fixed

- **Bulk cleanup** — "Select all safe" (and any multi-row selection) now builds a plan containing every selected item instead of only the first one. Previously a bulk clean deleted a single item, and a retry could report "Nothing to clean here".
- **Results refresh** — the post-analyze results view now reloads after a cleanup, so deleted rows disappear immediately instead of staying visible.

## [1.1.0] - 2026-10-04

Performance release: Analyze is much faster and the app no longer stalls on PowerShell-backed work.

### Added

- **In-app updates** — packaged builds check GitHub Releases on startup, download updates in the background, and show a "Restart to update" banner when one is ready.

### Changed

- **Analyze speed** — the scanner now reads file sizes and timestamps during directory enumeration instead of issuing one extra filesystem call per file, and ramps up its worker pool sooner. On the test machine this is ~4x faster on a 200k-file tree and ~1.6x on a warm real tree; cold-cache and HDD gains are larger because per-file handle opens (and antivirus interception) are eliminated.
- **Startup** — volume discovery no longer blocks the first window; it runs in the background.
- **Deep Uninstall preview** — leftover sizing is asynchronous and no longer freezes the UI; registry snapshots are cached for 5 minutes and invalidated after a removal.
- **Recycle bin** — leftover items are staged to the Recycle Bin in batches (up to 40 paths per PowerShell run) instead of one process per item, and emptying the Recycle Bin no longer blocks the main process.
- **Startup Manager** — registry snapshots are cached for 30 seconds and invalidated on every toggle.
- **Installed apps and volumes** — the lists are persisted to the user-data folder (12 h / 1 h TTL) so restarts do not re-query PowerShell.
- **Navigation** — Dashboard category cards use a lightweight categories-only IPC payload, changing category in Results no longer rebuilds the row store, and scan events no longer re-render inactive views.

### Fixed

- File metadata (size and modification time) from the native enumerator matches Node's `fs` values exactly, keeping snapshots and pool/legacy scans identical.

## [1.0.0] - 2026-09-28

First production release: a Windows NSIS installer published through GitHub Releases.
The build is not code-signed, so Windows SmartScreen may warn on first run.

### Added

- **Dashboard** — disk cards with usage bars, reclaimable totals, category evidence, and the global Analyze / Quick Clean actions.
- **Analyze** — a progressive, cancellable drive scan with live progress and partial-result retention.
- **Results** — a size-ordered contributor list with safety grades, evidence, category filters, recovery paths, and the full folder tree behind "Browse everything".
- **Quick Clean** — temp files, the Recycle Bin, the npm cache, and app caches with a preview, explicit confirmation, and a freed-bytes summary.
- **Dev Cleanup** — npm project discovery grouped Dead / Occasional / Active / Orphaned / Pinned, with rebuild commands and a session-only "Recently cleaned" group.
- **Startup Manager** — per-entry on/off switches with a Dust backup, 5-second undo, protected system rows, and an elevated toggle handoff.
- **Deep Uninstall** — installed-app removal with leftover discovery, registry backups, a write-ahead journal, verification, and an elevated relaunch that rebuilds the plan before any write.
- **System Info** — a read-only OS/CPU/GPU/firmware snapshot with live CPU and memory usage and a copyable plain-text report.
- **Browse-only volumes** — non-system volumes show size and structure with a guarded permanent delete.

### Security

- Deep Uninstall targets are validated at plan and execution time against a protected-path policy; traversal, volume roots, and untrusted parents are refused.
- Deletions are gated on a successful write-ahead journal entry, and user-data items always go through the Recycle Bin.
- Plan tokens remain the only cleaner deletion path; the elevated uninstall flow carries no executable plan and requires confirmation in the elevated window.
