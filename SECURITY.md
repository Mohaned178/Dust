# Security Policy

## Supported versions

Only the latest release is supported with security fixes. The 1.0.x line is current.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting instead:

1. Go to the [Security tab](https://github.com/Mohaned178/Dust/security/advisories) and choose **Report a vulnerability**.
2. Include:
   - the Dust version and your Windows version and build;
   - steps to reproduce, or a proof of concept;
   - the affected area (installer, Electron app, engine, cleanup plan, elevation handoff);
   - the impact you believe it has.
3. You will get a response as soon as possible. Credit in the release notes if you want it.

## Scope

In scope:

- Anything that lets a scan, plan, or deletion touch paths outside what the UI promises, or bypass the plan preview and confirmation.
- Flaws in the protected-path policy, the elevation handoff validation, or the uninstall journal and backups.
- The renderer's IPC surface and its security configuration (context isolation, sandbox, CSP, navigation and permission denial).

Out of scope:

- The SmartScreen warning on the unsigned 1.0.0 build — it is known and documented.
- Findings that require the user to hand-edit state under `%APPDATA%\Dust`.
- Auto-update — not shipped yet.
