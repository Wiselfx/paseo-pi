import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ManagementContext } from "./management";
import { readPiSettings, readPrompt, savePiSettings, writePrompt } from "./management";

async function projectPiDir(cwdInput: string): Promise<{ cwd: string; piDir: string }> {
	const cwd = cwdInput.trim();
	if (!isAbsolute(cwd)) throw new Error("The project directory must be an absolute path");
	if (cwd.includes("\0")) throw new Error("The project directory contains an invalid character");
	const realCwd = await realpath(cwd).catch(() => {
		throw new Error(`Project directory does not exist: ${cwd}`);
	});
	if (!(await stat(realCwd)).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
	const piDir = join(realCwd, ".pi");
	try {
		const info = await lstat(piDir);
		if (info.isSymbolicLink()) throw new Error("The project .pi directory is a symlink; edit it in place");
		if (!info.isDirectory()) throw new Error("The project .pi path is not a directory");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return { cwd: realCwd, piDir };
}

async function ensureSafeSettingsFile(piDir: string): Promise<void> {
	await mkdir(piDir, { recursive: true, mode: 0o700 });
	const path = join(piDir, "settings.json");
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) throw new Error("The project settings file is a symlink; edit it in place");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function ensureSafePromptFile(piDir: string): Promise<void> {
	await mkdir(piDir, { recursive: true, mode: 0o700 });
	const path = join(piDir, "APPEND_SYSTEM.md");
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) throw new Error("The project prompt file is a symlink; edit it in place");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function readProject(context: ManagementContext, input: { cwd: string }) {
	const { cwd, piDir } = await projectPiDir(input.cwd);
	const settings = await readPiSettings(piDir);
	const prompt = await readPrompt({ ...context, agentDir: piDir }, "append");
	return {
		cwd,
		settingsPath: settings.path,
		revision: settings.revision,
		settings: settings.settings,
		promptPath: prompt.path,
		promptRevision: prompt.revision,
		prompt: prompt.content,
	};
}

export async function saveProjectSettings(
	context: ManagementContext,
	input: { cwd: string; revision: string; settings: Record<string, unknown> },
): Promise<{ cwd: string; revision: string }> {
	const { cwd, piDir } = await projectPiDir(input.cwd);
	await ensureSafeSettingsFile(piDir);
	const saved = await savePiSettings({
		agentDir: piDir,
		revision: input.revision,
		settings: input.settings,
	});
	return { cwd, revision: saved.revision };
}

export async function saveProjectPrompt(
	context: ManagementContext,
	input: { cwd: string; revision: string; content: string },
): Promise<{ cwd: string; revision: string }> {
	const { cwd, piDir } = await projectPiDir(input.cwd);
	await ensureSafePromptFile(piDir);
	const saved = await writePrompt({
		context: { ...context, agentDir: piDir },
		kind: "append",
		revision: input.revision,
		content: input.content,
	});
	return { cwd, revision: saved.revision };
}
