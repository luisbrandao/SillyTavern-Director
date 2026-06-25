import { saveSettingsDebounced } from "../../../../../../script.js";
import { getContext } from "../../../../../../scripts/extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../../scripts/popup.js";

import { extensionSettings, extensionFolderPath } from "../../index.js";
import { defaultSettings } from "./defaultSettings.js";
import { loadBuiltinPromptProfiles, DEFAULT_PROFILE_NAME } from "./promptLoader.js";
import { debug, error } from "../../lib/utils.js";

/**
 * Resolves a connection profile object by name. "current" resolves to the active profile.
 * @param {object} ctx - SillyTavern context.
 * @param {string} name - Profile name or "current".
 * @returns {object|null}
 */
export function resolveProfile(ctx, name) {
	const cm = ctx?.extensionSettings?.connectionManager;
	if (!cm || !Array.isArray(cm.profiles)) return null;
	if (name === "current") return cm.profiles.find((p) => p.id === cm.selectedProfile) ?? null;
	return cm.profiles.find((p) => p.name === name) ?? null;
}

/**
 * Initializes settings: loads the built-in director prompts (prompts/*.txt), merges defaults for
 * missing keys, seeds the built-in prompt profiles, and loads the settings UI.
 */
export async function initSettings() {
	const builtins = await loadBuiltinPromptProfiles();

	// prompts/Default.txt is the source of truth for the default director prompt — patch it over the
	// (short fallback) default BEFORE merging, so fresh installs and reset-to-defaults both use it.
	const builtinDefault = builtins.find((p) => p.name === DEFAULT_PROFILE_NAME);
	if (builtinDefault) defaultSettings.directorPrompt = builtinDefault.prompt;

	for (const [key, value] of Object.entries(defaultSettings)) {
		if (extensionSettings[key] === undefined) {
			extensionSettings[key] = structuredClone(value);
		}
	}
	seedBuiltinPromptProfiles(builtins);
	saveSettingsDebounced();
	await loadSettingsUI();
}

/**
 * Seeds the built-in prompts into the user's prompt profiles. Each built-in is seeded exactly ONCE
 * (tracked by name in `seededPromptProfiles`): the profiles are ordinary user-editable entries
 * afterwards, and a rename/delete must not be undone by the next reload. A user profile that
 * already uses a built-in name is never overwritten.
 */
function seedBuiltinPromptProfiles(builtins) {
	if (!Array.isArray(extensionSettings.promptProfiles)) extensionSettings.promptProfiles = [];
	if (!Array.isArray(extensionSettings.seededPromptProfiles)) extensionSettings.seededPromptProfiles = [];
	for (const builtin of builtins) {
		if (extensionSettings.seededPromptProfiles.includes(builtin.name)) continue;
		extensionSettings.seededPromptProfiles.push(builtin.name);
		if (extensionSettings.promptProfiles.some((p) => p?.name === builtin.name)) continue;
		extensionSettings.promptProfiles.push({ name: builtin.name, prompt: builtin.prompt });
		debug("Seeded built-in director prompt profile", builtin.name);
	}
}

async function loadSettingsUI() {
	try {
		debug("Loading settings UI from", `${extensionFolderPath}/html/settings.html`);
		const html = await $.get(`${extensionFolderPath}/html/settings.html`);
		$("#extensions_settings2").append(html);
		setInitialValues();
		registerListeners();
		debug("Settings UI loaded");
	} catch (e) {
		// Don't name this `error` — it would shadow the imported logger.
		error("Failed to load settings UI:", e);
	}
}

function setInitialValues() {
	$("#director_enabled").prop("checked", !!extensionSettings.enabled);
	$("#director_prompt").val(extensionSettings.directorPrompt ?? "");
	$("#director_prompt_role").val(extensionSettings.directorRole ?? "user");
	$("#director_character_override").val(extensionSettings.characterContextOverride ?? "");
	$("#director_response_length").val(extensionSettings.responseLength ?? 0);
	$("#director_injection_depth").val(extensionSettings.injectionDepth ?? 0);
	$("#director_injection_role").val(extensionSettings.injectionRole ?? "system");
	$("#director_injection_template").val(extensionSettings.injectionTemplate ?? "");
	$("#director_context_size").val(extensionSettings.contextSize ?? 0);
	$("#director_previous_outlines").val(extensionSettings.previousOutlines ?? 0);
	populateConnectionProfiles();
	populateCompletionPresets();
	populatePromptProfiles();
}

function populatePromptProfiles() {
	const select = $("#director_prompt_profile");
	select.empty();
	select.append($("<option>").val("").text("— no profile (free-form) —"));
	const profiles = Array.isArray(extensionSettings.promptProfiles) ? extensionSettings.promptProfiles : [];
	for (const p of profiles) {
		if (p?.name) select.append($("<option>").val(p.name).text(p.name));
	}
	// Drop a stale selection (e.g. the profile was deleted) instead of silently showing the wrong one.
	const active = String(extensionSettings.activePromptProfile ?? "");
	if (active && !profiles.some((p) => p?.name === active)) {
		extensionSettings.activePromptProfile = "";
	}
	select.val(extensionSettings.activePromptProfile ?? "");
}

function getActivePromptProfile() {
	const name = String(extensionSettings.activePromptProfile ?? "");
	if (!name) return null;
	return (extensionSettings.promptProfiles ?? []).find((p) => p?.name === name) ?? null;
}

/** @returns {string[]} The saved prompt-profile names (for populating quick-access dropdowns). */
export function listPromptProfileNames() {
	return (extensionSettings.promptProfiles ?? []).map((p) => p?.name).filter(Boolean);
}

/** @returns {string} The active prompt-profile name, or "" for free-form. */
export function getActivePromptProfileName() {
	return String(extensionSettings.activePromptProfile ?? "");
}

/**
 * Switches the active prompt profile and loads its prompt into the effective director prompt. The
 * single source of truth for selecting a profile — both the settings panel and the interface's
 * quick-access dropdown call this, so every known widget is kept in sync here. Selecting "" (free-form)
 * keeps the current prompt text. Saves settings.
 * @param {string} name
 */
export function applyActivePromptProfile(name) {
	extensionSettings.activePromptProfile = String(name ?? "");
	const profile = getActivePromptProfile();
	if (profile) extensionSettings.directorPrompt = String(profile.prompt ?? "");
	// Keep every widget that mirrors this state in sync (settings panel + interface dropdown), if present.
	$("#director_prompt").val(extensionSettings.directorPrompt ?? "");
	$("#director_prompt_profile").val(extensionSettings.activePromptProfile ?? "");
	$("#directorInterfaceProfileSelect").val(extensionSettings.activePromptProfile ?? "");
	saveSettingsDebounced();
}

/** Prompts for a profile name; returns a trimmed, unique name or null if cancelled/invalid. */
async function askPromptProfileName(title, initial = "") {
	const input = await callGenericPopup(title, POPUP_TYPE.INPUT, initial);
	if (input === null || input === false) return null;
	const name = String(input).trim();
	if (!name) return null;
	if ((extensionSettings.promptProfiles ?? []).some((p) => p?.name === name)) {
		window.toastr?.error?.(`A director prompt profile named "${name}" already exists.`);
		return null;
	}
	return name;
}

function populateConnectionProfiles() {
	const select = $("#director_connection_profile");
	select.empty();
	select.append($("<option>").val("current").text("Use current connection"));
	try {
		const ctx = getContext();
		const profiles = ctx?.extensionSettings?.connectionManager?.profiles ?? [];
		for (const p of profiles) {
			if (p?.name) select.append($("<option>").val(p.name).text(p.name));
		}
	} catch (e) {
		error("Failed to load connection profiles:", e);
	}
	select.val(extensionSettings.selectedProfile);
}

function populateCompletionPresets() {
	const select = $("#director_completion_preset");
	select.empty();
	select.append($("<option>").val("current").text("Use connection profile default"));
	try {
		const ctx = getContext();
		const profile = resolveProfile(ctx, extensionSettings.selectedProfile);
		const apiId = profile?.mode === "cc" ? "openai" : "textgenerationwebui";
		const presetManager = ctx.getPresetManager(apiId);
		const names = presetManager?.getPresetList?.()?.preset_names ?? [];
		const list = Array.isArray(names) ? names : Object.keys(names);
		for (const name of list) {
			select.append($("<option>").val(name).text(name));
		}
	} catch (e) {
		error("Failed to load completion presets:", e);
	}
	select.val(extensionSettings.selectedCompletionPreset);
}

function registerListeners() {
	$("#director_enabled").on("change", function () {
		extensionSettings.enabled = $(this).prop("checked");
		saveSettingsDebounced();
	});
	$("#director_prompt").on("input", function () {
		extensionSettings.directorPrompt = String($(this).val());
		// While a profile is selected the editor is bound to it — keep the profile copy in sync.
		const profile = getActivePromptProfile();
		if (profile) profile.prompt = extensionSettings.directorPrompt;
		saveSettingsDebounced();
	});
	$("#director_prompt_profile").on("change", function () {
		applyActivePromptProfile(String($(this).val()));
	});
	$("#director_prompt_profile_new").on("click", async function () {
		const name = await askPromptProfileName("Name for the new director prompt profile:");
		if (!name) return;
		if (!Array.isArray(extensionSettings.promptProfiles)) extensionSettings.promptProfiles = [];
		extensionSettings.promptProfiles.push({ name, prompt: String(extensionSettings.directorPrompt ?? "") });
		extensionSettings.activePromptProfile = name;
		populatePromptProfiles();
		saveSettingsDebounced();
		window.toastr?.success?.(`Director prompt profile "${name}" created.`);
	});
	$("#director_prompt_profile_rename").on("click", async function () {
		const profile = getActivePromptProfile();
		if (!profile) {
			window.toastr?.info?.("Select a director prompt profile to rename.");
			return;
		}
		const name = await askPromptProfileName("New name for the profile:", profile.name);
		if (!name) return;
		profile.name = name;
		extensionSettings.activePromptProfile = name;
		populatePromptProfiles();
		saveSettingsDebounced();
	});
	$("#director_prompt_profile_delete").on("click", async function () {
		const profile = getActivePromptProfile();
		if (!profile) {
			window.toastr?.info?.("Select a director prompt profile to delete.");
			return;
		}
		const confirmed = await callGenericPopup(`Delete director prompt profile "${profile.name}"? The current prompt text stays in the editor.`, POPUP_TYPE.CONFIRM);
		if (!confirmed) return;
		extensionSettings.promptProfiles = (extensionSettings.promptProfiles ?? []).filter((p) => p !== profile);
		extensionSettings.activePromptProfile = "";
		populatePromptProfiles();
		saveSettingsDebounced();
	});
	$("#director_prompt_role").on("change", function () {
		extensionSettings.directorRole = String($(this).val());
		saveSettingsDebounced();
	});
	$("#director_character_override").on("input", function () {
		extensionSettings.characterContextOverride = String($(this).val());
		saveSettingsDebounced();
	});
	$("#director_connection_profile").on("change", function () {
		extensionSettings.selectedProfile = String($(this).val());
		extensionSettings.selectedCompletionPreset = "current";
		populateCompletionPresets();
		saveSettingsDebounced();
	});
	$("#director_completion_preset").on("change", function () {
		extensionSettings.selectedCompletionPreset = String($(this).val());
		saveSettingsDebounced();
	});
	$("#director_response_length").on("input", function () {
		extensionSettings.responseLength = Math.max(0, Number($(this).val()) || 0);
		saveSettingsDebounced();
	});
	$("#director_context_size").on("input", function () {
		extensionSettings.contextSize = Math.max(0, Number($(this).val()) || 0);
		saveSettingsDebounced();
	});
	$("#director_previous_outlines").on("input", function () {
		extensionSettings.previousOutlines = Math.max(0, Number($(this).val()) || 0);
		saveSettingsDebounced();
	});
	$("#director_injection_depth").on("input", function () {
		extensionSettings.injectionDepth = Math.max(0, Number($(this).val()) || 0);
		saveSettingsDebounced();
	});
	$("#director_injection_role").on("change", function () {
		extensionSettings.injectionRole = String($(this).val());
		saveSettingsDebounced();
	});
	$("#director_injection_template").on("input", function () {
		extensionSettings.injectionTemplate = String($(this).val());
		saveSettingsDebounced();
	});
	$("#director_reset_defaults").on("click", resetToDefaults);
}

/**
 * Resets the director settings to defaults, preserving the connection profile + preset (the
 * environment-specific model choice), then re-renders the UI.
 */
async function resetToDefaults() {
	const confirmed = await callGenericPopup("Reset Director settings to defaults? (keeps the connection profile, preset, and saved prompt profiles)", POPUP_TYPE.CONFIRM);
	if (!confirmed) return;

	const preserved = {
		selectedProfile: extensionSettings.selectedProfile,
		selectedCompletionPreset: extensionSettings.selectedCompletionPreset,
		// Saved prompt profiles are user-authored content; keep them. The active selection clears to
		// free-form, though — the prompt editor now holds the default text, not the profile's.
		promptProfiles: extensionSettings.promptProfiles,
		// Keep the seed bookkeeping too, or the next reload would resurrect deleted built-ins.
		seededPromptProfiles: extensionSettings.seededPromptProfiles,
	};
	for (const [key, value] of Object.entries(defaultSettings)) {
		extensionSettings[key] = structuredClone(value);
	}
	Object.assign(extensionSettings, preserved);

	saveSettingsDebounced();
	setInitialValues();
	window.toastr?.success?.("Director settings reset to defaults.");
}

/** @returns {boolean} Whether the director is enabled. */
export function isEnabled() {
	return !!extensionSettings.enabled;
}

/**
 * Enables/disables the director and syncs the toggle.
 * @param {boolean} enabled
 */
export async function toggleExtension(enabled) {
	extensionSettings.enabled = !!enabled;
	$("#director_enabled").prop("checked", extensionSettings.enabled);
	saveSettingsDebounced();
}
