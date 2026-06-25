import { chat } from "../../../../../script.js";
import { extensionSettings } from "../index.js";

const PREFIX = "[director]";

/** Always-on log. */
export function log(...args) {
	console.log(PREFIX, ...args);
}

/** Debug log, silenced unless debugMode is on. */
export function debug(...args) {
	if (extensionSettings?.debugMode) console.log(`${PREFIX} debug`, ...args);
}

/** Warning log. */
export function warn(...args) {
	console.warn(PREFIX, ...args);
}

/** Error log. */
export function error(...args) {
	console.error(PREFIX, ...args);
}

/**
 * Returns the index of the last non-system message in the chat, or -1 if none.
 * @returns {number}
 */
export function getLastNonSystemMessageIndex() {
	for (let i = chat.length - 1; i >= 0; i--) {
		if (!chat[i].is_system) return i;
	}
	return -1;
}

/**
 * Returns the index of the last non-system message before the given index, or -1 if none.
 * @param {number} mesId
 * @returns {number}
 */
export function getPreviousNonSystemMessageIndex(mesId) {
	for (let i = mesId - 1; i >= 0; i--) {
		if (!chat[i].is_system) return i;
	}
	return -1;
}

/**
 * Returns the index of the first non-system message after the given index, or -1 if none.
 * @param {number} mesId
 * @returns {number}
 */
export function getNextNonSystemMessageIndex(mesId) {
	for (let i = mesId + 1; i < chat.length; i++) {
		if (!chat[i].is_system) return i;
	}
	return -1;
}

/**
 * Whether the given message index is a system message.
 * @param {number} mesId
 * @returns {boolean}
 */
export function isSystemMessage(mesId) {
	return !!chat[mesId]?.is_system;
}

/**
 * Returns the index of the last non-system message that carries a director outline, or -1 if none.
 * Used by the magic-wand entry to open the interface on the most relevant message.
 * @returns {number}
 */
export function getLastMessageWithDirector() {
	for (let i = chat.length - 1; i >= 0; i--) {
		if (chat[i]?.is_system) continue;
		if (String(chat[i]?.director ?? "").trim()) return i;
	}
	return -1;
}
