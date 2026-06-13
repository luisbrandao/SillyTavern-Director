import { chat } from "../../../../../../script.js";
import { Popup, callGenericPopup, POPUP_TYPE } from "../../../../../../scripts/popup.js";
import { saveDirectorToMessage, regenerateDirectorForMessage, removeDirectorFromMessage } from "../director.js";

/**
 * Per-message "Show Director" entry point: a message button (like the Tracker's "Show Message
 * Tracker") that opens a single editable window for the message's director outline — edit + Save,
 * Regenerate (refills the box in place), or Delete. Shared with the inline preview controls.
 */
export class DirectorInterface {
	/** Adds the per-message button to the message template and binds the (delegated) click. */
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
	}

	/**
	 * Opens a single editable window for the message's outline: edit + Save, Regenerate (refills the
	 * textarea in place — no second window), or Delete.
	 * @param {number} mesId
	 */
	static async show(mesId) {
		if (!chat[mesId]) {
			window.toastr?.info?.("No message selected.");
			return;
		}

		const current = String(chat[mesId]?.director ?? "");
		const header = `<h3>🎬 Director — message ${mesId}</h3><small>Edit the outline and press Save, or regenerate it.</small>`;

		const popup = new Popup(header, POPUP_TYPE.INPUT, current, {
			wide: true,
			large: true,
			rows: 14,
			okButton: "Save",
			cancelButton: "Close",
			customButtons: [
				{
					// No `result` => this button does NOT close the popup; it just refills the textarea.
					text: "Regenerate",
					icon: "fa-rotate",
					action: async () => {
						try {
							window.toastr?.info?.("Director: regenerating…");
							const outline = await regenerateDirectorForMessage(mesId);
							if (popup.mainInput) popup.mainInput.value = String(outline ?? "");
						} catch (e) {
							window.toastr?.error?.("Director regeneration failed.");
							console.error("[director] regenerate failed:", e);
						}
					},
				},
				{
					text: "Delete",
					icon: "fa-trash",
					action: async () => {
						const confirmed = await callGenericPopup("Remove the director outline from this message?", POPUP_TYPE.CONFIRM);
						if (!confirmed) return;
						await removeDirectorFromMessage(mesId);
						await popup.completeCancelled();
					},
				},
			],
		});

		// Tag the dialog so style.css can make the textarea fill the (large) popup and stay resizable.
		popup.dlg.classList.add("director_outline_popup");

		const result = await popup.show();
		// INPUT popups return the textarea string on Save; false/null on Close/Delete.
		if (typeof result === "string") {
			await saveDirectorToMessage(mesId, result);
		}
	}

	/** Inline "edit" control -> the same editable window. */
	static async edit(mesId) {
		return DirectorInterface.show(mesId);
	}

	/** Regenerate the outline for a message (inline regenerate control). */
	static async regenerate(mesId) {
		if (!chat[mesId]) return;
		try {
			window.toastr?.info?.("Director: regenerating…");
			await regenerateDirectorForMessage(mesId);
		} catch (e) {
			window.toastr?.error?.("Director regeneration failed.");
			console.error("[director] regenerate failed:", e);
		}
	}

	/** Delete the outline with confirmation (inline delete control). */
	static async remove(mesId) {
		if (!chat[mesId]) return;
		const confirmed = await callGenericPopup("Remove the director outline from this message?", POPUP_TYPE.CONFIRM);
		if (!confirmed) return;
		await removeDirectorFromMessage(mesId);
	}
}
