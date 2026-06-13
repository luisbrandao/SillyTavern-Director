import { chat, deactivateSendButtons, activateSendButtons, extension_prompt_types } from "../../../../../script.js";
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
// Core Author's Note module key in extensionPrompts (authors-note.js MODULE_NAME).
const AUTHORS_NOTE_KEY = "2_floating_prompt";

/**
 * Restores the send/stop buttons after the director's transient "busy" state WITHOUT emitting
 * GENERATION_ENDED.
 *
 * Core's activateSendButtons() calls hideStopButton(), which emits GENERATION_ENDED whenever it
 * hides a *visible* stop button. The director generates at GENERATION_AFTER_COMMANDS — while a host
 * generation is still in flight and before core has shown its own stop button — so that spurious
 * GENERATION_ENDED would fire mid-generation and flush other extensions' ephemeral injects (e.g.
 * Guided Generations' `/inject ... ephemeral=true`), wiping their instructions out of the prompt.
 * Pre-hiding the stop button makes hideStopButton()'s visibility guard a no-op, so activateSendButtons()
 * still runs its remaining UI cleanup but emits no event. (See AGENTS.md "CRITICAL gotcha".)
 */
function restoreSendButtons() {
	$("#mes_stop").css("display", "none");
	activateSendButtons();
}

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

	debug("Director connection resolved", {
		selectedProfile: extensionSettings.selectedProfile,
		selectedCompletionPreset: extensionSettings.selectedCompletionPreset,
		resolvedProfileId: profileId,
		profileName: profile?.name,
		profileApi: profile?.api,
		profileMode: profile?.mode,
		profileDefaultPreset: profile?.preset,
		usePreset,
		presetNameUsed: presetName,
		responseLengthSetting: extensionSettings.responseLength,
		responseTokens,
		contextSizeOverride: sizeOverride,
		contextSize,
	});

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
 * Builds the director system prompt as labeled sections, always in this order:
 *   ### Author's Note          (only when positioned "before scenario")
 *   ### Persona description    (character context override, else the character card)
 *   ### Player character: <name>   (always shown; persona description if present)
 *   ### Author's Note          (only when positioned "after scenario")
 *   ### World Info             (active lorebook entries, if any)
 *   ### Summary                (running story summary from Summarize, if any)
 * An in-chat positioned Author's Note is not handled here — buildDirectorMessages splices it into
 * the message history at its configured depth instead.
 * Macros like {{user}} / {{char}} are resolved via substituteParams; stray carriage returns stripped.
 */
async function buildDirectorSystemPrompt(ctx, mesNum, contextSize, authorsNote) {
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

	// "### Author's Note" -> placed per its configured position: "before scenario" ahead of the
	// persona sections, "after scenario" right after them. In-chat placement is the caller's job.
	if (authorsNote) {
		const noteSection = `### Author's Note\n${authorsNote.text}`;
		if (authorsNote.position === extension_prompt_types.BEFORE_PROMPT) sections.unshift(noteSection);
		else if (authorsNote.position === extension_prompt_types.IN_PROMPT) sections.push(noteSection);
	}

	// "### World Info" -> active lorebook entries (kept here so the section order is guaranteed).
	try {
		const worldInfo = await getActiveWorldInfo(ctx, mesNum, contextSize);
		if (worldInfo) sections.push(`### World Info\n${worldInfo}`);
	} catch (e) {
		warn("Failed to add world info:", e?.message);
	}

	// "### Summary" -> the running story summary (built-in Summarize extension), if one exists. Placed
	// last so it directly precedes the recent message history — the natural "story so far" lead-in. On
	// long RPs this carries world state that has scrolled out of the recent-message window.
	try {
		const summary = sub(getRunningSummary(ctx, mesNum)).trim();
		if (summary) sections.push(`### Summary\n${summary}`);
	} catch (e) {
		warn("Failed to add summary:", e?.message);
	}

	return sections.join("\n\n").trim();
}

/**
 * Returns the running story summary at the director's context point, or "" if none.
 *
 * Supports two storage formats for `message.extra.memory`:
 *   - Built-in Summarize: plain string.
 *   - Tech-Summarize: object {characters, body, lore} — sections are joined with blank lines.
 *
 * Scan order: backward through chat up to mesNum (tied to the exact context point), then fall
 * back to the live extension-prompt value for setups that don't persist per-message
 * (checks 'tech_summarize' before '1_memory').
 */
function getRunningSummary(ctx, mesNum) {
	function extractMemory(mem) {
		if (!mem) return "";
		if (typeof mem === "string") return mem.trim();
		if (typeof mem === "object") {
			return ["characters", "body", "lore"]
				.map((k) => String(mem[k] ?? "").trim())
				.filter(Boolean)
				.join("\n\n");
		}
		return "";
	}
	try {
		const end = Math.min(Number(mesNum), chat.length - 1);
		for (let i = end; i >= 0; i--) {
			const text = extractMemory(chat[i]?.extra?.memory);
			if (text) return text;
		}
		for (const key of ["tech_summarize", "1_memory"]) {
			const live = ctx.extensionPrompts?.[key]?.value;
			if (live && String(live).trim()) return String(live).trim();
		}
	} catch (e) {
		warn("Failed to read running summary:", e?.message);
	}
	return "";
}

/**
 * Reads the live Author's Note from core's extension prompt entry, or null if none is active.
 *
 * Core's setFloatingPrompt() keeps this entry up to date (chat changes, AN edits) and already
 * resolves everything "as configured": the character note merge, the insertion-interval gating
 * (value is "" on off-interval turns), and the position/depth/role the user picked. Values are
 * stored raw, so macros are substituted here.
 */
function getAuthorsNote(ctx) {
	try {
		const entry = ctx.extensionPrompts?.[AUTHORS_NOTE_KEY];
		const raw = String(entry?.value ?? "").trim();
		if (!raw) return null;
		const substituted = typeof ctx.substituteParams === "function" ? String(ctx.substituteParams(raw)) : raw;
		const text = substituted.replace(/\r/g, "").trim();
		if (!text) return null;
		const roleNames = { 0: "system", 1: "user", 2: "assistant" };
		return {
			text,
			position: Number(entry.position ?? extension_prompt_types.IN_CHAT),
			depth: Math.max(0, Number(entry.depth) || 0),
			role: roleNames[Number(entry.role)] || "system",
		};
	} catch (e) {
		warn("Failed to read author's note:", e?.message);
		return null;
	}
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
 * When `previousOutlines` > 0, the last N stored director outlines are interleaved into the
 * history as system messages (each right before the bot message it directed) so the director
 * works in coherence with its own past decisions.
 * The instruction uses `directorRole` (default "user") so the array ends on a user turn — standard
 * chat-completion backends add a generation prompt, so a trailing "assistant" message would render as
 * a completed turn and the model would emit an end token immediately (dies after 1 token).
 */
async function buildDirectorMessages(ctx, mesNum, conn, pendingUserText = "") {
	const authorsNote = getAuthorsNote(ctx);
	const system = await buildDirectorSystemPrompt(ctx, mesNum, conn.contextSize, authorsNote);
	const directorRole = extensionSettings.directorRole || "user";
	// Resolve {{user}} / {{char}} (etc.) in the director instruction — it's sent to the director model
	// directly, so SillyTavern won't substitute it for us.
	const rawPrompt = String(extensionSettings.directorPrompt || "").trim();
	const promptContent = typeof ctx.substituteParams === "function" ? String(ctx.substituteParams(rawPrompt)) : rawPrompt;
	const instruction = { role: directorRole, content: promptContent };
	// The user's just-sent message isn't in the chat yet at GENERATION_AFTER_COMMANDS time; it's
	// passed in so the director directs based on it. Added as the final user turn before the instruction.
	const pending = String(pendingUserText || "").trim();

	// An in-chat Author's Note becomes its own history message; budget it up front (prompt-positioned
	// notes are already inside `system` and counted there).
	const inChatNote = authorsNote && authorsNote.position === extension_prompt_types.IN_CHAT
		? { role: authorsNote.role, content: authorsNote.text }
		: null;

	const budget = Math.max(0, conn.contextSize - conn.responseTokens - CONTEXT_SAFETY_MARGIN);
	let used = 0;
	if (system) used += await countTokens(ctx, system);
	used += (await countTokens(ctx, instruction.content)) + PER_MESSAGE_OVERHEAD;
	if (pending) used += (await countTokens(ctx, pending)) + PER_MESSAGE_OVERHEAD;
	if (inChatNote) used += (await countTokens(ctx, inChatNote.content)) + PER_MESSAGE_OVERHEAD;

	const source = chat
		.map((c, index) => ({ c, index }))
		.filter(({ c, index }) => !c.is_system && index <= mesNum);

	// The last N messages carrying a stored director outline (chat[i].director) get that outline
	// interleaved as a system message right before them, so the director sees its own recent
	// decisions and can stay coherent with them. previousOutlines = 0 disables this.
	const outlineLimit = Math.max(0, Number(extensionSettings.previousOutlines) || 0);
	const outlineIndexes = new Set(
		outlineLimit > 0
			? source
				.filter(({ c }) => String(c.director ?? "").trim())
				.slice(-outlineLimit)
				.map(({ index }) => index)
			: []
	);

	const history = [];
	let outlinesIncluded = 0;
	for (const { c, index } of source) {
		const content = String(c.mes || "").replace(BLOCK_RE, "").trim();
		if (!content) continue;
		if (outlineIndexes.has(index)) {
			history.push({ role: "system", content: `<director>\nScene direction previously given by the director for the following message:\n\n${String(c.director).trim()}\n</director>` });
			outlinesIncluded++;
		}
		history.push({ role: c.is_user ? "user" : "assistant", content });
	}

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
		previousOutlinesLimit: outlineLimit,
		previousOutlinesInterleaved: outlinesIncluded,
		hasPendingUserMessage: !!pending,
		authorsNote: authorsNote ? { position: authorsNote.position, depth: authorsNote.depth, role: authorsNote.role } : null,
	});

	const messages = [];
	if (system) messages.push({ role: "system", content: system });
	messages.push(...included);
	if (pending) messages.push({ role: "user", content: pending });
	// In-chat Author's Note: configured depth counts story messages from the end (0 = after the
	// newest), mirroring core's doChatInject. Clamped to stay below the system message; inserted
	// before the instruction so the director's ask always comes last.
	if (inChatNote) {
		const floor = system ? 1 : 0;
		messages.splice(Math.max(floor, messages.length - authorsNote.depth), 0, inChatNote);
	}
	messages.push(instruction);
	return messages;
}

/** Sends the director request via the configured profile + completion preset (non-streaming). */
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

		// Non-streaming: the outline isn't shown live (the user never sees it stream), and a single
		// response is marginally faster. With stream:false, sendRequest returns ExtractedData (.content).
		// (Historically a remote proxy returned a compressed body that ST couldn't decode here; that was
		// a proxy-side bug, since fixed — not something to work around by forcing streaming.)
		const response = await ctx.ConnectionManagerRequestService.sendRequest(
			conn.profileId,
			messages,
			maxTokens,
			{ stream: false, extractData: true, includePreset: true }
		);

		// stream:false -> ExtractedData with .content. Guard the streaming shape too, in case a backend
		// ignores the flag and hands back a generator factory yielding cumulative { text }.
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
export async function generateDirectorOutline(mesNum, pendingUserText = "") {
	// Hide the send button so the user can't fire a second generation while the director is working.
	// Only manage the buttons if no one else is currently showing the stop button (stop hidden ===
	// true): during the GENERATION_AFTER_COMMANDS intercept the host generation hasn't shown its own
	// stop button yet, while a manual regenerate has none at all — both cases are ours to manage. If
	// the stop button is already visible (some other flow owns it), leave it untouched.
	const manageStopButton = $("#mes_stop").css("display") === "none";
	if (manageStopButton) deactivateSendButtons();
	try {
		const ctx = getContext();
		const conn = resolveDirectorConnection(ctx);
		const messages = await buildDirectorMessages(ctx, mesNum, conn, pendingUserText);
		const outline = await sendDirectorRequest(ctx, conn, messages);
		return String(outline || "").trim();
	} finally {
		if (manageStopButton) restoreSendButtons();
	}
}
