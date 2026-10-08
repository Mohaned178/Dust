# Contributing to Dust

Thanks for helping. Dust is maintained as a trunk-based project: small, focused changes land on `master` and keep it releasable.

## Getting started

Requirements: Windows 10 or 11, and Node.js `^20.19.0 || >=22.12.0` with npm.

```bash
git clone https://github.com/Mohaned178/Dust.git
cd Dust
npm install
npm run dev:app
```

`dev:app` bundles the Electron main/preload/worker code, starts Vite, and launches the app. Main-process changes need a restart; the renderer hot-reloads. The full command list lives in the [README](README.md#scripts).

## The working loop

Run all three before opening a pull request. CI (`.github/workflows/ci.yml`) runs them on every push to `master` and every PR.

```bash
npm run typecheck
npm run lint
npm test
```

## Commits

Use Conventional Commits, lowercase and imperative:

```
feat(app): add scheduled scans
fix(core): refuse plan tokens after a snapshot prune
docs: describe the uninstall journal
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`. The scope names the workspace (`app`, `core`) or the repo concern. Keep each commit to one logical change and explain the _why_ in the body when it is not obvious.

## Pull requests

- Branch from `master`, keep the branch short-lived, and open the PR against `master`.
- One logical change per PR. Keep refactors separate from features and behavior changes.
- Fill in the pull request template.
- Update `README.md` or the docs when behavior, commands, or user-visible features change.

## Where things live

- `core/` — the TypeScript engine. It has no Electron imports, so its tests run in plain Node.
- `app/` — the Electron app: main process, preload bridge, and the React renderer.
- `docs/superpowers/` — the design spec and the ordered implementation plans.
- `PROJECT_BRIEF.md` — the locked decisions and design principles. Read this first.

For anything larger than a fix, start from the design spec or open an issue before writing a large PR.
