# Changelog

All notable changes to Dust are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
