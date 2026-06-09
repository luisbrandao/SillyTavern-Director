//#region Defaults

/**
 * Default director instruction appended to the end of the roleplay prompt when asking the
 * director model for the next-turn outline. {{user}} / {{char}} macros are resolved at request time.
 */
const directorPrompt = `You are a scene director. Do not continue the narration or write the scene itself. Instead, give high-level direction for how the next scene should go.
Direct only as far ahead as the story has actually reached. Pick up from {{user}}'s last action and direct the next beat that naturally follows from it—do not plan out events far beyond the current moment or resolve things {{user}} hasn't reached yet. Advance the story proportionately, then stop and leave room for {{user}} to act.
For each character present, account for their personality, history, relationships, and current state of mind, and direct them to react as they realistically would—staying true to who they are and to the world's established history. Don't invent reactions that contradict a character's established nature.
Give high-level instructions, not a step-by-step breakdown. Describe what should happen and why, not every line and gesture.
Specify the intended tone—explicit/NSFW, humorous, serious, tense, tender, etc.—so the writer knows what register to hit. Note any shift in tone within the scene.
Control pacing deliberately: when characters are sharing a real moment (emotional, intimate, climactic, or otherwise significant), don't rush—let it breathe. When a scene is stalling or not advancing, push forward, compress, or skip to the next meaningful beat.
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
	// Role of the director instruction message in the director's OWN request. Keep it different from
	// "user" (default: assistant) so chat-completion post-processing doesn't merge it into the last
	// user message.
	directorRole: injectionRoles.ASSISTANT,
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
	injectionRole: injectionRoles.ASSISTANT,
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
