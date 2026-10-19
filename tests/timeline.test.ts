import { describe, expect, it } from "vitest";
import {
	blocksOf,
	messageText,
	reasoningText,
	resultText,
	toolCallsOf,
	toolDetail,
} from "../server/provider/timeline";

describe("wire content", () => {
	it("reads text, thinking, and tool calls from blocks", () => {
		const message = {
			content: [
				{ type: "text", text: "Hello " },
				{ type: "thinking", thinking: "plan" },
				{ type: "text", text: "world" },
				{ type: "toolCall", toolCallId: "c1", toolName: "read", arguments: { path: "/a" } },
			],
		};
		expect(messageText(message)).toBe("Hello world");
		expect(reasoningText(message)).toEqual(["plan"]);
		expect(toolCallsOf(message)).toEqual([{ id: "c1", name: "read", arguments: { path: "/a" } }]);
	});

	it("accepts a plain string and ignores non-array content", () => {
		expect(blocksOf("text")).toEqual([{ type: "text", text: "text" }]);
		expect(blocksOf(null)).toEqual([]);
	});
});

describe("tool details", () => {
	it("maps shell, read, edit, write, and search tools", () => {
		expect(toolDetail("bash", { command: "ls", cwd: "/tmp" }, { content: [{ type: "text", text: "a" }] })).toMatchObject({
			type: "shell",
			command: "ls",
			cwd: "/tmp",
			output: "a",
		});
		expect(toolDetail("read", { path: "/a", offset: 2 }, { content: [{ type: "text", text: "x" }] })).toMatchObject({
			type: "read",
			filePath: "/a",
			offset: 2,
			content: "x",
		});
		expect(
			toolDetail(
				"edit",
				{ path: "/a", oldText: "x", newText: "y" },
				{ content: [], details: { diff: "@@ -1 +1 @@" } },
			),
		).toMatchObject({ type: "edit", filePath: "/a", oldString: "x", newString: "y", unifiedDiff: "@@ -1 +1 @@" });
		expect(toolDetail("write", { path: "/a", content: "body" })).toMatchObject({
			type: "write",
			filePath: "/a",
			content: "body",
		});
		expect(toolDetail("grep", { pattern: "needle" }, { content: [{ type: "text", text: "match" }] })).toMatchObject({
			type: "search",
			query: "needle",
			toolName: "grep",
			content: "match",
		});
	});

	it("falls back to plain text for extension tools and failures", () => {
		expect(toolDetail("my_tool", {})).toEqual({ type: "plain_text", label: "my_tool" });
		expect(toolDetail("my_tool", {}, undefined, true)).toMatchObject({ text: "The tool failed" });
		expect(resultText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
	});
});
