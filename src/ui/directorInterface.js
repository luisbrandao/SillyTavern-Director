import { chat } from "../../../../../../script.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../../scripts/popup.js";
import { saveDirectorToMessage, regenerateDirectorForMessage, removeDirectorFromMessage } from "../director.js";

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// Custom popup button results (2+ to avoid colliding with POPUP_RESULT affirmative/negative/cancel).
const ACTION = { EDIT: 2, REGENERATE: 3, DELETE: 4 };

/**
 * Per-message "Show Director" entry point: a message button (like the Tracker's "Show Message
 * Tracker") that opens a popup with the message's director outline and Edit/Regenerate/Delete.
 * The action helpers are shared with the inline preview controls.
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

	/** Opens the director popup for a message. Re-opens itself after edit/regenerate. */
	static async show(mesId) {
		if (!chat[mesId]) {
			window.toastr?.info?.("No message selected.");
			return;
		}

		const outline = String(chat[mesId]?.director ?? "");
		const hasOutline = !!outline.trim();
		const body = hasOutline
			? `<div class="director_popup_outline">${escapeHtml(outline)}</div>`
			: `<div class="director_popup_empty"><em>No director outline for this message yet.</em></div>`;
		const content = `<h3>🎬 Director — message ${mesId}</h3>${body}`;

		const result = await callGenericPopup(content, POPUP_TYPE.TEXT, "", {
			wide: true,
			allowVerticalScrolling: true,
			okButton: false,
			cancelButton: "Close",
			customButtons: [
				{ text: hasOutline ? "Edit" : "Add", icon: "fa-pen", result: ACTION.EDIT },
				{ text: "Regenerate", icon: "fa-rotate", result: ACTION.REGENERATE },
				{ text: "Delete", icon: "fa-trash", result: ACTION.DELETE },
			],
		});

		if (result === ACTION.EDIT) {
			await DirectorInterface.edit(mesId);
			return DirectorInterface.show(mesId);
		}
		if (result === ACTION.REGENERATE) {
			await DirectorInterface.regenerate(mesId);
			return DirectorInterface.show(mesId);
		}
		if (result === ACTION.DELETE) {
			await DirectorInterface.remove(mesId);
		}
		// Close / cancel: do nothing.
	}

	/** Edit popup (also used by the inline edit control). */
	static async edit(mesId) {
		if (!chat[mesId]) return;
		const current = String(chat[mesId]?.director ?? "");
		const result = await callGenericPopup("Edit director outline", POPUP_TYPE.INPUT, current, { rows: 10, wide: true });
		if (result === null || result === false) return;
		await saveDirectorToMessage(mesId, String(result));
	}

	/** Regenerate the outline for a message (shared with the inline regenerate control). */
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

	/** Delete the outline (with confirmation; shared with the inline delete control). */
	static async remove(mesId) {
		if (!chat[mesId]) return;
		const confirmed = await callGenericPopup("Remove the director outline from this message?", POPUP_TYPE.CONFIRM);
		if (!confirmed) return;
		await removeDirectorFromMessage(mesId);
	}
}
