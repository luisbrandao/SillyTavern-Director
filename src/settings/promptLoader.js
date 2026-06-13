import { extensionFolderPath } from "../../index.js";
import { debug, warn } from "../../lib/utils.js";

// Built-in director prompts shipped as prompts/<name>.txt — the filename (minus .txt) is the
// profile title. A browser can't list a directory over HTTP, so every shipped file must be
// registered here.
const PROMPT_FILES = [
	"Default.txt",
	"Concise.txt",
	"Slow Burn.txt",
	"Plot Driver.txt",
	"Character Voice.txt",
	"Wildcard.txt",
];

// The file whose content is also the default `directorPrompt` (the prompt used with no profile).
export const DEFAULT_PROFILE_NAME = "Default";

/**
 * Fetches the built-in director prompts from prompts/*.txt.
 * @returns {Promise<{name: string, prompt: string}[]>} One entry per readable, non-empty file;
 * unreadable files are skipped with a warning so one bad file doesn't lose the rest.
 */
export async function loadBuiltinPromptProfiles() {
	const results = await Promise.all(PROMPT_FILES.map(async (file) => {
		const name = file.replace(/\.txt$/i, "");
		try {
			const text = String(await $.get(`${extensionFolderPath}/prompts/${encodeURIComponent(file)}`)).trim();
			return text ? { name, prompt: text } : null;
		} catch (e) {
			warn(`Failed to load built-in director prompt "${file}":`, e?.statusText || e?.message || e);
			return null;
		}
	}));
	const profiles = results.filter(Boolean);
	debug("Built-in director prompts loaded", profiles.map((p) => p.name));
	return profiles;
}
