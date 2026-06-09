import { chat } from "../../../../../script.js";
import { getContext } from "../../../../../scripts/extensions.js";
import { extensionSettings } from "../index.js";
import { debug, warn } from "../lib/utils.js";

// Strip tracker/director blocks out of message text before feeding history to the director.
const BLOCK_RE = /<(?:tracker|director)>[\s\S]*?<\/(?:tracker|director)>/gi;
// Tokens kept free on top of the reserved response so we never butt right up against the limit.
const CONTEXT_SAFETY_MARGIN = 256;
// Rough per-message token overhead (role wrapper) when budgeting history.
const PER_MESSAGE_OVERHEAD = 4;
// Cap on how many recent messages are scanned for World Info activation (perf guard).
const WORLD_INFO_SCAN_CAP = 100;

/**
 * Resolves a connection profile id by name. "current" => the active profile.
 */
function getProfileIdByName(ctx, name) {
	const cm = ctx?.extensionSettings?.connectionManager;
	if (!cm) return null;
	if (name === "current") return cm.selectedProfile;
	const p = cm.profiles?.find((x) => x.name === name);
	return p ? p.id : null;
}

/** Max output tokens a completion preset defines (openai_max_tokens for CC, genamt for textgen). */
function resolvePresetMaxTokens(ctx, profile, presetName) {
	if (!presetName) return null;
	try {
		const isCc = profile?.mode === "cc";
		const preset = ctx.getPresetManager(isCc ? "openai" : "textgenerationwebui")?.getCompletionPresetByName?.(presetName);
		if (!preset) return null;
		const max = isCc ? preset.openai_max_tokens : preset.genamt;
		return typeof max === "number" && max > 0 ? max : null;
	} catch (e) {
		warn("Could not resolve preset max tokens:", e?.message);
		return null;
	}
}

/** Context size a completion preset defines (openai_max_context for CC, max_context for textgen). */
function resolvePresetMaxContext(ctx, profile, presetName) {
	if (!presetName) return null;
	try {
		const isCc = profile?.mode === "cc";
		const preset = ctx.getPresetManager(isCc ? "openai" : "textgenerationwebui")?.getCompletionPresetByName?.(presetName);
		if (!preset) return null;
		const size = isCc ? preset.openai_max_context : preset.max_context;
		return typeof size === "number" && size > 0 ? size : null;
	} catch (e) {
		warn("Could not resolve preset max context:", e?.message);
		return null;
	}
}

/**
 * Resolves the director's connection: profile, preset, and the token budgets used to compose the
 * prompt — the response reservation and the total context size (preset's value, or an explicit
 * override, falling back to the app's current max context).
 */
function resolveDirectorConnection(ctx) {
	const profileId = getProfileIdByName(ctx, extensionSettings.selectedProfile);
	if (!profileId) throw new Error(`Director connection profile not found: ${extensionSettings.selectedProfile}`);

	let profile = null;
	try {
		profile = ctx.ConnectionManagerRequestService?.getProfile?.(profileId) ?? null;
	} catch (e) {
		profile = null;
	}

	const usePreset = extensionSettings.selectedCompletionPreset && extensionSettings.selectedCompletionPreset !== "current";
	const presetName = usePreset ? extensionSettings.selectedCompletionPreset : profile?.preset;

	const responseTokens = extensionSettings.responseLength > 0
		? Number(extensionSettings.responseLength)
		: (resolvePresetMaxTokens(ctx, profile, presetName) || 1024);

	const sizeOverride = Number(extensionSettings.contextSize) || 0;
	const contextSize = sizeOverride > 0
		? sizeOverride
		: (resolvePresetMaxContext(ctx, profile, presetName) || Number(ctx.maxContext) || 8192);

	return { profileId, profile, presetName, usePreset, responseTokens, contextSize };
}

/** Counts tokens for a string (async when available) with a ~4 chars/token fallback. */
async function countTokens(ctx, text) {
	const s = String(text || "");
	try {
		if (typeof ctx.getTokenCountAsync === "function") return await ctx.getTokenCountAsync(s);
		if (typeof ctx.getTokenCount === "function") return ctx.getTokenCount(s);
	} catch (e) {
		warn("Token count failed, using heuristic:", e?.message);
	}
	return Math.ceil(s.length / 4);
}

/**
 * Builds the director system prompt as three labeled sections, always in this order:
 *   ### Persona description    (character context override, else the character card)
 *   ### Player character: <name>   (always shown; persona description if present)
 *   ### World Info             (active lorebook entries, if any)
 * Macros like {{user}} / {{char}} are resolved via substituteParams; stray carriage returns stripped.
 */
async function buildDirectorSystemPrompt(ctx, mesNum, contextSize) {
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

		// "### Player character: <name>" -> always shown; include the persona description if present.
		const userName = sub("{{user}}").trim() || "User";
		const fields = ctx.getCharacterCardFields?.();
		const persona = sub(fields?.persona ?? "").trim();
		sections.push(`### Player character: ${userName}${persona ? `\n${persona}` : ""}`);
	} catch (e) {
		warn("Failed to build director system prompt:", e?.message);
	}

	// "### World Info" -> active lorebook entries (kept here so the section order is guaranteed).
	try {
		const worldInfo = await getActiveWorldInfo(ctx, mesNum, contextSize);
		if (worldInfo) sections.push(`### World Info\n${worldInfo}`);
	} catch (e) {
		warn("Failed to add world info:", e?.message);
	}

	return sections.join("\n\n").trim();
}

/**
 * Scans recent chat for active World Info / lorebook entries (dry run, emits no events) so the
 * director sees the same lore the roleplay does. Returns "" if unavailable.
 */
async function getActiveWorldInfo(ctx, mesNum, contextSize) {
	try {
		if (typeof ctx.getWorldInfoPrompt !== "function") return "";
		const messages = chat
			.filter((c, index) => !c.is_system && index <= mesNum)
			.slice(-WORLD_INFO_SCAN_CAP)
			.map((c) => `${c.name}: ${String(c.mes || "").replace(BLOCK_RE, "").trim()}`);
		if (messages.length === 0) return "";
		const chatForWI = messages.slice().reverse(); // getWorldInfoPrompt expects most-recent-first
		const maxContext = Number(contextSize) || Number(ctx.maxContext) || 8192;
		const { worldInfoString } = await ctx.getWorldInfoPrompt(chatForWI, maxContext, true);
		return String(worldInfoString || "").trim();
	} catch (e) {
		warn("Failed to gather world info for director:", e?.message);
		return "";
	}
}

/**
 * Builds the director chat-completion message array, composed like a normal ST prompt:
 * system (persona + player + World Info) + as many recent messages as fit the context budget
 * (context size − reserved response − safety margin) + the director instruction appended last.
 * The instruction uses `directorRole` (default "assistant") so chat-completion post-processing
 * doesn't merge it into the last user message.
 */
async function buildDirectorMessages(ctx, mesNum, conn) {
	const system = await buildDirectorSystemPrompt(ctx, mesNum, conn.contextSize);
	const directorRole = extensionSettings.directorRole || "assistant";
	const instruction = { role: directorRole, content: String(extensionSettings.directorPrompt || "").trim() };

	const budget = Math.max(0, conn.contextSize - conn.responseTokens - CONTEXT_SAFETY_MARGIN);
	let used = 0;
	if (system) used += await countTokens(ctx, system);
	used += (await countTokens(ctx, instruction.content)) + PER_MESSAGE_OVERHEAD;

	const history = chat
		.filter((c, index) => !c.is_system && index <= mesNum)
		.map((c) => ({
			role: c.is_user ? "user" : "assistant",
			content: String(c.mes || "").replace(BLOCK_RE, "").trim(),
		}))
		.filter((m) => m.content);

	// Fill from newest backward; always keep the most recent message even if it alone overflows.
	const included = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const m = history[i];
		const cost = (await countTokens(ctx, m.content)) + PER_MESSAGE_OVERHEAD;
		if (included.length > 0 && used + cost > budget) break;
		used += cost;
		included.unshift(m);
	}

	debug("Director context budget", {
		contextSize: conn.contextSize,
		responseTokens: conn.responseTokens,
		budget,
		usedTokens: used,
		includedMessages: included.length,
		totalMessages: history.length,
	});

	const messages = [];
	if (system) messages.push({ role: "system", content: system });
	messages.push(...included);
	messages.push(instruction);
	return messages;
}

/** Sends the director request via the configured profile + completion preset (streamed). */
async function sendDirectorRequest(ctx, conn, messages) {
	if (!ctx.ConnectionManagerRequestService) throw new Error("ConnectionManagerRequestService not available");

	// "current" => use the profile's own preset. Any other value => temporarily point the profile at
	// the chosen preset for this one request (core derives presetName from profile.preset).
	let overriddenProfile = null;
	let originalPreset;
	try {
		const profile = conn.profile ?? ctx.ConnectionManagerRequestService.getProfile(conn.profileId);
		if (conn.usePreset && profile) {
			overriddenProfile = profile;
			originalPreset = profile.preset;
			profile.preset = extensionSettings.selectedCompletionPreset;
		}

		const maxTokens = conn.responseTokens || 1024;
		debug("Director request", { profileId: conn.profileId, maxTokens, preset: conn.presetName, messageCount: messages.length });

		// Stream the request. Non-streaming responses from remote backends can come back compressed
		// (e.g. brotli), which SillyTavern's node-fetch backend doesn't always decode -> garbage ->
		// parse error. Streaming (SSE) responses aren't compressed.
		const response = await ctx.ConnectionManagerRequestService.sendRequest(
			conn.profileId,
			messages,
			maxTokens,
			{ stream: true, extractData: true, includePreset: true }
		);

		// Streaming returns a generator factory yielding cumulative { text }. Non-streaming (fallback)
		// returns extracted data with .content.
		if (typeof response === "function") {
			let text = "";
			for await (const chunk of response()) {
				if (chunk && typeof chunk.text === "string") text = chunk.text;
			}
			return text;
		}
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
	const conn = resolveDirectorConnection(ctx);
	const messages = await buildDirectorMessages(ctx, mesNum, conn);
	const outline = await sendDirectorRequest(ctx, conn, messages);
	return String(outline || "").trim();
}
