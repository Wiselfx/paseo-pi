import type { ProviderToolCallDetail } from "@getpaseo/plugin/server/provider";

export type ContentBlock = {
	type?: string;
	text?: string;
	thinking?: string;
	toolCallId?: string;
	toolName?: string;
	arguments?: unknown;
	data?: string;
	mimeType?: string;
};

export interface WireMessage {
	role?: string;
	content?: unknown;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: { total?: number };
	};
	stopReason?: string;
	errorMessage?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
}

export function blocksOf(content: unknown): ContentBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

export function messageText(message: WireMessage | undefined): string {
	if (!message) return "";
	return blocksOf(message.content)
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text ?? "")
		.join("");
}

export function reasoningText(message: WireMessage | undefined): string[] {
	return blocksOf(message?.content)
		.filter((block) => block.type === "thinking" && typeof block.thinking === "string")
		.map((block) => block.thinking ?? "")
		.filter((text) => text.trim().length > 0);
}

export function toolCallsOf(message: WireMessage | undefined): Array<{
	id: string;
	name: string;
	arguments: unknown;
}> {
	return blocksOf(message?.content)
		.filter((block) => block.type === "toolCall" && typeof block.toolCallId === "string")
		.map((block) => ({
			id: block.toolCallId as string,
			name: block.toolName ?? "tool",
			arguments: block.arguments,
		}));
}

export function resultText(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	return blocksOf(content)
		.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
		.filter(Boolean)
		.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Paseo renders a handful of typed tool details richly and the rest as plain text. This maps pi's
 * built-in tool calls onto those types without interpreting extension tools, which stay plain.
 */
export function toolDetail(
	name: string,
	args: unknown,
	result?: unknown,
	isError?: boolean,
): ProviderToolCallDetail {
	const input = asRecord(args);
	const output = result ? resultText(result) : undefined;
	if (name === "bash" || name === "powershell") {
		return {
			type: "shell",
			command: str(input.command) ?? "",
			...(str(input.cwd) ? { cwd: str(input.cwd) } : {}),
			...(output !== undefined ? { output } : {}),
		};
	}
	if (name === "read") {
		return {
			type: "read",
			filePath: str(input.path) ?? str(input.file_path) ?? "",
			...(output !== undefined ? { content: output } : {}),
			...(num(input.offset) !== undefined ? { offset: num(input.offset) } : {}),
			...(num(input.limit) !== undefined ? { limit: num(input.limit) } : {}),
		};
	}
	if (name === "edit") {
		const details = asRecord(asRecord(result).details);
		const filePath = str(input.path) ?? str(input.file_path) ?? "";
		return {
			type: "edit",
			filePath,
			...(str(input.oldText) !== undefined ? { oldString: str(input.oldText) } : {}),
			...(str(input.newText) !== undefined ? { newString: str(input.newText) } : {}),
			...(str(details.diff) ? { unifiedDiff: str(details.diff) } : {}),
		};
	}
	if (name === "write") {
		return {
			type: "write",
			filePath: str(input.path) ?? str(input.file_path) ?? "",
			...(str(input.content) !== undefined ? { content: str(input.content) } : {}),
		};
	}
	if (name === "grep" || name === "find" || name === "ls") {
		const query =
			str(input.pattern) ?? str(input.query) ?? str(input.path) ?? str(input.glob) ?? name;
		return {
			type: "search",
			query,
			toolName: name === "grep" ? "grep" : name === "find" ? "glob" : "search",
			...(output !== undefined ? { content: output } : {}),
		};
	}
	return {
		type: "plain_text",
		label: name,
		...(output ? { text: output } : {}),
		...(isError && !output ? { text: "The tool failed" } : {}),
	};
}

export function toolTitle(detail: ProviderToolCallDetail): string {
	if (detail.type === "shell") return detail.command;
	if (detail.type === "read" || detail.type === "edit" || detail.type === "write")
		return detail.filePath;
	if (detail.type === "search") return detail.query;
	if (detail.type === "plain_text") return detail.label ?? "tool";
	return detail.type;
}
