import { animation_duration, chat } from "../../../../../../script.js";
import { dragElement } from "../../../../../../scripts/RossAscends-mods.js";
import { loadMovingUIState } from "../../../../../../scripts/power-user.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../../scripts/popup.js";
import { isEnabled, toggleExtension, listPromptProfileNames, getActivePromptProfileName, applyActivePromptProfile } from "../settings/settings.js";
import { getLastNonSystemMessageIndex, getPreviousNonSystemMessageIndex, getNextNonSystemMessageIndex, error } from "../../lib/utils.js";
import { saveDirectorToMessage, regenerateDirectorForMessage, removeDirectorFromMessage } from "../director.js";

/**
 * Director interface: a docked, draggable side panel (built from #zoomed_avatar_template and parked
 * in #movingDivs, same as the Tracker's interface) showing one message's outline in an editable box
 * with Save / Regenerate / Delete and a global on/off toggle. Replaces the old floating popup.
 *
 * Singleton: the constructor returns the existing instance, so the per-message buttons, the inline
 * preview controls, and the magic-wand entry all drive one shared panel.
 */
export class DirectorInterface {
	constructor() {
		if (DirectorInterface.instance) return DirectorInterface.instance;
		DirectorInterface.instance = this;
		this.container = null;
		this.mesId = null;
	}

	/** Builds the panel DOM once, wires its controls, and makes it draggable. */
	createUI() {
		const template = $("#zoomed_avatar_template").html();
		// dragElement() locates the drag handle by id "<containerId>header", so this grabber MUST be
		// named "directorEnhancedInterfaceheader" to match the container id below — don't rename one
		// without the other.
		const controlBarHtml = `<div class="panelControlBar flex-container">
			<div id="directorEnhancedInterfaceheader" class="fa-solid fa-grip drag-grabber hoverglow"></div>
			<div id="directorInterfaceClose" class="fa-solid fa-circle-xmark hoverglow dragClose"></div>
		</div>`;
		// Header bar: prev/next message nav + title + a green/red on-off switch (mirrors the settings
		// checkbox), ported from the Tracker interface. fa-toggle-on (green via .toggleEnabled) ↔ fa-toggle-off.
		const headerBar = `<div id="directorInterfaceHeaderBar" class="flex-container alignItemsCenter">
			<div id="directorInterfaceNav" class="director-nav">
				<i id="directorInterfacePrev" class="fa-solid fa-chevron-left interactable" tabindex="0" title="Previous message"></i>
				<i id="directorInterfaceNext" class="fa-solid fa-chevron-right interactable" tabindex="0" title="Next message"></i>
			</div>
			<div id="directorInterfaceHeader">Director</div>
			<div id="directorInterfaceEnableToggle" class="director-enable-toggle interactable" tabindex="0" title="Enable/disable the Director globally">
				<i class="fa-solid fa-toggle-on"></i>
				<span class="director-enable-label">Enabled</span>
			</div>
		</div>`;
		// Quick-access prompt-profile picker: switches the active director prompt without opening settings.
		const profileBar = `<div id="directorInterfaceProfileBar" class="flex-container alignItemsCenter flexGap5">
			<label for="directorInterfaceProfileSelect">Prompt profile</label>
			<select id="directorInterfaceProfileSelect" class="text_pole flex1"></select>
		</div>`;
		const contents = `<div id="directorInterfaceContents" class="scrollY"></div>`;
		// No Save button — the outline auto-saves as you type.
		const footer = `<div id="directorInterfaceFooter">
			<button id="directorInterfaceRegenerate" class="menu_button menu_button_default interactable" tabindex="0">Regenerate</button>
			<button id="directorInterfaceDelete" class="menu_button menu_button_default interactable" tabindex="0">Delete</button>
		</div>`;

		const el = $(template);
		el.attr("id", "directorEnhancedInterface").removeClass("zoomed_avatar").addClass("draggable").empty();
		el.append(controlBarHtml).append(headerBar).append(profileBar).append(contents).append(footer);
		$("#movingDivs").append(el);

		loadMovingUIState();
		el.css("display", "flex").fadeIn(animation_duration);
		dragElement(el);

		$("#directorInterfaceClose").off("click").on("click", () => this.close());

		this.container = el;
		this.header = el.find("#directorInterfaceHeader");
		this.enableToggle = el.find("#directorInterfaceEnableToggle");
		this.prevButton = el.find("#directorInterfacePrev");
		this.nextButton = el.find("#directorInterfaceNext");
		this.profileSelect = el.find("#directorInterfaceProfileSelect");
		this.contentArea = el.find("#directorInterfaceContents");
		this.regenerateButton = el.find("#directorInterfaceRegenerate");
		this.deleteButton = el.find("#directorInterfaceDelete");

		this.enableToggle.on("click", async () => {
			await toggleExtension(!isEnabled());
			this.updateEnableToggle();
		});
		this.prevButton.on("click", () => this.navigate(-1));
		this.nextButton.on("click", () => this.navigate(1));
		this.profileSelect.on("change", () => applyActivePromptProfile(String(this.profileSelect.val())));
		this.regenerateButton.on("click", () => this.regenerateOutline());
		this.deleteButton.on("click", () => this.removeOutline());
		this.updateEnableToggle();
	}

	/** (Re)fills the quick-access prompt-profile dropdown and selects the active one. */
	populateProfiles() {
		if (!this.profileSelect) return;
		this.profileSelect.empty();
		this.profileSelect.append($("<option>").val("").text("— no profile (free-form) —"));
		for (const name of listPromptProfileNames()) {
			this.profileSelect.append($("<option>").val(name).text(name));
		}
		this.profileSelect.val(getActivePromptProfileName());
	}

	/**
	 * Navigates to the previous/next non-system message, flushing any pending edit first so it lands
	 * on the message being left, not the one navigated to.
	 * @param {number} direction - Negative for previous, positive for next.
	 */
	navigate(direction) {
		if (!Number.isInteger(this.mesId)) return;
		const target = direction < 0
			? getPreviousNonSystemMessageIndex(this.mesId)
			: getNextNonSystemMessageIndex(this.mesId);
		if (target === -1) return;
		this.flushPendingSave();
		this.mesId = target;
		this.refreshContent();
	}

	/** Greys out a nav arrow when there's no message to go to in that direction. */
	updateNavButtons() {
		if (!this.prevButton) return;
		const hasPrev = Number.isInteger(this.mesId) && getPreviousNonSystemMessageIndex(this.mesId) !== -1;
		const hasNext = Number.isInteger(this.mesId) && getNextNonSystemMessageIndex(this.mesId) !== -1;
		this.prevButton.toggleClass("disabled", !hasPrev);
		this.nextButton.toggleClass("disabled", !hasNext);
	}

	/** Syncs the green/red on-off switch in the header with the current enabled setting. */
	updateEnableToggle() {
		if (!this.enableToggle) return;
		const enabled = isEnabled();
		this.enableToggle.toggleClass("toggleEnabled", enabled);
		this.enableToggle.find("i")
			.toggleClass("fa-toggle-on", enabled)
			.toggleClass("fa-toggle-off", !enabled);
		this.enableToggle.find(".director-enable-label").text(enabled ? "Enabled" : "Disabled");
	}

	/** Points the panel at a message: creates the UI if needed, refreshes, and shows it. */
	openFor(mesId) {
		if (Number.isInteger(mesId)) this.mesId = mesId;
		if (!this.container) this.createUI();
		this.refreshContent();
		this.container.show();
	}

	/** Repaints the header, nav, profile picker, toggle state, and outline box for the current message. */
	refreshContent() {
		this.header.text(`🎬 Director${Number.isInteger(this.mesId) ? ` — message ${this.mesId}` : ""}`);
		this.updateEnableToggle();
		this.updateNavButtons();
		this.populateProfiles();

		this.contentArea.empty();
		const textarea = $('<textarea class="text_pole director_interface_textarea" placeholder="No outline yet — press Regenerate to create one."></textarea>');
		textarea.val(String(chat[this.mesId]?.director ?? ""));
		// Auto-save: every edit is persisted (debounced); no Save button.
		textarea.on("input", () => this.scheduleSave());
		this.contentArea.append(textarea);
		this.textarea = textarea;
		this._dirty = false;
	}

	/** Debounces a save of the current textarea so typing doesn't write to disk on every keystroke. */
	scheduleSave() {
		this._dirty = true;
		clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => this.flushPendingSave(), 500);
	}

	/** Persists any pending edit immediately (called on debounce timeout, navigation, and close). */
	flushPendingSave() {
		clearTimeout(this._saveTimer);
		this._saveTimer = null;
		if (!this._dirty) return;
		this._dirty = false;
		if (Number.isInteger(this.mesId) && this.mesId >= 0 && chat[this.mesId] && this.textarea) {
			saveDirectorToMessage(this.mesId, String(this.textarea.val() ?? ""));
		}
	}

	/** @returns {boolean} true if the panel still points at a live message. */
	ensureMessage() {
		if (Number.isInteger(this.mesId) && this.mesId >= 0 && chat[this.mesId]) return true;
		window.toastr?.info?.("No chat message is associated with this director outline.");
		return false;
	}

	disableControls(disable) {
		this.regenerateButton.prop("disabled", disable);
		this.deleteButton.prop("disabled", disable);
	}

	async regenerateOutline() {
		if (!this.ensureMessage()) return;
		// Drop any pending typed edit — we're replacing the outline wholesale.
		clearTimeout(this._saveTimer);
		this._dirty = false;
		this.disableControls(true);
		try {
			window.toastr?.info?.("Director: regenerating…");
			const outline = await regenerateDirectorForMessage(this.mesId);
			this.textarea.val(String(outline ?? ""));
		} catch (e) {
			window.toastr?.error?.("Director regeneration failed.");
			error("Regenerate failed:", e);
		} finally {
			this.disableControls(false);
		}
	}

	async removeOutline() {
		if (!this.ensureMessage()) return;
		const confirmed = await callGenericPopup("Remove the director outline from this message?", POPUP_TYPE.CONFIRM);
		if (!confirmed) return;
		// Drop any pending typed edit so it can't re-save the text we're deleting.
		clearTimeout(this._saveTimer);
		this._dirty = false;
		await removeDirectorFromMessage(this.mesId);
		this.textarea.val("");
		window.toastr?.success?.("Director outline removed.");
	}

	close() {
		this.flushPendingSave();
		if (this.container) {
			this.container.fadeOut(animation_duration, () => {
				this.container.remove();
				this.container = null;
				DirectorInterface.instance = null;
			});
		}
	}

	/** If the panel is open on `mesId`, repaint it (so inline preview edits stay in sync). */
	static refreshIfOpen(mesId) {
		const ui = DirectorInterface.instance;
		if (ui && ui.container && ui.mesId === mesId) ui.refreshContent();
	}

	/**
	 * Wires up the entry points: the per-message "Show Director" button, the magic-wand
	 * (extensions menu) entry, and their delegated click handlers. Idempotent.
	 */
	static initButtons() {
		if (!$("#message_template .mes_director_button").length) {
			const button = $(
				'<div title="Show Director" class="mes_button mes_director_button fa-solid fa-clapperboard interactable" tabindex="0"></div>'
			);
			$("#message_template .mes_buttons .extraMesButtons").prepend(button);
		}

		$(document)
			.off("click.directorbtn")
			.on("click.directorbtn", ".mes_director_button", function () {
				const mesId = Number($(this).closest(".mes").attr("mesid"));
				if (Number.isInteger(mesId)) DirectorInterface.show(mesId);
			});

		// Magic-wand (extensions) menu entry — Director's own, mirroring the Tracker's.
		if (!$("#director_ui_container").length) {
			const entry = $(`
				<div class="extension_container interactable" id="director_ui_container" tabindex="0">
					<div id="director-ui-item" class="list-group-item flex-container flexGap5 interactable" title="Open Director Interface" tabindex="0">
						<div class="extensionsMenuExtensionButton fa-solid fa-clapperboard"></div>
						Director
					</div>
				</div>
			`);
			$("#extensionsMenu").append(entry);
		}
		$(document)
			.off("click.directormenu")
			.on("click.directormenu", "#director-ui-item", () => DirectorInterface.openInterface());
	}

	/** Magic-wand entry: open the panel on the current (last) message, even if it has no outline yet. */
	static openInterface() {
		let mesId = getLastNonSystemMessageIndex();
		if (!Number.isInteger(mesId) || mesId < 0 || !chat[mesId]) {
			window.toastr?.info?.("No chat messages are available yet. Send a message first.");
			return;
		}
		DirectorInterface.show(mesId);
	}

	/** Opens (or repoints) the side panel for a message. */
	static show(mesId) {
		if (!chat[mesId]) {
			window.toastr?.info?.("No message selected.");
			return;
		}
		new DirectorInterface().openFor(mesId);
	}

	/** Inline "edit" control -> the side panel. */
	static edit(mesId) {
		return DirectorInterface.show(mesId);
	}

	/** Inline "regenerate" control: regenerate in place; refresh the panel if it's showing this message. */
	static async regenerate(mesId) {
		if (!chat[mesId]) return;
		try {
			window.toastr?.info?.("Director: regenerating…");
			await regenerateDirectorForMessage(mesId);
			DirectorInterface.refreshIfOpen(mesId);
		} catch (e) {
			window.toastr?.error?.("Director regeneration failed.");
			error("Regenerate failed:", e);
		}
	}

	/** Inline "delete" control: delete with confirmation; refresh the panel if it's showing this message. */
	static async remove(mesId) {
		if (!chat[mesId]) return;
		const confirmed = await callGenericPopup("Remove the director outline from this message?", POPUP_TYPE.CONFIRM);
		if (!confirmed) return;
		await removeDirectorFromMessage(mesId);
		DirectorInterface.refreshIfOpen(mesId);
	}
}
