---
name: sharedspaces-notify
description: "Send progress notifications to the user via SharedSpaces while working asynchronously. Use when the user explicitly asks to be notified, pinged, or updated about long-running work — e.g. 'notify me via SharedSpaces', 'ping me when it's done', 'I'm stepping away', 'send updates to my phone'. Do NOT use for normal interactive work where the user is watching the terminal."
---

## Context

SharedSpaces delivers items to every joined member in real time, including web push to phones.
That makes it a good out-of-band notification channel for an agent doing long-running work while
the user is away from the terminal.

This skill is **opt-in and user-initiated**. If the user is sitting at the session watching your
output, notifications add noise and cost — don't use it. Only activate when the user has asked
for async updates.

## Setup (once per session)

Do this the first time notifications are requested, then reuse the result.

### 1. Verify the CLI

```bash
sharedspaces --version
```

If missing, tell the user to run `dotnet tool install --global SharedSpaces.Cli` (don't install it
for them without asking).

### 2. Pick a space

```bash
sharedspaces spaces --json
```

| Result | Action |
| --- | --- |
| 0 spaces | Ask the user for a join string or invite URL, then run `sharedspaces join "<string>" --display-name "<agent label>"` |
| 1 space | Use it. Tell the user which space you'll notify in. |
| >1 spaces | Ask the user which space to use. Show `spaceName` and `serverName`. |

Never guess when there is more than one space.

### 3. Derive a work label

A short identifier so the user can tell agent sessions apart in a shared space. Prefer
`<repo>/<branch>` (e.g. `SharedSpaces/maraf-glowing-waddle`), optionally plus a 2–4 word task
summary. Keep it under ~40 characters.

### 4. Persist the setup

Write `{ "spaceId", "spaceName", "serverUrl", "workLabel" }` to
`<artifacts_dir>/sharedspaces-notify.json` so setup isn't repeated later in the session.
**Never write this into the repository.**

## Sending a notification

```bash
sharedspaces send "[<workLabel>] <STATUS> — <one-line summary>" --space-id <spaceId> --ttl 3600
```

- **Text, not files.** Only use `sharedspaces upload` when the user explicitly asks for an artifact.
- **Default TTL is 3600 seconds (1 hour).** Notifications are ephemeral; they shouldn't pile up in
  the space. Honour a different TTL only if the user asks for one.
- Always include the work label so the message is attributable to this session.
- Keep the whole message under ~500 characters so it renders well as a push notification.
- Add at most 1–2 short detail lines after the summary line.

### Statuses

| Status | Use for |
| --- | --- |
| `MILESTONE` | A meaningful chunk of work completed, user has nothing to do |
| `DONE` | All requested work is finished |
| `BLOCKED` | Stuck on an external dependency (CI, network, missing access) |
| `NEEDS INPUT` | Cannot proceed without a user decision |
| `FAILED` | Unrecoverable failure; work has stopped |

### Examples

```bash
sharedspaces send "[SharedSpaces/notify-skill] MILESTONE — CLI send command implemented, 8 tests passing. Starting on the skill doc." --space-id $SPACE --ttl 3600

sharedspaces send "[SharedSpaces/notify-skill] NEEDS INPUT — Two auth strategies are viable (JWT vs session). Which do you want?" --space-id $SPACE --ttl 3600

sharedspaces send "[SharedSpaces/notify-skill] DONE — PR #142 opened, CI green." --space-id $SPACE --ttl 3600
```

## When to notify — and when not to

**Do notify:**

- A significant milestone in a multi-step task is complete
- All work is finished
- Blocked on something outside your control
- You need a decision from the user before continuing
- An unrecoverable failure stopped the work

**Do not notify:**

- Routine tool calls, individual file edits, per-command progress
- "Starting now" / "working on it" narration
- Retries, intermediate build or test runs you're going to re-run anyway
- Anything the user would see immediately in the terminal if they were watching

**Rate limits:** Aim for a handful of notifications across a long-running task — never more than one
every few minutes. If several milestones land close together, batch them into a single message.

## Failure handling

If `sharedspaces send` fails, note it briefly in your normal output and **continue the real work**.
A failed notification is never a reason to stop or retry in a loop. If sends fail repeatedly
(e.g. an expired token), mention it once and stop attempting to notify.

## Teardown

Include the final outcome in the `DONE` or `FAILED` message and stop notifying. The messages
expire on their own once the TTL elapses.
