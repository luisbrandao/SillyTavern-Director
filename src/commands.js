import { chat } from "../../../../../script.js";
import { getLastNonSystemMessageIndex } from "../lib/utils.js";
import { regenerateDirectorForMessage, removeDirectorFromMessage } from "./director.js";
import { isEnabled, toggleExtension } from "./settings/settings.js";

function resolveMesId(args) {
	let mesId = args?.message;
	if (mesId === undefined || mesId === null || mesId === "") {
		mesId = getLastNonSystemMessageIndex();
	}
	return Number(mesId);
}

function requireValidMesId(args) {
	const mesId = resolveMesId(args);
	if (!Number.isInteger(mesId) || mesId < 0 || !chat[mesId]) {
		throw new Error("No valid message found for the director.");
	}
	return mesId;
}

export async function directorRegenerateCommand(args) {
	const mesId = requireValidMesId(args);
	const outline = await regenerateDirectorForMessage(mesId);
	return outline ?? "";
}

export async function directorGetCommand(args) {
	const mesId = requireValidMesId(args);
	return chat[mesId].director ?? "";
}

export async function directorRemoveCommand(args) {
	const mesId = requireValidMesId(args);
	const removed = await removeDirectorFromMessage(mesId);
	return removed ? "true" : "false";
}

export async function directorStateCommand(args) {
	const enabledString = args?.enabled;
	let enabled = isEnabled();
	if (enabledString !== undefined && enabledString !== null && enabledString !== "") {
		enabled = String(enabledString).toLowerCase() === "true";
		await toggleExtension(enabled);
	}
	return enabled ? "true" : "false";
}
