import type { ToolDefinition } from "@/lib/llm";
import { listChannels } from "@/lib/db/channel-queries";
import {
	validateTwilioConfig,
	buildTwimlResponse,
	callTwilioApi,
	type PhoneConfig,
} from "@/lib/services/phone-service";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";

export const PHONE_TOOL_NAMES = {
	CALL: "builtin.phone_call",
} as const;

export const PHONE_TOOLS_REQUIRING_APPROVAL: string[] = [];

export const BUILTIN_PHONE_TOOLS: ToolDefinition[] = [
	{
		name: PHONE_TOOL_NAMES.CALL,
		description:
			"Make an outbound phone call using the configured Phone channel (Twilio). " +
			"Use this to call someone and deliver a spoken message on their behalf.",
		inputSchema: {
			type: "object",
			properties: {
				to: {
					type: "string",
					description: "Recipient phone number (E.164 format, e.g., '+1234567890' or '(123) 456-7890').",
				},
				message: {
					type: "string",
					description: "Spoken message to deliver during the call. Will be converted to speech using the configured voice.",
				},
				channelLabel: {
					type: "string",
					description: "Optional exact channel label to use when multiple Phone channels exist.",
				},
			},
			required: ["to", "message"],
		},
	},
];

/**
 * PhoneTools — BaseTool implementation for phone calling.
 * Auto-registers via the tool category registry.
 */
export class PhoneTools extends BaseTool {
	readonly name = "phone";
	readonly toolNamePrefix = "builtin.phone_";
	readonly registrationOrder = 45;
	readonly tools = BUILTIN_PHONE_TOOLS;
	readonly toolsRequiringApproval = [...PHONE_TOOLS_REQUIRING_APPROVAL];

	static isTool(name: string): boolean {
		return name === PHONE_TOOL_NAMES.CALL;
	}

	static async executeBuiltin(
		name: string,
		args: Record<string, unknown>,
		userId?: string
	): Promise<unknown> {
		if (name === PHONE_TOOL_NAMES.CALL) {
			return PhoneTools.executePhoneCall(args, userId);
		}
		throw new Error(`Unknown phone tool: ${name}`);
	}

	private static getStringArg(args: Record<string, unknown>, key: string): string {
		const value = args[key];
		return typeof value === "string" ? value.trim() : "";
	}

	private static normalizePhoneNumber(value: string): string {
		return value.trim();
	}

	private static pickPhoneChannel(configUserId?: string, channelLabel?: string) {
		const channels = listChannels(configUserId).filter(
			(c) => c.channel_type === "phone" && !!c.enabled
		);

		if (channels.length === 0) {
			throw new Error("No enabled Phone channel found for this user.");
		}

		if (channelLabel) {
			const match = channels.find(
				(c) => c.label.trim().toLowerCase() === channelLabel.trim().toLowerCase()
			);
			if (!match) {
				throw new Error(`Phone channel "${channelLabel}" was not found or is disabled.`);
			}
			return match;
		}

		return channels[0];
	}

	private static async executePhoneCall(
		args: Record<string, unknown>,
		userId?: string
	): Promise<unknown> {
		const to = PhoneTools.normalizePhoneNumber(PhoneTools.getStringArg(args, "to"));
		const message = PhoneTools.getStringArg(args, "message");
		const channelLabel = PhoneTools.getStringArg(args, "channelLabel");

		if (!to || !message) {
			throw new Error("Missing required args: to, message.");
		}

		const channel = PhoneTools.pickPhoneChannel(userId, channelLabel || undefined);

		let config: PhoneConfig = {};
		try {
			config = JSON.parse(channel.config_json || "{}");
		} catch {
			config = {};
		}

		validateTwilioConfig(config);

		const accountSid = String(config.accountSid ?? "").trim();
		const authToken = String(config.authToken ?? "").trim();
		const fromNumber = String(config.phoneNumber ?? "").trim();
		const voiceName = String(config.voiceName ?? "alice").trim();

		const twiml = buildTwimlResponse(message, "", voiceName);

		try {
			await callTwilioApi(accountSid, authToken, fromNumber, to, twiml);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			throw new Error(`Phone call initiation failed: ${errMsg}`);
		}

		return {
			status: "call_initiated",
			channelId: channel.id,
			channelLabel: channel.label,
			to,
			from: fromNumber,
			message,
		};
	}

	async execute(toolName: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
		return PhoneTools.executeBuiltin(toolName, args, context.userId);
	}
}

export const isPhoneTool = PhoneTools.isTool.bind(PhoneTools);
export const executeBuiltinPhoneTool = PhoneTools.executeBuiltin.bind(PhoneTools);

export const phoneTools = new PhoneTools();
registerToolCategory(phoneTools);
