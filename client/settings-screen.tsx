import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
	SettingsAction,
	SettingsInput,
	SettingsRow,
	SettingsSection,
	SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { piSettings, type PiSettings } from "../shared/settings";

function splitList(value: string): string[] {
	return value
		.split(/[,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function PiSettingsScreen({ theme }: PluginSurfaceProps) {
	const state = useSettings(piSettings);
	const [draft, setDraft] = useState<PiSettings | null>(null);
	const [argsText, setArgsText] = useState("");
	const [envText, setEnvText] = useState("");

	useEffect(() => {
		if (state.status !== "ready") return;
		setDraft(state.values);
		setArgsText(state.values.args.join(", "));
		setEnvText(state.values.inheritEnv.join(", "));
	}, [state.status, state.status === "ready" ? state.revision : ""]);

	const update = (patch: Partial<PiSettings>) => {
		setDraft((current) => (current ? { ...current, ...patch } : current));
	};

	if (state.status === "loading") {
		return <Text style={{ color: theme.colors.foregroundMuted }}>Loading settings...</Text>;
	}
	if (state.status === "error" || state.status === "invalid") {
		return (
			<Text style={{ color: theme.colors.statusDanger }}>
				{state.status === "error" ? state.error : state.error}
			</Text>
		);
	}

	const values = draft ?? state.values;
	const dirty =
		JSON.stringify({
			...values,
			args: splitList(argsText),
			inheritEnv: splitList(envText),
		}) !== JSON.stringify(state.values);
	const save = async () => {
		if (!draft) return;
		await state.save({ ...draft, args: splitList(argsText), inheritEnv: splitList(envText) }, state.revision);
	};

	return (
		<SettingsSection
			title="Pi launch"
			info="What Paseo runs and which resources pi loads. A per-agent launch overrides the command and arguments."
		>
			<SettingsRow label="Command" hint="Executable on the daemon host">
				<SettingsInput
					label="Command"
					key={`command-${state.revision}`}
					initialValue={values.command}
					onChangeText={(command) => update({ command })}
					placeholder="pi"
				/>
			</SettingsRow>
			<SettingsRow label="Arguments" hint="Comma separated, before the RPC flags">
				<SettingsInput
					label="Arguments"
					key={`args-${state.revision}`}
					initialValue={argsText}
					onChangeText={setArgsText}
					placeholder="--no-extensions"
				/>
			</SettingsRow>
			<SettingsRow label="Session directory" hint="Empty uses pi's default (~/.pi/agent/sessions)">
				<SettingsInput
					label="Session directory"
					key={`dir-${state.revision}`}
					initialValue={values.sessionDir}
					onChangeText={(sessionDir) => update({ sessionDir })}
					placeholder="/home/me/.pi/agent/sessions"
				/>
			</SettingsRow>
			<SettingsRow label="Inherit env" hint="Comma separated names copied from the daemon environment">
				<SettingsInput
					label="Inherit env"
					key={`env-${state.revision}`}
					initialValue={envText}
					onChangeText={setEnvText}
					placeholder="OPENAI_API_KEY, ANTHROPIC_API_KEY"
				/>
			</SettingsRow>
			<SettingsSwitch
				label="Use extensions"
				hint="Extensions, including pi's built-in ones"
				value={!values.noExtensions}
				onValueChange={(enabled) => update({ noExtensions: !enabled })}
			/>
			<SettingsSwitch
				label="Use skills"
				value={!values.noSkills}
				onValueChange={(enabled) => update({ noSkills: !enabled })}
			/>
			<SettingsSwitch
				label="Read context files"
				hint="AGENTS.md and CLAUDE.md"
				value={!values.noContextFiles}
				onValueChange={(enabled) => update({ noContextFiles: !enabled })}
			/>
			<SettingsSwitch
				label="Use MCP servers"
				hint="From ~/.pi/agent/mcp.json and the project"
				value={!values.noMcp}
				onValueChange={(enabled) => update({ noMcp: !enabled })}
			/>
			<SettingsSwitch
				label="Reload command"
				hint="Adds /reload for settings, models, extensions, skills, prompts and context files"
				value={values.reloadCommand}
				onValueChange={(enabled) => update({ reloadCommand: enabled })}
			/>
			<SettingsAction
				label="Save"
				actionLabel={state.saving ? "Saving..." : dirty ? "Save" : "Saved"}
				onPress={() => void save()}
				disabled={state.saving || !dirty}
			/>
			{state.saveError ? (
				<Text style={{ color: theme.colors.statusDanger }}>{state.saveError}</Text>
			) : null}
		</SettingsSection>
	);
}
