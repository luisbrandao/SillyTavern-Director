import { chat } from "../../../../../script.js";
import { isEnabled } from "./settings/settings.js";
import { prepareDirector, addDirectorToMessage, clearInjects } from "./director.js";
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
		await prepareDirector(normalizedType);
	} catch (e) {
		console.error("[director] prepareDirector failed:", e);
		toastr?.error?.("Director generation failed. Check the director connection profile.");
	}
}

async function onCharacterMessageRendered(mesId) {
	if (!isEnabled()) return;
	await addDirectorToMessage(mesId);
	DirectorPreviewManager.updatePreview(mesId);
}

async function onUserMessageRendered(mesId) {
	if (!isEnabled()) return;
	await addDirectorToMessage(mesId);
	DirectorPreviewManager.updatePreview(mesId);
}

export const eventHandlers = {
	onChatChanged,
	onGenerateAfterCommands,
	onCharacterMessageRendered,
	onUserMessageRendered,
};
