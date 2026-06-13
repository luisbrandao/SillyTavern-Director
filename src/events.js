import { chat, streamingProcessor } from "../../../../../script.js";
import { isEnabled } from "./settings/settings.js";
import { prepareDirector, attachPendingOutline, clearInjects } from "./director.js";
import { DirectorPreviewManager } from "./ui/directorPreviewManager.js";
import { debug } from "../lib/utils.js";

const ALLOWED_TYPES = ["normal", "continue", "swipe", "regenerate", "group_chat"];

async function onChatChanged() {
	await clearInjects();
	DirectorPreviewManager.scanAndRender();
}

async function onGenerateAfterCommands(type, options, dryRun) {
	if (!isEnabled()) {
		await clearInjects();
		return;
	}
	if (dryRun) {
		debug("GENERATION_AFTER_COMMANDS dry run skip", { type });
		return;
	}
	if (chat.length === 0) return;
	if (typeof type !== "undefined" && !ALLOWED_TYPES.includes(type)) {
		debug("Director skipped for type", type);
		return;
	}

	const normalizedType = type === "normal" ? undefined : type;
	try {
		await prepareDirector(normalizedType, options);
	} catch (e) {
		console.error("[director] prepareDirector failed:", e);
		toastr?.error?.("Director generation failed. Check the director connection profile.");
	}
}

async function onCharacterMessageRendered(mesId) {
	if (!isEnabled()) return;
	// The director outline is for the bot reply — attach it here only.
	// With streaming on, onStreamTokenReceived has usually already attached it (and nulled the
	// pending outline) when the placeholder first appeared; this call is then a harmless no-op that
	// still refreshes the final preview. With streaming off, this is the attach point.
	await attachPendingOutline(mesId);
	DirectorPreviewManager.updatePreview(mesId);
}

/**
 * Attaches the pending outline to the streaming reply the moment its placeholder appears, instead of
 * waiting for CHARACTER_MESSAGE_RENDERED (which only fires once streaming finishes). STREAM_TOKEN_RECEIVED
 * carries no message id, but the live `streamingProcessor` export holds it: the placeholder is pushed
 * into chat in onStartStreaming, before the first token. attachPendingOutline nulls the pending outline
 * synchronously, so the remaining per-token calls are cheap no-ops — it attaches exactly once.
 */
async function onStreamTokenReceived() {
	if (!isEnabled()) return;
	const sp = streamingProcessor;
	if (!sp || sp.messageId < 0) return;
	// Only the visible bot reply — never an impersonation (no message) or a quiet/background gen.
	if (sp.type === "impersonate" || sp.type === "quiet") return;
	await attachPendingOutline(sp.messageId);
}

async function onUserMessageRendered(mesId) {
	if (!isEnabled()) return;
	// Never attach an outline to a user message; just refresh its preview (a no-op unless one exists).
	DirectorPreviewManager.updatePreview(mesId);
}

export const eventHandlers = {
	onChatChanged,
	onGenerateAfterCommands,
	onCharacterMessageRendered,
	onUserMessageRendered,
	onStreamTokenReceived,
};
