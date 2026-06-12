//#region Defaults

/**
 * Default director instruction appended to the end of the roleplay prompt when asking the
 * director model for the next-turn outline. {{user}} / {{char}} macros are resolved at request time.
 */
const directorPrompt = `For the next round, you are a scene director with two jobs: steward the plot, and direct the characters. You do not write the scene itself.
**1. Steward the plot.** Read the chat history and summary to understand where the story is heading—the active arcs, unresolved threads, and overall trajectory. The big picture is your responsibility. Use it to decide what the next beat needs to accomplish and how it serves the larger story. Think long-term, but direct only the immediate next beat: pick up from {{user}}'s last action, advance the story proportionately, then stop and leave room for {{user}} to act.
**2. Direct the characters.** In ordinary roleplay, characters drift toward sounding and acting alike. Your job is to prevent that. For each character present, use their personality, history, relationships, and current state of mind to shape how they react—and make those reactions distinct from one another. A playful character finds the game in the situation; a clumsy one makes small mistakes; a proud one bristles; a cautious one hesitates. Personality should show in behavior, not just be stated. Never direct a reaction that contradicts a character's established nature.
You give direction, not prose. Describe what should happen and why—beats, reactions, intent—not every line and gesture. You may suggest a specific detail or line as a hint, but the writer writes the turn.
Specify the intended tone—explicit/NSFW, humorous, serious, tense, tender, etc.—and note any tonal shift within the scene.
Control pacing deliberately: when characters are sharing a real moment, don't rush—let it breathe. When a scene is stalling or not advancing, push forward, compress, or skip to the next meaningful beat.
Do not write any actions, dialogue, or decisions for {{user}}.
Respond only with the scene direction. No preamble, no commentary.`;

const injectionTemplate = `<director>
For your response, follow the outline for the scene:

{{outline}}
</director>`;

//#endregion

export const injectionRoles = {
	SYSTEM: "system",
	USER: "user",
	ASSISTANT: "assistant",
};

export const defaultSettings = {
	// Master toggle.
	enabled: true,

	// The director instruction. Always appended to the end of the RP prompt for the director pass.
	directorPrompt: directorPrompt,
	// Role of the director instruction message in the director's OWN request. Must be "user" so the
	// message array ends on a user turn: standard chat-completion backends (Ollama/vLLM/llama.cpp)
	// always add a generation prompt, so a trailing "assistant" message renders as a COMPLETED turn
	// followed by an empty one -> the model emits an end token immediately and dies after 1 token.
	// "user" makes the model answer a real prompt; works on local backends and remote APIs alike.
	// ("assistant" only ever worked on prefill-style endpoints that continue a trailing assistant msg.)
	directorRole: injectionRoles.USER,
	// Named director-prompt profiles: alternate instruction wordings to switch between. The effective
	// prompt is always `directorPrompt`; a profile is a named, persistent copy bound to the editor.
	promptProfiles: [], // [{ name, prompt }]
	// Name of the profile the prompt editor is bound to. "" = free-form (no profile selected):
	// edits change only directorPrompt. With a profile active, edits also save back into it.
	activePromptProfile: "",
	// Optional clean character context for the director. When non-empty it REPLACES the character
	// card in the director's "### Persona description" section (useful for messy/monolithic cards).
	// Leave empty to use the active character card.
	characterContextOverride: "",

	// Independent connection used for the DIRECTOR pass, so it can run on a different model than the
	// main reply. "current" means: use SillyTavern's active connection profile.
	selectedProfile: "current",
	// Completion preset for the director pass. "current" means: use the profile's own preset.
	selectedCompletionPreset: "current",

	// Max output tokens for the director outline. 0 = follow the completion preset's own value.
	responseLength: 0,

	// How the director outline is injected into the MAIN reply prompt.
	// depth 0 + role system = appended at the end of the chat (the "end of the RP text").
	injectionDepth: 0,
	injectionRole: injectionRoles.USER,
	// Template wrapping the outline when injected into the main reply. {{outline}} is replaced with
	// the generated outline. Edit this to change the tag/format or add guiding instructions.
	injectionTemplate: injectionTemplate,

	// Context budget (tokens) for composing the director prompt. The director fits as many recent
	// messages as possible within this budget (minus the reserved response), like a normal ST prompt.
	// 0 = auto: use the director profile/preset's own context size (falling back to the app's current
	// max context).
	contextSize: 0,

	debugMode: false,
};
