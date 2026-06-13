import { eventSource, event_types } from "../../../../script.js";
import { extension_settings } from "../../../../scripts/extensions.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { ARGUMENT_TYPE, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { commonEnumProviders } from "../../../slash-commands/SlashCommandCommonEnumsProvider.js";

export const extensionName = "director";
// Derive the folder from this module's location so the extension works regardless of the folder
// name it's installed into (learned from the Tracker: a hardcoded path 404s the settings HTML).
export const extensionFolderPath = new URL(".", import.meta.url).pathname.replace(/^\//, "").replace(/\/+$/, "");

if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
export const extensionSettings = extension_settings[extensionName];

import { initSettings } from "./src/settings/settings.js";
import { eventHandlers } from "./src/events.js";
import { DirectorPreviewManager } from "./src/ui/directorPreviewManager.js";
import { directorRegenerateCommand, directorGetCommand, directorRemoveCommand, directorStateCommand } from "./src/commands.js";

jQuery(async () => {
	await initSettings();
	DirectorPreviewManager.init();
});

eventSource.on(event_types.CHAT_CHANGED, eventHandlers.onChatChanged);
eventSource.on(event_types.GENERATION_AFTER_COMMANDS, eventHandlers.onGenerateAfterCommands);
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, eventHandlers.onCharacterMessageRendered);
eventSource.on(event_types.USER_MESSAGE_RENDERED, eventHandlers.onUserMessageRendered);
// Attach the outline to the streaming reply as soon as its placeholder appears (first token),
// rather than waiting for streaming to finish. No-op when streaming is off.
eventSource.on(event_types.STREAM_TOKEN_RECEIVED, eventHandlers.onStreamTokenReceived);

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: "director-regenerate",
	callback: directorRegenerateCommand,
	returns: "The generated director outline.",
	namedArgumentList: [
		SlashCommandNamedArgument.fromProps({
			name: "message",
			description: "message to (re)generate the director outline for",
			typeList: [ARGUMENT_TYPE.NUMBER],
			isRequired: false,
			enumProvider: commonEnumProviders.messages(),
		}),
	],
	helpString: "Generates/regenerates the director outline for a message (default: last non-system message).",
	aliases: ["director"],
}));

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: "director-get",
	callback: directorGetCommand,
	returns: "The director outline stored on the message.",
	namedArgumentList: [
		SlashCommandNamedArgument.fromProps({
			name: "message",
			description: "message to read the director outline from",
			typeList: [ARGUMENT_TYPE.NUMBER],
			isRequired: false,
			enumProvider: commonEnumProviders.messages(),
		}),
	],
	helpString: "Retrieves the director outline from a message (default: last non-system message).",
}));

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: "director-remove",
	callback: directorRemoveCommand,
	returns: "true if an outline was removed, false otherwise.",
	namedArgumentList: [
		SlashCommandNamedArgument.fromProps({
			name: "message",
			description: "message to remove the director outline from",
			typeList: [ARGUMENT_TYPE.NUMBER],
			isRequired: false,
			enumProvider: commonEnumProviders.messages(),
		}),
	],
	helpString: "Removes the director outline from a message (default: last non-system message).",
	aliases: ["director-delete"],
}));

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: "director-state",
	callback: directorStateCommand,
	returns: "The current director enabled state.",
	namedArgumentList: [
		SlashCommandNamedArgument.fromProps({
			name: "enabled",
			description: "enable or disable the director",
			typeList: [ARGUMENT_TYPE.BOOLEAN],
			isRequired: false,
		}),
	],
	helpString: "Gets or sets the director enabled/disabled state.",
	aliases: ["toggle-director"],
}));
