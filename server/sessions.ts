import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ProviderSessionSummary } from "@getpaseo/plugin/server/provider";
import { PI_PERSISTENCE_VERSION } from "../shared/constants";
import { piAgentDir } from "./paths";

const MAX_FILES = 5_000;
const MAX_BYTES = 8 * 1024 * 1024;

export function defaultSessionDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(piAgentDir(env), "sessions");
}

export function resolveSessionDir(input: {
	option?: string;
	env?: Record<string, string>;
	processEnv?: NodeJS.ProcessEnv;
}): string {
	return (
		input.option?.trim() ||
		input.env?.PI_CODING_AGENT_SESSION_DIR?.trim() ||
		input.processEnv?.PI_CODING_AGENT_SESSION_DIR?.trim() ||
		defaultSessionDir(input.processEnv ?? input.env)
	);
}

interface SessionHeader {
	type?: string;
	id?: string;
	cwd?: string;
}

interface SessionScan {
	header?: SessionHeader;
	name?: string;
	firstUserText?: string;
}

function scanSession(text: string): SessionScan {
	const scan: SessionScan = {};
	for (const line of text.split("\n")) {
		if (!line.startsWith("{")) continue;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (!scan.header && entry.type === "session") {
			scan.header = entry as SessionHeader;
			continue;
		}
		if (entry.type === "session_info" && typeof entry.name === "string") {
			scan.name = entry.name;
			continue;
		}
		if (!scan.firstUserText && entry.type === "message") {
			const message = entry.message as { role?: string; content?: unknown } | undefined;
			if (message?.role !== "user") continue;
			const content = message.content;
			const textValue =
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content
								.filter(
									(block): block is { type: string; text: string } =>
										!!block &&
										typeof block === "object" &&
										(block as { type?: unknown }).type === "text" &&
										typeof (block as { text?: unknown }).text === "string",
								)
								.map((block) => block.text)
								.join(" ")
						: "";
			if (textValue.trim()) scan.firstUserText = textValue.trim();
		}
	}
	return scan;
}

async function findSessionFiles(root: string): Promise<Array<{ path: string; mtime: number }>> {
	const found: Array<{ path: string; mtime: number }> = [];
	const visit = async (dir: string, depth: number): Promise<void> => {
		if (depth > 3 || found.length >= MAX_FILES) return;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.length >= MAX_FILES) return;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await visit(path, depth + 1);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			try {
				const info = await stat(path);
				found.push({ path, mtime: info.mtimeMs });
			} catch {
				// A session that vanished during listing is simply absent.
			}
		}
	};
	await visit(root, 0);
	return found;
}

export async function listPiSessions(input: {
	sessionDir: string;
	cwd?: string;
	query?: string;
	limit?: number;
}): Promise<ProviderSessionSummary[]> {
	const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
	const query = input.query?.trim().toLowerCase();
	const summaries: ProviderSessionSummary[] = [];
	const files = (await findSessionFiles(input.sessionDir)).sort((a, b) => b.mtime - a.mtime);
	for (const file of files) {
		if (summaries.length >= limit) break;
		let text: string;
		try {
			const buffer = await readFile(file.path);
			text = buffer.subarray(0, MAX_BYTES).toString("utf8");
		} catch {
			continue;
		}
		const scan = scanSession(text);
		const header = scan.header;
		if (!header?.id || !header.cwd) continue;
		if (input.cwd && header.cwd !== input.cwd) continue;
		const title = scan.name ?? scan.firstUserText?.slice(0, 160);
		const haystack = `${title ?? ""} ${header.id} ${header.cwd} ${file.path}`.toLowerCase();
		if (query && !haystack.includes(query)) continue;
		summaries.push({
			persistence: {
				version: PI_PERSISTENCE_VERSION,
				data: { sessionFile: file.path, sessionId: header.id },
			},
			cwd: header.cwd,
			...(title ? { title } : {}),
			updatedAt: new Date(file.mtime).toISOString(),
		});
	}
	return summaries;
}

export function parsePersistence(data: unknown): {
	sessionFile: string;
	sessionId?: string;
} | undefined {
	if (!data || typeof data !== "object") return undefined;
	const record = data as Record<string, unknown>;
	if (record.version !== PI_PERSISTENCE_VERSION) return undefined;
	const payload = record.data;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const entry = payload as Record<string, unknown>;
	if (typeof entry.sessionFile !== "string" || !isAbsolute(entry.sessionFile)) {
		return undefined;
	}
	return {
		sessionFile: entry.sessionFile,
		...(typeof entry.sessionId === "string" ? { sessionId: entry.sessionId } : {}),
	};
}
