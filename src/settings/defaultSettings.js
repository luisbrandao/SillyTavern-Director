//#region Defaults

/**
 * Default director instruction appended to the end of the roleplay prompt when asking the
 * director model for the next-turn outline.
 */
const directorPrompt =
	"You are a scene director. Consider the state of the world and respond with only an outline of the actions that should happen on the next turn";

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
	injectionRole: injectionRoles.SYSTEM,
	// Template wrapping the outline when injected into the main reply. {{outline}} is replaced with
	// the generated outline. Edit this to change the tag/format or add guiding instructions.
	injectionTemplate: "<director>\n{{outline}}\n</director>",

	// Context budget (tokens) for composing the director prompt. The director fits as many recent
	// messages as possible within this budget (minus the reserved response), like a normal ST prompt.
	// 0 = auto: use the director profile/preset's own context size (falling back to the app's current
	// max context).
	contextSize: 0,

	debugMode: false,
};
