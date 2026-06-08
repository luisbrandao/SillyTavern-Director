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

	// Number of recent chat messages to feed the director pass as context.
	numberOfMessages: 10,

	debugMode: false,
};
