import { mkdir, lstat, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const MAX_MARKDOWN_BYTES = 1_000_000;
const MAX_TREE_ENTRIES = 20_000;
const MAX_CANDIDATES = 60;

export type SkillSourceCandidate = {
	name: string;
	description: string;
	/** Repo-relative path of the SKILL.md, or the absolute URL for a single file. */
	path: string;
	url: string;
	installed: boolean;
};

export type ParsedGitHubSource =
	| { kind: "file"; owner: string; repo: string; ref: string; path: string; url: string }
	| { kind: "tree"; owner: string; repo: string; ref?: string; path?: string };

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Turn what people paste into a GitHub source, accepting with or without a scheme. */
export function parseGitHubSource(raw: string): ParsedGitHubSource {
	const value = raw.trim().replace(/^git\+/u, "");
	if (!value) throw new Error("Paste a GitHub link to a SKILL.md file or a repository");
	if (/\s/u.test(value)) throw new Error("GitHub links cannot contain spaces");
	// `owner/repo` is what GitHub's own "copy link" often becomes after pasting.
	const bare = /^[\w.-]+\/[\w.-]+/u.test(value) && !value.includes("://");
	const knownHost = /^(?:www\.)?github\.com\/|^raw\.githubusercontent\.com\//iu.test(value);
	const withHost = bare && !knownHost ? `github.com/${value}` : value;
	const normalized = /^https?:\/\//iu.test(withHost) ? withHost : `https://${withHost}`;
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error("That is not a valid URL");
	}
	const host = url.hostname.toLowerCase();
	const parts = url.pathname.split("/").filter(Boolean);
	if (host === "raw.githubusercontent.com") {
		const [owner, repo, ...rest] = parts;
		if (!owner || !repo || rest.length < 2) throw new Error("Incomplete raw GitHub link");
		const [ref, ...path] = rest;
		if (!ref || path.length === 0) throw new Error("Incomplete raw GitHub link");
		return { kind: "file", owner, repo, ref, path: path.join("/"), url: url.toString() };
	}
	if (host !== "github.com" && host !== "www.github.com") {
		throw new Error("Paste a github.com or raw.githubusercontent.com link");
	}
	const [owner, repo, mode, ...rest] = parts;
	if (!owner || !repo) throw new Error("Incomplete GitHub link");
	const cleanRepo = repo.replace(/\.git$/u, "");
	if (mode === "blob" || mode === "raw") {
		const [ref, ...path] = rest;
		if (!ref || path.length === 0) throw new Error("Incomplete GitHub file link");
		const filePath = path.join("/");
		if (!filePath.toLowerCase().endsWith(".md")) throw new Error("Skill links must point to a Markdown file");
		return {
			kind: "file",
			owner,
			repo: cleanRepo,
			ref,
			path: filePath,
			url: `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${ref}/${filePath}`,
		};
	}
	if (mode === "tree") {
		const [ref, ...path] = rest;
		return {
			kind: "tree",
			owner,
			repo: cleanRepo,
			...(ref ? { ref } : {}),
			...(path.length ? { path: path.join("/") } : {}),
		};
	}
	return { kind: "tree", owner, repo: cleanRepo };
}

/** Read name/description from SKILL.md frontmatter; tolerant of block scalars and quotes. */
export function parseSkillMarkdown(
	text: string,
	fallbackName: string,
): { name: string; description: string } {
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
	const fields = new Map<string, string>();
	const lines = frontmatter.split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
		if (!match?.[1]) continue;
		const raw = match[2] ?? "";
		if (raw === "|" || raw === ">" || raw === "|-" || raw === ">-") {
			const collected: string[] = [];
			let next = index + 1;
			while (next < lines.length && (/^\s+/u.test(lines[next] ?? "") || (lines[next] ?? "").trim() === "")) {
				collected.push((lines[next] ?? "").trim());
				next += 1;
			}
			fields.set(match[1], collected.join(raw.startsWith(">") ? " " : "\n").trim());
			index = next - 1;
			continue;
		}
		fields.set(match[1], raw.replace(/^"(.*)"$/u, "$1").replace(/^'(.*)'$/u, "$1").trim());
	}
	return {
		name: fields.get("name")?.trim() || fallbackName,
		description: fields.get("description")?.trim() ?? "",
	};
}

export function slugifySkillName(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
}

async function fetchText(
	url: string,
	accept: string,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
): Promise<Response> {
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { accept, "user-agent": "paseo-pi" },
			redirect: "follow",
			signal: signal ?? AbortSignal.timeout(15_000),
		});
	} catch (error) {
		throw new Error(`Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (response.status === 403 || response.status === 429) {
		throw new Error("GitHub rate limit reached. Try again later or use a raw link");
	}
	if (response.status === 404) throw new Error("GitHub could not find that file or repository");
	if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}`);
	return response;
}

async function readMarkdown(response: Response): Promise<string> {
	const length = Number(response.headers.get("content-length") ?? "0");
	if (length > MAX_MARKDOWN_BYTES) throw new Error("That skill file is too large (limit 1 MB)");
	const text = await response.text();
	if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES) {
		throw new Error("That skill file is too large (limit 1 MB)");
	}
	if (!text.trim()) throw new Error("That file is empty");
	if (text.includes("\u0000")) throw new Error("That file is not text");
	return text;
}

async function defaultBranch(
	owner: string,
	repo: string,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
): Promise<string> {
	const response = await fetchText(
		`https://api.github.com/repos/${owner}/${repo}`,
		"application/vnd.github+json",
		signal,
		fetchImpl,
	);
	const data = (await response.json()) as { default_branch?: unknown };
	if (typeof data.default_branch !== "string") throw new Error("GitHub did not report a default branch");
	return data.default_branch;
}

type TreeEntry = { path: string; type: string };

async function treeEntries(
	owner: string,
	repo: string,
	ref: string,
	treePath: string | undefined,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
): Promise<TreeEntry[]> {
	const response = await fetchText(
		`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
		"application/vnd.github+json",
		signal,
		fetchImpl,
	);
	const data = (await response.json()) as { tree?: unknown; truncated?: unknown };
	if (!Array.isArray(data.tree)) throw new Error("GitHub returned an unexpected tree");
	const entries = data.tree
		.filter(
			(entry): entry is TreeEntry =>
				!!entry &&
				typeof entry === "object" &&
				typeof (entry as TreeEntry).path === "string" &&
				typeof (entry as TreeEntry).type === "string",
		)
		.slice(0, MAX_TREE_ENTRIES);
	const prefix = treePath ? `${treePath.replace(/\/+$/u, "")}/` : "";
	return entries.filter(
		(entry) => entry.type === "blob" && entry.path.startsWith(prefix) && basename(entry.path) === "SKILL.md",
	);
}

/**
 * Resolve a pasted link into installable candidates. A file link yields one; a repository or
 * directory yields every SKILL.md under it, with name and description read from the file.
 */
export async function inspectGitHubSkill(
	input: { source: string; existingNames?: readonly string[]; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<{ candidates: SkillSourceCandidate[] }> {
	const fetchImpl = input.fetch ?? fetch;
	const source = parseGitHubSource(input.source);
	const existing = new Set(input.existingNames ?? []);
	const signal = input.signal;
	const candidates: SkillSourceCandidate[] = [];
	if (source.kind === "file") {
		const text = await readMarkdown(await fetchText(source.url, "text/plain", signal, fetchImpl));
		const parsed = parseSkillMarkdown(text, basename(source.path, ".md"));
		const name = slugifySkillName(parsed.name);
		if (!name) throw new Error("Could not work out a skill name from that file");
		candidates.push({
			name,
			description: parsed.description,
			path: source.path,
			url: source.url,
			installed: existing.has(name),
		});
		return { candidates };
	}

	const ref = source.ref ?? (await defaultBranch(source.owner, source.repo, signal, fetchImpl));
	const entries = await treeEntries(source.owner, source.repo, ref, source.path, signal, fetchImpl);
	if (entries.length === 0) {
		throw new Error(
			source.path
				? `No SKILL.md under ${source.path} in ${source.owner}/${source.repo}`
				: `No SKILL.md in ${source.owner}/${source.repo}`,
		);
	}
	const selected = entries.slice(0, MAX_CANDIDATES);
	const details = new Map<string, { name: string; description: string }>();
	let next = 0;
	const worker = async () => {
		while (next < selected.length) {
			const entry = selected[next];
			next += 1;
			if (!entry) return;
			const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/${entry.path}`;
			const fallback = basename(dirname(entry.path));
			try {
				const text = await readMarkdown(await fetchText(url, "text/plain", signal, fetchImpl));
				const parsed = parseSkillMarkdown(text, fallback);
				details.set(entry.path, {
					name: slugifySkillName(parsed.name) || slugifySkillName(fallback),
					description: parsed.description,
				});
			} catch {
				// A single unreadable file should not hide the rest of the repository.
				details.set(entry.path, { name: slugifySkillName(fallback), description: "" });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(6, selected.length) }, worker));
	for (const entry of selected) {
		const detail = details.get(entry.path);
		if (!detail?.name) continue;
		candidates.push({
			name: detail.name,
			description: detail.description,
			path: entry.path,
			url: `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/${entry.path}`,
			installed: existing.has(detail.name),
		});
	}
	if (candidates.length === 0) throw new Error("That repository has no usable SKILL.md");
	return { candidates };
}

export async function installGitHubSkill(input: {
	source: string;
	path?: string;
	agentDir: string;
	existingNames?: readonly string[];
	signal?: AbortSignal;
	fetch?: typeof fetch;
}): Promise<{ path: string; name: string }> {
	const fetchImpl = input.fetch ?? fetch;
	const source = parseGitHubSource(input.source);
	let url: string;
	if (source.kind === "file") {
		url = source.url;
	} else {
		if (!input.path) throw new Error("Choose which skill in the repository to install");
		const ref = source.ref ?? (await defaultBranch(source.owner, source.repo, input.signal, fetchImpl));
		url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/${input.path.replace(/^\/+/u, "")}`;
	}
	const text = await readMarkdown(await fetchText(url, "text/plain", input.signal, fetchImpl));
	const fallback = slugifySkillName(
		source.kind === "file" ? basename(dirname(source.path)) : basename(dirname(input.path ?? "")),
	);
	const parsed = parseSkillMarkdown(text, fallback);
	const name = slugifySkillName(parsed.name);
	if (!name || !SKILL_NAME.test(name)) throw new Error("That skill has no usable name");
	if (input.existingNames?.includes(name)) throw new Error(`Skill ${name} already exists`);

	const skillRoot = join(input.agentDir, "skills");
	await mkdir(skillRoot, { recursive: true });
	const agentRoot = await realpath(input.agentDir);
	const realRoot = await realpath(skillRoot);
	if (!isInside(agentRoot, realRoot)) {
		throw new Error("The agent skills directory resolves outside the agent directory");
	}
	const directory = join(realRoot, name);
	try {
		await lstat(directory);
		throw new Error(`Skill ${name} already exists`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(directory, { recursive: false });
	const target = join(directory, "SKILL.md");
	await writeFile(target, text, { encoding: "utf8", mode: 0o600 });
	return { path: target, name };
}

function isInside(root: string, file: string): boolean {
	if (file === root) return true;
	const prefix = root.endsWith("/") || root.endsWith("\\") ? root : `${root}/`;
	return file.startsWith(prefix);
}
