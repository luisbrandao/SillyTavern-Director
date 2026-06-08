import { chat } from "../../../../../../script.js";
import { debug } from "../../lib/utils.js";
import { DirectorInterface } from "./directorInterface.js";

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Renders the per-message director outline preview (a collapsible block under each message). The
 * inline edit / regenerate / delete controls delegate to DirectorInterface so behavior matches the
 * "Show Director" button.
 */
export class DirectorPreviewManager {
	static init() {
		if (!this._bound) {
			this.bindControls();
			DirectorInterface.initButtons();
			this._bound = true;
		}
		this.scanAndRender();
	}

	static bindControls() {
		const mesIdOf = (node) => Number($(node).closest(".mes").attr("mesid"));

		$(document)
			.off("click.director")
			.on("click.director", ".director_btn_regenerate", function () {
				const mesId = mesIdOf(this);
				if (Number.isInteger(mesId)) DirectorInterface.regenerate(mesId);
			})
			.on("click.director", ".director_btn_edit", function () {
				const mesId = mesIdOf(this);
				if (Number.isInteger(mesId)) DirectorInterface.edit(mesId);
			})
			.on("click.director", ".director_btn_delete", function () {
				const mesId = mesIdOf(this);
				if (Number.isInteger(mesId)) DirectorInterface.remove(mesId);
			});
	}

	static scanAndRender() {
		document.querySelectorAll("#chat .mes").forEach((el) => {
			const mesId = Number(el.getAttribute("mesid"));
			if (Number.isInteger(mesId)) this.updatePreview(mesId);
		});
	}

	/**
	 * Renders/refreshes/removes the preview for a single message based on its stored outline.
	 * @param {number} mesId
	 */
	static updatePreview(mesId) {
		const el = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
		if (!el) return;

		const existing = el.querySelector(".director_preview");
		if (existing) existing.remove();

		const outline = chat[mesId]?.director;
		if (!outline || !String(outline).trim()) return;

		const target = el.querySelector(".mes_text");
		if (!target) {
			debug(`No .mes_text for message ${mesId}; skipping director preview.`);
			return;
		}

		const block = document.createElement("div");
		block.className = "director_preview";
		block.innerHTML = `
			<details>
				<summary>
					<span class="director_label">🎬 Director</span>
					<span class="director_controls">
						<span class="director_btn director_btn_regenerate fa-solid fa-rotate" title="Regenerate"></span>
						<span class="director_btn director_btn_edit fa-solid fa-pen" title="Edit"></span>
						<span class="director_btn director_btn_delete fa-solid fa-trash" title="Delete"></span>
					</span>
				</summary>
				<div class="director_outline">${escapeHtml(outline)}</div>
			</details>`;
		target.before(block);
	}
}
