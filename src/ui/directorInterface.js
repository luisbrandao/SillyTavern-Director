import { animation_duration, chat } from "../../../../../../script.js";
import { dragElement } from "../../../../../../scripts/RossAscends-mods.js";
import { loadMovingUIState } from "../../../../../../scripts/power-user.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../../scripts/popup.js";
import { isEnabled, toggleExtension } from "../settings/settings.js";
import { getLastNonSystemMessageIndex, getLastMessageWithDirector, error } from "../../lib/utils.js";
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
		const header = `<div id="directorInterfaceHeader">Director</div>`;
		const toggleBar = `<label id="directorInterfaceToggle" class="checkbox_label" title="Enable or disable the Director globally (same as the settings checkbox)">
			<input type="checkbox" id="director_global_toggle" />
			<span>Director enabled</span>
		</label>`;
		const contents = `<div id="directorInterfaceContents" class="scrollY"></div>`;
		const footer = `<div id="directorInterfaceFooter">
			<button id="directorInterfaceSave" class="menu_button menu_button_default interactable" tabindex="0">Save</button>
			<button id="directorInterfaceRegenerate" class="menu_button menu_button_default interactable" tabindex="0">Regenerate</button>
			<button id="directorInterfaceDelete" class="menu_button menu_button_default interactable" tabindex="0">Delete</button>
		</div>`;

		const el = $(template);
		el.attr("id", "directorEnhancedInterface").removeClass("zoomed_avatar").addClass("draggable").empty();
		el.append(controlBarHtml).append(header).append(toggleBar).append(contents).append(footer);
		$("#movingDivs").append(el);

		loadMovingUIState();
		el.css("display", "flex").fadeIn(animation_duration);
		dragElement(el);

		$("#directorInterfaceClose").off("click").on("click", () => this.close());

		this.container = el;
		this.header = el.find("#directorInterfaceHeader");
		this.contentArea = el.find("#directorInterfaceContents");
		this.toggle = el.find("#director_global_toggle");
		this.saveButton = el.find("#directorInterfaceSave");
		this.regenerateButton = el.find("#directorInterfaceRegenerate");
		this.deleteButton = el.find("#directorInterfaceDelete");

		this.toggle.on("change", () => toggleExtension(this.toggle.prop("checked")));
		this.saveButton.on("click", () => this.saveOutline());
		this.regenerateButton.on("click", () => this.regenerateOutline());
		this.deleteButton.on("click", () => this.removeOutline());
	}

	/** Points the panel at a message: creates the UI if needed, refreshes, and shows it. */
	openFor(mesId) {
		if (Number.isInteger(mesId)) this.mesId = mesId;
		if (!this.container) this.createUI();
		this.refreshContent();
		this.container.show();
	}

	/** Repaints the header, toggle state, and outline box for the current message. */
	refreshContent() {
		this.header.text(`🎬 Director${Number.isInteger(this.mesId) ? ` — message ${this.mesId}` : ""}`);
		this.toggle.prop("checked", isEnabled());

		this.contentArea.empty();
		const textarea = $('<textarea class="text_pole director_interface_textarea" placeholder="No outline yet — press Regenerate to create one."></textarea>');
		textarea.val(String(chat[this.mesId]?.director ?? ""));
		this.contentArea.append(textarea);
		this.textarea = textarea;
	}

	/** @returns {boolean} true if the panel still points at a live message. */
	ensureMessage() {
		if (Number.isInteger(this.mesId) && this.mesId >= 0 && chat[this.mesId]) return true;
		window.toastr?.info?.("No chat message is associated with this director outline.");
		return false;
	}

	disableControls(disable) {
		this.saveButton.prop("disabled", disable);
		this.regenerateButton.prop("disabled", disable);
		this.deleteButton.prop("disabled", disable);
	}

	async saveOutline() {
		if (!this.ensureMessage()) return;
		await saveDirectorToMessage(this.mesId, String(this.textarea.val() ?? ""));
		window.toastr?.success?.("Director outline saved.");
	}

	async regenerateOutline() {
		if (!this.ensureMessage()) return;
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
		await removeDirectorFromMessage(this.mesId);
		this.textarea.val("");
		window.toastr?.success?.("Director outline removed.");
	}

	close() {
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

	/** Magic-wand entry: open the panel on the last message with an outline (else the last message). */
	static openInterface() {
		let mesId = getLastMessageWithDirector();
		if (!Number.isInteger(mesId) || mesId < 0 || !chat[mesId]) mesId = getLastNonSystemMessageIndex();
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
