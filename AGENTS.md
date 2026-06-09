# Repository Guidelines — SillyTavern Director

## What this extension does
Director runs a **two-model pass** around a normal reply:
1. The user sends a message. Before the main reply is generated, Director intercepts (at `GENERATION_AFTER_COMMANDS`, like the Tracker extension does).
2. Director sends its own request to a **separate connection profile/model** (the "director model"): the current roleplay context with the configurable **director prompt** appended at the end. The model returns an *outline of what should happen next turn*.
3. Director stores that outline on the upcoming message and **injects only the latest outline** into the MAIN reply prompt (appended at the end of the RP text), then lets the main model generate the actual reply.
4. The outline is shown under the message (like the Tracker preview) and can be edited / regenerated / deleted.

Goal: direct the scene with a cheap/fast model, write the prose with the main model.

## Architecture & conventions
- **Entry:** `index.js` — settings init, event wiring, slash commands.
- **Core:** `src/director.js` (orchestration: intercept → generate → store → inject), `src/generation.js` (the independent director request), `src/events.js` (event handlers), `src/settings/` (config + defaults), `src/ui/` (per-message preview + edit/delete/regenerate).
- **Storage:** the outline lives on the message object as `chat[mesId].director` (mirrors how Tracker uses `chat[mesId].tracker`). Only the **last** message's outline is injected — never the whole history.
- **Injection: use the vanilla `setExtensionPrompt(...)` mechanism** (IN_CHAT, depth/role from settings) to append the outline to the main prompt. Do NOT hand-rewrite `chat[mesId].mes` the way Tracker's inline mode does — it's fragile and fights other extensions.
- **Independent connection:** use `ConnectionManagerRequestService` with the configured profile. To honor a dedicated completion preset, temporarily set `profile.preset` for the one request and restore it in `finally` (the core hardcodes `presetName: profile.preset`). Pull max-tokens from the preset (`openai_max_tokens` / `genamt`) when no explicit Response Length override is set — a hardcoded default silently truncates.

## Busy state: hiding the send button (and the CRITICAL gotcha)
While the director model is thinking, the send button is hidden so the user can't fire a second
generation on top of it — same UX as the Tracker. **Every** director request goes through
`generateDirectorOutline()` in `src/generation.js` (new reply, swipe/regenerate/continue, and the
manual regenerate button), so the busy-state toggle lives there and there alone — don't sprinkle it
across the callers.

The toggle is guarded and self-restoring:
```js
const manageStopButton = $("#mes_stop").css("display") === "none";
if (manageStopButton) deactivateSendButtons();
try { /* ...generate... */ } finally { if (manageStopButton) restoreSendButtons(); }
```
- **The `=== "none"` guard** means we only touch the buttons when nobody else is showing the stop
  button. True during the `GENERATION_AFTER_COMMANDS` intercept (core hasn't shown its own stop
  button yet) and during a manual regenerate (no host generation at all). If the stop button is
  already visible, some other flow owns it — leave it alone.
- **The `finally`** guarantees the button comes back even if generation throws.

⚠️ **The gotcha (learned from Tracker, the hard way):** `activateSendButtons()` → `hideStopButton()`
**emits `GENERATION_ENDED`** whenever it hides a *visible* stop button. Fire that mid-generation and
it flushes other extensions' ephemeral injects (e.g. Guided Generations' `/inject ephemeral=true`),
silently wiping their instructions out of the prompt. That's why we never call `activateSendButtons()`
directly — use the `restoreSendButtons()` helper, which **pre-hides the stop button first** so
`hideStopButton()`'s visibility check short-circuits and no event fires. If you add a new busy state,
reuse that helper; never restore buttons by hand.

## Build, Test & Development
- **No build step.** Edit JS/HTML directly. If a `sass/` source is ever added, treat the SCSS as the
  source of truth and document the exact `npx sass ...` command right here.
- **Reload** via SillyTavern `Settings → Extensions → Reload`. Turn on debug mode and watch the
  console — the code logs through `debug()` from `lib/utils.js`.
- **Bump `version` in `manifest.json` on every user-facing change** (semver: patch for fixes, minor
  for features, major for breaking). This is not optional — it's how users know a reload actually
  pulled the new code. e.g. the send-button busy state shipped as `0.1.0 → 0.2.0`.

## Commit & PR Expectations
- Short imperative commit titles ("Hide send button while director generates").
- Explain the **root cause** in the body for non-obvious fixes — future-you won't remember why the
  stop button gets pre-hidden.
