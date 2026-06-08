import { chat, chat_metadata, saveChatConditional, setExtensionPrompt, getExtensionPromptRoleByName } from "../../../../../script.js";
import { extensionSettings } from "../index.js";
import { debug, getLastNonSystemMessageIndex, getPreviousNonSystemMessageIndex } from "../lib/utils.js";
import { generateDirectorOutline } from "./generation.js";
import { DirectorPreviewManager } from "./ui/directorPreviewManager.js";

// SillyTavern extension_prompt_types.IN_CHAT — inject between chat messages at a given depth.
const IN_CHAT = 1;
// Single key, so only ONE (the latest) director outline is ever injected into the prompt.
const INJECT_KEY = "director";

const ACTION_TYPES = {
	CONTINUE: "continue",
	SWIPE: "swipe",
	REGENERATE: "regenerate",
};

/**
 * Injects the given outline into the MAIN reply prompt via the vanilla extension-prompt system.
 * Passing an empty string clears the injection. Only one outline is ever injected (the latest).
 * @param {string} outline
 */
export async function injectDirector(outline = "") {
	let text = "";
	if (outline && String(outline).trim()) {
		text = `<director>\n${String(outline).trim()}\n</director>`;
	}
	const role = getExtensionPromptRoleByName(extensionSettings.injectionRole ?? "system");
	const depth = Math.max(0, Number(extensionSettings.injectionDepth) || 0);
	await setExtensionPrompt(INJECT_KEY, text, IN_CHAT, depth, true, role);
}

/** Clears the director injection (e.g. when the extension is disabled or the chat changes). */
export async function clearInjects() {
	await injectDirector("");
}

/**
 * Orchestrates the director pass for an upcoming reply: generate the outline (or reuse the existing
 * one on a swipe/regenerate), stash it for the message about to be rendered, and inject it so the
 * main model sees it. Mirrors the Tracker's temp-then-persist pattern. No stop-button toggling.
 * @param {string|undefined} type - Generation type (undefined/"normal", "swipe", "regenerate", ...).
 */
export async function prepareDirector(type) {
	if (!chat_metadata.director) chat_metadata.director = {};

	const lastId = getLastNonSystemMessageIndex();
	if (lastId === -1) {
		await injectDirector("");
		return;
	}

	let outline = null;
	let targetId = null;

	if ([ACTION_TYPES.SWIPE, ACTION_TYPES.REGENERATE, ACTION_TYPES.CONTINUE].includes(type)) {
		// Re-doing the last reply: reuse its stored outline; generate one only if missing.
		targetId = lastId;
		outline = chat[targetId]?.director || null;
		if (!outline) {
			const prevId = getPreviousNonSystemMessageIndex(targetId);
			if (prevId !== -1) outline = await generateDirectorOutline(prevId);
		}
	} else {
		// New reply: direct the upcoming turn from the just-sent message.
		targetId = lastId + 1;
		outline = await generateDirectorOutline(lastId);
	}

	if (outline) {
		chat_metadata.director.tempOutline = outline;
		chat_metadata.director.tempOutlineId = targetId;
		await saveChatConditional();
	}

	debug("Director outline prepared", { type, targetId, hasOutline: !!outline });
	await injectDirector(outline || "");
}

/**
 * Persists the pending temp outline onto a message once it has rendered (called from render events).
 * @param {number} mesId
 */
export async function addDirectorToMessage(mesId) {
	const meta = chat_metadata.director;
	if (!meta || meta.tempOutlineId !== mesId || !meta.tempOutline) return;

	chat[mesId].director = meta.tempOutline;
	meta.tempOutlineId = null;
	meta.tempOutline = null;
	await saveChatConditional();
	DirectorPreviewManager.updatePreview(mesId);
}

/**
 * Saves arbitrary outline text to a message (used by the edit UI / slash command).
 * @param {number} mesId
 * @param {string} text
 */
export async function saveDirectorToMessage(mesId, text) {
	if (!chat[mesId]) return;
	chat[mesId].director = String(text ?? "");
	await saveChatConditional();
	DirectorPreviewManager.updatePreview(mesId);
}

/**
 * Regenerates the outline for a specific message, directing from the previous message's context.
 * @param {number} mesId
 * @returns {Promise<string>} The new outline.
 */
export async function regenerateDirectorForMessage(mesId) {
	const prevId = getPreviousNonSystemMessageIndex(mesId);
	const fromId = prevId !== -1 ? prevId : mesId;
	const outline = await generateDirectorOutline(fromId);
	await saveDirectorToMessage(mesId, outline);
	return outline;
}

/**
 * Removes the director outline from a message.
 * @param {number} mesId
 * @returns {Promise<boolean>} true if an outline was present and removed.
 */
export async function removeDirectorFromMessage(mesId) {
	const mes = chat[mesId];
	if (!mes) return false;
	const had = !!(mes.director && String(mes.director).trim());
	delete mes.director;
	await saveChatConditional();
	DirectorPreviewManager.updatePreview(mesId);
	return had;
}
