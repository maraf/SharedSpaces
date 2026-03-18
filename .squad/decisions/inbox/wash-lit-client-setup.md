# Wash decision note — Lit client bootstrap

## Context
Issue #23 established the first client scaffold under `src/SharedSpaces.Client/`.

## Decision
Use a standalone Vite + Lit + TypeScript app with:
- vertical slices in `src/features/`
- shared UI in `src/components/`
- shared utilities and context in `src/lib/`
- a `BaseElement` light DOM base class for every rendered component
- runtime API configuration sourced from `<meta name="api-base-url">` in `index.html`
- temporary in-component state switching in `src/app-shell.ts` instead of adding a router now

## Notes
- Tailwind CSS v4 is wired through `@tailwindcss/vite` and relies on light DOM rendering.
- The current setup uses Vite 7.x because `@tailwindcss/vite` 4.2.x peers with Vite 5-7; revisit once the plugin supports Vite 8+.
- Placeholder files for future auth and SignalR work live in `src/lib/auth-context.ts` and `src/lib/signalr-client.ts`.
