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
	const trimmed = String(outline ?? "").trim();
	if (trimmed) {
		const template = extensionSettings.injectionTemplate || "<director>\n{{outline}}\n</director>";
		text = template.includes("{{outline}}") ? template.replaceAll("{{outline}}", trimmed) : `${template}\n${trimmed}`;
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
 * Reads the user's pending message — still sitting in the textarea at GENERATION_AFTER_COMMANDS
 * time, because SillyTavern only adds it to the chat afterwards. Read-only (we never clear it).
 */
function readPendingUserMessage(options) {
	if (options?.automatic_trigger) return "";
	try {
		const ta = document.getElementById("send_textarea");
		return ta ? String(ta.value || "").trim() : "";
	} catch (e) {
		return "";
	}
}

/**
 * Orchestrates the director pass for an upcoming BOT reply: generate the outline first, then inject
 * only the latest outline into the main request. The outline is attached to the bot message (never
 * the user message). Runs at GENERATION_AFTER_COMMANDS, which fires BEFORE SillyTavern adds the
 * user's message, so for a new reply we read that message from the textarea for context.
 * @param {string|undefined} type - Generation type (undefined/"normal", "swipe", "regenerate", ...).
 * @param {object} [options] - Generation options from the event (e.g. automatic_trigger).
 */
export async function prepareDirector(type, options) {
	if (!chat_metadata.director) chat_metadata.director = {};

	// Swipe / regenerate / continue: re-doing an EXISTING bot reply. Reuse its outline, or generate
	// from the prior context, and attach to that same (already-present) message.
	if ([ACTION_TYPES.SWIPE, ACTION_TYPES.REGENERATE, ACTION_TYPES.CONTINUE].includes(type)) {
		const lastId = getLastNonSystemMessageIndex();
		if (lastId === -1) {
			await injectDirector("");
			return;
		}
		let outline = chat[lastId]?.director || null;
		if (!outline) {
			const prevId = getPreviousNonSystemMessageIndex(lastId);
			outline = await generateDirectorOutline(prevId !== -1 ? prevId : lastId, "");
			if (outline) {
				chat[lastId].director = outline;
				await saveChatConditional();
				DirectorPreviewManager.updatePreview(lastId);
			}
		}
		debug("Director (repeat)", { type, lastId, hasOutline: !!outline });
		await injectDirector(outline || "");
		return;
	}

	// New reply. The user message isn't in the chat yet, so read it from the textarea for context.
	// The outline is held pending and attached to the next BOT message that renders.
	const pendingUserText = readPendingUserMessage(options);
	const lastId = getLastNonSystemMessageIndex();
	const outline = await generateDirectorOutline(lastId, pendingUserText);

	chat_metadata.director.pendingOutline = outline || "";
	await saveChatConditional();

	debug("Director (new reply)", { lastId, hasPendingUserText: !!pendingUserText, hasOutline: !!outline });
	await injectDirector(outline || "");
}

/**
 * Attaches the pending outline to a freshly rendered BOT message. Called from
 * CHARACTER_MESSAGE_RENDERED only — never attaches to a user message.
 * @param {number} mesId
 */
export async function attachPendingOutline(mesId) {
	const meta = chat_metadata.director;
	if (!meta || !meta.pendingOutline) return;
	if (!chat[mesId] || chat[mesId].is_user) return; // bot messages only
	chat[mesId].director = meta.pendingOutline;
	meta.pendingOutline = null;
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
