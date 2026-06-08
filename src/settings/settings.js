import { saveSettingsDebounced } from "../../../../../../script.js";
import { getContext } from "../../../../../../scripts/extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../../scripts/popup.js";

import { extensionSettings, extensionFolderPath } from "../../index.js";
import { defaultSettings } from "./defaultSettings.js";
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
 * Initializes settings: merges defaults for missing keys and loads the settings UI.
 */
export async function initSettings() {
	for (const [key, value] of Object.entries(defaultSettings)) {
		if (extensionSettings[key] === undefined) {
			extensionSettings[key] = structuredClone(value);
		}
	}
	saveSettingsDebounced();
	await loadSettingsUI();
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
	$("#director_prompt_role").val(extensionSettings.directorRole ?? "assistant");
	$("#director_response_length").val(extensionSettings.responseLength ?? 0);
	$("#director_injection_depth").val(extensionSettings.injectionDepth ?? 0);
	$("#director_injection_role").val(extensionSettings.injectionRole ?? "system");
	$("#director_injection_template").val(extensionSettings.injectionTemplate ?? "");
	$("#director_number_of_messages").val(extensionSettings.numberOfMessages ?? 10);
	populateConnectionProfiles();
	populateCompletionPresets();
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
		saveSettingsDebounced();
	});
	$("#director_prompt_role").on("change", function () {
		extensionSettings.directorRole = String($(this).val());
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
	$("#director_number_of_messages").on("input", function () {
		extensionSettings.numberOfMessages = Math.max(1, Number($(this).val()) || 1);
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
	const confirmed = await callGenericPopup("Reset Director settings to defaults? (keeps the connection profile and preset)", POPUP_TYPE.CONFIRM);
	if (!confirmed) return;

	const preserved = {
		selectedProfile: extensionSettings.selectedProfile,
		selectedCompletionPreset: extensionSettings.selectedCompletionPreset,
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
