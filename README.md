# Director (SillyTavern extension)

Direct the scene with one model, write the prose with another.

Director runs a **two-model pass** around every bot reply. Before SillyTavern generates the
character's response, Director quietly asks a **separate model** ("the director") to read the current
scene and produce a short **outline of what should happen next turn**. That outline is then injected
into the main reply request, so your main model writes the prose *guided by the director's plan*.

The point: use a cheap/fast model to plan, and your good (expensive) model to write.

It borrows mechanics from both the **Tracker** (intercept the turn, store per-message data, preview
under the message) and **Guided Generations** (inject an instruction into the reply), but builds the
request the vanilla way — `setExtensionPrompt` for injection and `ConnectionManagerRequestService`
for the separate connection — instead of hand-rewriting message text.

---

## How it works

1. You send a message and the bot reply starts generating.
2. At `GENERATION_AFTER_COMMANDS` (before the prompt is built), Director composes its own request:
   a system block + recent chat history + your just-typed message + the **director prompt**, and
   sends it to the **director connection profile** (which can be a different model than your main one).
3. The director model returns an outline. Director **injects only that latest outline** into the main
   reply request (via `setExtensionPrompt`, at a configurable depth/role), wrapped by your template.
4. Your main model writes the reply, guided by the outline.
5. The outline is stored on the **bot message** and shown as a collapsible **🎬 Director** block under
   it. You can edit, regenerate, or delete it.

Only the latest outline is ever sent to the main model — older outlines stay on their messages for
reference but aren't re-injected.

### The director's prompt is composed like a normal ST prompt
The director request is built as labeled sections, then as much history as the context budget allows:

```
### Author's Note             <- if positioned "Before scenario"
### Persona description       <- character card (or your override)
### Player character: <name>  <- your persona
### Author's Note             <- if positioned "After scenario"
### World Info                <- active lorebook entries for the scene
### Summary                   <- running story summary (Summarize extension), if present
<recent chat history, newest kept, fit to the context budget>
   (an "In-chat" Author's Note is inserted at its configured depth/role)
<your just-sent message>      <- read from the input box (it isn't in chat yet at this point)
<director prompt>             <- appended as its own message (default role: user)
```

`{{user}}` / `{{char}}` macros are resolved. History is packed to fit
`context size − reserved response − safety margin`, measured with SillyTavern's tokenizer.

---

## Install

Copy this folder to `public/scripts/extensions/third-party/SillyTavern-Director` (any folder name
works — the extension resolves its own path), then enable **Director** in
`Settings → Extensions`.

---

## Configuration

`Settings → Extensions → Director`:

| Setting | What it does |
|---|---|
| **Director enabled** | Master on/off. |
| **Director prompt** | The instruction sent to the director model, appended to the end of the RP. Default: *"You are a scene director. Consider the state of the world and respond with only an outline of the actions that should happen on the next turn"*. |
| **Director prompt profile** | Save the prompt under a name and switch between alternate wordings. `➕` saves the current prompt as a new profile, `✏️` renames, `🗑️` deletes (the prompt text stays in the editor). While a profile is selected, edits to the prompt are saved into it; "no profile" is free-form. "Reset to defaults" keeps your saved profiles. |
| **Director prompt role** | Role of that instruction message in the director request. Default **User** so the request ends on a user turn. Standard chat-completion backends (Ollama/vLLM/llama.cpp) always add a generation prompt, so a trailing **Assistant** message renders as a completed turn and the model dies after one token. Only use **Assistant** with prefill-style endpoints that continue a trailing assistant message. |
| **Character context override** | Optional. Replaces the character card in the `### Persona description` section — handy for messy/monolithic cards. Empty = use the active card. |
| **Connection profile (director model)** | The connection profile the director pass runs on. `current` = your active connection. Pick a different one to run the director on a separate model. |
| **Completion preset** | Completion preset for the director pass. `current` = the profile's own preset. |
| **Response length** | Max tokens for the director outline. `0` = use the preset's value. Set e.g. `800` for short outlines. |
| **Context size (tokens)** | Token budget for composing the director request. `0` = auto (the profile/preset's own context, falling back to the app's current max context). |
| **Injection depth** | Where the outline is injected into the main reply (`0` = end of chat). |
| **Injection role** | Role of the injected outline in the main reply (`system` / `user` / `assistant`). |
| **Injection template** | Wraps the outline before injection. `{{outline}}` is replaced with the generated text. Default `<director>\n{{outline}}\n</director>`. |
| **Reset to defaults** | Restores defaults, keeping your connection profile + preset. |

---

## Per-message controls

Each message has a **🎬 Show Director** button (in the message action row) and, when an outline
exists, a collapsible **🎬 Director** preview block beneath it.

- **Show Director** opens a single editable window: edit the outline and **Save**, **Regenerate**
  (refills the box in place), or **Delete**.
- The preview block has inline **regenerate / edit / delete** controls (same actions).

## Slash commands

| Command | Aliases | Description |
|---|---|---|
| `/director-regenerate [message=N]` | `/director` | (Re)generate the outline for a message (default: last non-system message). |
| `/director-get [message=N]` | | Return the stored outline for a message. |
| `/director-remove [message=N]` | `/director-delete` | Remove the outline from a message. |
| `/director-state [enabled=true|false]` | `/toggle-director` | Get or set the enabled state. |

---

## Notes & limitations

- **Director runs only for bot replies.** It fires before the reply, injects, and attaches the outline
  to the bot message — never to your message. On swipe/regenerate it reuses (or regenerates) that
  message's outline.
- **Non-streaming.** The director request is sent non-streamed — the outline isn't shown live, so
  there's nothing to stream, and a single response is marginally faster. (If a backend returns a
  compressed/garbled non-streamed body, that's a backend/proxy decode issue to fix there.)
- **Token counting** uses SillyTavern's active tokenizer, which may differ slightly from the director
  model's; the safety margin absorbs the drift. Set **Context size** explicitly if the auto value
  looks wrong for your backend.
- **Summary.** If the built-in Summarize extension has a running summary, it's included as `### Summary`
  (latest `message.extra.memory` at the director's context point, or the live-injected value). Critical
  on long RPs for carrying world state that has scrolled out of the recent-message window.
- **Author's Note.** The active Author's Note (including a merged Character Author's Note, honoring
  the insertion frequency) is placed where you configured it: `Before scenario` / `After scenario`
  become an `### Author's Note` system section; `In-chat @ Depth` is inserted into the history at
  that depth with the configured role.
- **Context fidelity (Option A).** The director sees the character card, persona, Author's Note,
  World Info, and recent history — not a byte-perfect copy of your full main prompt.
  Good enough to direct a scene; can be deepened later.
- **Persona name** in `### Player character:` is whatever `{{user}}` resolves to (set your persona
  name in SillyTavern if it shows "Unnamed Persona").

## License

Personal fork / project by Techmago.
