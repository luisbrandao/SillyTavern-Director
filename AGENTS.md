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

## CRITICAL gotcha (learned from Tracker)
`activateSendButtons()` → `hideStopButton()` **emits `GENERATION_ENDED`** when it hides a visible stop button. If Director toggles the stop button while a host generation is in flight (which it is, at `GENERATION_AFTER_COMMANDS`), that spurious `GENERATION_ENDED` will flush other extensions' ephemeral injects (e.g. Guided Generations' `/inject ephemeral=true`). **Do not toggle the stop button during the intercept**, or pre-hide it before calling `activateSendButtons()` so the event guard short-circuits.

## Build, Test & Development
- No build step yet. Edit JS/HTML directly; if a `sass/` source is added later, treat the SCSS as source of truth and document the `npx sass` command here.
- Reload via SillyTavern `Settings → Extensions → Reload`. Inspect with debug mode on.
- **Bump `version` in `manifest.json`** on user-facing changes (semver).

## Commit & PR Expectations
- Short imperative commit titles; explain root cause in the body for non-obvious fixes.
