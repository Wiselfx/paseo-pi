import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	inspectGitHubSkill,
	installGitHubSkill,
	parseGitHubSource,
	parseSkillMarkdown,
	slugifySkillName,
} from "../server/skill-source";

type Reply = { status?: number; body?: string };

function fakeFetch(routes: Record<string, Reply | (() => Reply)>): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const route = routes[url];
		if (!route) return new Response("not found", { status: 404 });
		const reply = typeof route === "function" ? route() : route;
		return new Response(reply.body ?? "", { status: reply.status ?? 200 });
	}) as typeof fetch;
}

const FILE = `---
name: pdf-tables
description: "Extract tables from PDF files."
---

# PDF tables
`;

describe("parseGitHubSource", () => {
	it.each([
		["github.com/owner/repo", { kind: "tree", owner: "owner", repo: "repo" }],
		["https://github.com/owner/repo.git", { kind: "tree", owner: "owner", repo: "repo" }],
		[
			"https://github.com/owner/repo/tree/dev/skills",
			{ kind: "tree", owner: "owner", repo: "repo", ref: "dev", path: "skills" },
		],
		[
			"https://github.com/owner/repo/blob/main/skills/pdf/SKILL.md",
			{
				kind: "file",
				owner: "owner",
				repo: "repo",
				ref: "main",
				path: "skills/pdf/SKILL.md",
				url: "https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md",
			},
		],
		[
			"https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md",
			{
				kind: "file",
				owner: "owner",
				repo: "repo",
				ref: "main",
				path: "skills/pdf/SKILL.md",
				url: "https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md",
			},
		],
	])("parses %s", (input, expected) => {
		expect(parseGitHubSource(input)).toMatchObject(expected);
	});

	it.each([
		"",
		"https://gitlab.com/owner/repo",
		"https://github.com/owner",
		"https://github.com/owner/repo/blob/main/README.txt",
		"https://github.com/owner/repo/blob/main",
		"not a link with spaces",
	])("rejects %s", (input) => {
		expect(() => parseGitHubSource(input)).toThrow();
	});
});

describe("parseSkillMarkdown", () => {
	it("reads quoted frontmatter and falls back to the directory name", () => {
		expect(parseSkillMarkdown(FILE, "fallback")).toEqual({
			name: "pdf-tables",
			description: "Extract tables from PDF files.",
		});
		expect(parseSkillMarkdown("# no frontmatter", "fallback")).toEqual({
			name: "fallback",
			description: "",
		});
	});

	it("reads block descriptions", () => {
		const text = "---\nname: x\ndescription: >\n  One long\n  sentence.\n---\n";
		expect(parseSkillMarkdown(text, "fallback").description).toBe("One long sentence.");
	});

	it("slugifies names", () => {
		expect(slugifySkillName("PDF Tables!")).toBe("pdf-tables");
		expect(slugifySkillName("...")).toBe("");
	});
});

describe("inspectGitHubSkill", () => {
	it("reads a single file link and marks it installed", async () => {
		const url = "https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md";
		const result = await inspectGitHubSkill({
			source: url,
			existingNames: ["pdf-tables"],
			fetch: fakeFetch({ [url]: { body: FILE } }),
		});
		expect(result.candidates).toEqual([
			{
				name: "pdf-tables",
				description: "Extract tables from PDF files.",
				path: "skills/pdf/SKILL.md",
				url,
				installed: true,
			},
		]);
	});

	it("finds every SKILL.md in a repository", async () => {
		const fetchImpl = fakeFetch({
			"https://api.github.com/repos/owner/repo": { body: JSON.stringify({ default_branch: "main" }) },
			"https://api.github.com/repos/owner/repo/git/trees/main?recursive=1": {
				body: JSON.stringify({
					tree: [
						{ path: "skills/pdf/SKILL.md", type: "blob" },
						{ path: "skills/other/SKILL.md", type: "blob" },
						{ path: "README.md", type: "blob" },
					],
				}),
			},
			"https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md": { body: FILE },
			"https://raw.githubusercontent.com/owner/repo/main/skills/other/SKILL.md": {
				body: "---\nname: other\ndescription: Another skill\n---\n",
			},
		});
		const result = await inspectGitHubSkill({ source: "owner/repo", fetch: fetchImpl });
		expect(result.candidates.map((candidate) => candidate.name).sort()).toEqual(["other", "pdf-tables"]);
	});

	it("keeps going when one file cannot be read", async () => {
		const result = await inspectGitHubSkill({
			source: "https://github.com/owner/repo",
			fetch: fakeFetch({
				"https://api.github.com/repos/owner/repo": { body: JSON.stringify({ default_branch: "main" }) },
				"https://api.github.com/repos/owner/repo/git/trees/main?recursive=1": {
					body: JSON.stringify({
						tree: [
							{ path: "skills/good/SKILL.md", type: "blob" },
							{ path: "skills/bad/SKILL.md", type: "blob" },
						],
					}),
				},
				"https://raw.githubusercontent.com/owner/repo/main/skills/good/SKILL.md": { body: FILE },
				"https://raw.githubusercontent.com/owner/repo/main/skills/bad/SKILL.md": { status: 404 },
			}),
		});
		expect(result.candidates.map((candidate) => candidate.name)).toContain("pdf-tables");
		expect(result.candidates.map((candidate) => candidate.name)).toContain("bad");
	});

	it("explains rate limits and empty repositories", async () => {
		await expect(
			inspectGitHubSkill({
				source: "owner/repo",
				fetch: fakeFetch({
					"https://api.github.com/repos/owner/repo": { status: 403, body: "{}" },
				}),
			}),
		).rejects.toThrow(/rate limit/u);
		await expect(
			inspectGitHubSkill({
				source: "owner/repo",
				fetch: fakeFetch({
					"https://api.github.com/repos/owner/repo": { body: JSON.stringify({ default_branch: "main" }) },
					"https://api.github.com/repos/owner/repo/git/trees/main?recursive=1": {
						body: JSON.stringify({ tree: [] }),
					},
				}),
			}),
		).rejects.toThrow(/No SKILL\.md/u);
	});
});

describe("installGitHubSkill", () => {
	it("writes <agentDir>/skills/<name>/SKILL.md with mode 0600", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "paseo-pi-skill-"));
		const url = "https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md";
		const result = await installGitHubSkill({
			source: url,
			agentDir,
			fetch: fakeFetch({ [url]: { body: FILE } }),
		});
		expect(result).toEqual({ name: "pdf-tables", path: join(agentDir, "skills", "pdf-tables", "SKILL.md") });
		expect(await readFile(result.path, "utf8")).toBe(FILE);
		expect((await stat(result.path)).mode & 0o777).toBe(0o600);
	});

	it("refuses a name that already exists", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "paseo-pi-skill-"));
		const url = "https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md";
		const fetchImpl = fakeFetch({ [url]: { body: FILE } });
		await installGitHubSkill({ source: url, agentDir, fetch: fetchImpl });
		await expect(
			installGitHubSkill({ source: url, agentDir, existingNames: ["pdf-tables"], fetch: fetchImpl }),
		).rejects.toThrow(/already exists/u);
	});

	it("installs a chosen file from a repository link", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "paseo-pi-skill-"));
		const result = await installGitHubSkill({
			source: "https://github.com/owner/repo",
			path: "skills/pdf/SKILL.md",
			agentDir,
			fetch: fakeFetch({
				"https://api.github.com/repos/owner/repo": { body: JSON.stringify({ default_branch: "main" }) },
				"https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md": { body: FILE },
			}),
		});
		expect(result.name).toBe("pdf-tables");
	});
});
