import { chat } from "../../../../../script.js";
import { getContext } from "../../../../../scripts/extensions.js";
import { extensionSettings } from "../index.js";
import { debug, warn } from "../lib/utils.js";

/**
 * Resolves a connection profile id by name. "current" => the active profile.
 * @param {object} ctx
 * @param {string} name
 * @returns {string|null}
 */
function getProfileIdByName(ctx, name) {
	const cm = ctx?.extensionSettings?.connectionManager;
	if (!cm) return null;
	if (name === "current") return cm.selectedProfile;
	const p = cm.profiles?.find((x) => x.name === name);
	return p ? p.id : null;
}

/**
 * Resolves the max output tokens a completion preset defines (so the director response isn't
 * silently truncated). Chat-completion presets use `openai_max_tokens`; text completion `genamt`.
 * @returns {number|null}
 */
function resolvePresetMaxTokens(ctx, profile, presetName) {
	if (!presetName) return null;
	try {
		const isCc = profile?.mode === "cc";
		const presetManager = ctx.getPresetManager(isCc ? "openai" : "textgenerationwebui");
		const preset = presetManager?.getCompletionPresetByName?.(presetName);
		if (!preset) return null;
		const max = isCc ? preset.openai_max_tokens : preset.genamt;
		return typeof max === "number" && max > 0 ? max : null;
	} catch (e) {
		warn("Could not resolve preset max tokens:", e?.message);
		return null;
	}
}

/**
 * Builds the director system prompt as labeled sections: the character card under
 * "### Persona description" and the player's persona under "### Player character: <name>".
 * (World Info is appended as its own section in buildDirectorMessages.) Macros like {{user}} /
 * {{char}} are resolved via substituteParams; stray carriage returns are stripped.
 */
function buildDirectorSystemPrompt(ctx) {
	const sub = (value) => {
		const s = String(value ?? "").replace(/\r/g, "");
		try {
			return typeof ctx.substituteParams === "function" ? String(ctx.substituteParams(s)) : s;
		} catch (e) {
			return s;
		}
	};

	const sections = [];
	try {
		// "### Persona description": a user-provided override if set, else the character card.
		const override = String(extensionSettings.characterContextOverride ?? "").trim();
		let card = "";
		if (override) {
			card = sub(override).trim();
		} else {
			const char = ctx.characters && ctx.characterId != null ? ctx.characters[ctx.characterId] : null;
			if (char) {
				card = sub([char.description, char.personality, char.scenario]
					.map((p) => String(p ?? "").trim())
					.filter(Boolean)
					.join("\n")).trim();
			}
		}
		if (card) sections.push(`### Persona description\n${card}`);

		// User persona -> "### Player character: <name>".
		const fields = ctx.getCharacterCardFields?.();
		const persona = sub(fields?.persona ?? "").trim();
		if (persona) {
			const userName = sub("{{user}}").trim() || "User";
			sections.push(`### Player character: ${userName}\n${persona}`);
		}
	} catch (e) {
		warn("Failed to build director system prompt:", e?.message);
	}

	return sections.join("\n\n").trim();
}

// Strip tracker/director blocks out of message text before feeding history to the director.
const BLOCK_RE = /<(?:tracker|director)>[\s\S]*?<\/(?:tracker|director)>/gi;

/** Builds the recent chat history as chat-completion messages (oldest -> newest). */
function buildHistory(mesNum) {
	const n = Math.max(1, extensionSettings.numberOfMessages || 10);
	return chat
		.filter((c, index) => !c.is_system && index <= mesNum)
		.slice(-n)
		.map((c) => ({
			role: c.is_user ? "user" : "assistant",
			content: String(c.mes || "").replace(BLOCK_RE, "").trim(),
		}))
		.filter((m) => m.content);
}

/**
 * Scans the recent chat for active World Info / lorebook entries (dry run, emits no events) so the
 * director sees the same lore the roleplay does. Returns "" if unavailable.
 */
async function getActiveWorldInfo(ctx, mesNum) {
	try {
		if (typeof ctx.getWorldInfoPrompt !== "function") return "";
		const n = Math.max(1, extensionSettings.numberOfMessages || 10);
		const messages = chat
			.filter((c, index) => !c.is_system && index <= mesNum)
			.slice(-n)
			.map((c) => `${c.name}: ${String(c.mes || "").replace(BLOCK_RE, "").trim()}`);
		if (messages.length === 0) return "";
		const chatForWI = messages.slice().reverse(); // getWorldInfoPrompt expects most-recent-first
		const maxContext = Number(ctx.maxContext) || 8192;
		const { worldInfoString } = await ctx.getWorldInfoPrompt(chatForWI, maxContext, true);
		return String(worldInfoString || "").trim();
	} catch (e) {
		warn("Failed to gather world info for director:", e?.message);
		return "";
	}
}

/**
 * Builds the full director chat-completion message array (Option A): system prompt (character +
 * active World Info) + recent history + the director instruction appended as its own message.
 * The instruction uses `directorRole` (default "assistant") so it is NOT merged into the last
 * user message by chat-completion post-processing.
 */
async function buildDirectorMessages(ctx, mesNum) {
	const messages = [];

	const systemParts = [];
	const charSystem = buildDirectorSystemPrompt(ctx);
	if (charSystem) systemParts.push(charSystem);
	const worldInfo = await getActiveWorldInfo(ctx, mesNum);
	if (worldInfo) systemParts.push(`### World Info\n${worldInfo}`);
	if (systemParts.length) messages.push({ role: "system", content: systemParts.join("\n\n") });

	messages.push(...buildHistory(mesNum));

	const directorRole = extensionSettings.directorRole || "assistant";
	messages.push({ role: directorRole, content: String(extensionSettings.directorPrompt || "").trim() });
	return messages;
}

/** Sends the director request via the configured profile + completion preset. */
async function sendDirectorRequest(ctx, messages) {
	const profileId = getProfileIdByName(ctx, extensionSettings.selectedProfile);
	if (!profileId) throw new Error(`Director connection profile not found: ${extensionSettings.selectedProfile}`);
	if (!ctx.ConnectionManagerRequestService) throw new Error("ConnectionManagerRequestService not available");

	// "current" => use the profile's own preset. Any other value => temporarily point the profile at
	// the chosen preset for this one request (core derives presetName from profile.preset).
	const usePreset = extensionSettings.selectedCompletionPreset && extensionSettings.selectedCompletionPreset !== "current";
	let overriddenProfile = null;
	let originalPreset;
	try {
		const profile = ctx.ConnectionManagerRequestService.getProfile(profileId);
		if (usePreset) {
			overriddenProfile = profile;
			originalPreset = profile.preset;
			profile.preset = extensionSettings.selectedCompletionPreset;
		}

		const effectivePresetName = usePreset ? extensionSettings.selectedCompletionPreset : profile.preset;
		let maxTokens = extensionSettings.responseLength > 0
			? extensionSettings.responseLength
			: resolvePresetMaxTokens(ctx, profile, effectivePresetName);
		if (!maxTokens) maxTokens = 1024;

		debug("Director request", { profileId, maxTokens, preset: effectivePresetName, messages });
		const response = await ctx.ConnectionManagerRequestService.sendRequest(
			profileId,
			messages,
			maxTokens,
			{ extractData: true, includePreset: true }
		);
		return response?.content ?? "";
	} finally {
		if (overriddenProfile) overriddenProfile.preset = originalPreset;
	}
}

/**
 * Generates the director outline using the configured director model.
 * @param {number} mesNum - The message index providing the context window.
 * @returns {Promise<string>} The outline text (may be empty).
 */
export async function generateDirectorOutline(mesNum) {
	const ctx = getContext();
	const messages = await buildDirectorMessages(ctx, mesNum);
	const outline = await sendDirectorRequest(ctx, messages);
	return String(outline || "").trim();
}
