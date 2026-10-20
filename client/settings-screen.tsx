import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { piSettings, type PiSettings } from "../shared/settings";
import {
	Button,
	Card,
	EmptyState,
	Field,
	Notice,
	Row,
	Section,
	Switch,
	TextField,
	useStyles,
} from "./manage/shared";

function splitList(value: string): string[] {
	return value
		.split(/[,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function PiSettingsScreen({ theme, layout }: PluginSurfaceProps) {
	const styles = useStyles(theme, layout.compact);
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
		return (
			<Section styles={styles} title="Process">
				<Card styles={styles}>
					<EmptyState styles={styles} title="Loading launch settings…" />
				</Card>
			</Section>
		);
	}
	if (state.status === "error" || state.status === "invalid") {
		return (
			<Section styles={styles} title="Process">
				<Card styles={styles}>
					<EmptyState
						styles={styles}
						title="Could not load launch settings"
						hint={state.error}
					/>
				</Card>
			</Section>
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
		await state.save(
			{ ...draft, args: splitList(argsText), inheritEnv: splitList(envText) },
			state.revision,
		);
	};

	return (
		<View style={{ gap: 28 }}>
			<Section
				styles={styles}
				title="Process"
				hint="What Paseo runs for a pi session. A per-agent launch can override the command and arguments."
			>
				<Card styles={styles}>
					<View style={styles.form}>
						<Field styles={styles} label="Command" hint="Executable on the daemon host.">
							<TextField
								styles={styles}
								value={values.command}
								onChangeText={(command) => update({ command })}
								placeholder="pi"
							/>
						</Field>
						<Field
							styles={styles}
							label="Arguments"
							hint="Comma separated, before the RPC flags."
						>
							<TextField
								styles={styles}
								value={argsText}
								onChangeText={setArgsText}
								placeholder="--provider Zen"
							/>
						</Field>
						<Field
							styles={styles}
							label="Session directory"
							hint="Empty uses pi's default at ~/.pi/agent/sessions."
						>
							<TextField
								styles={styles}
								value={values.sessionDir}
								onChangeText={(sessionDir) => update({ sessionDir })}
								placeholder="/home/me/.pi/agent/sessions"
							/>
						</Field>
						<Field
							styles={styles}
							label="Inherit env"
							hint="Comma separated names copied from the daemon environment."
						>
							<TextField
								styles={styles}
								value={envText}
								onChangeText={setEnvText}
								placeholder="OPENAI_API_KEY, ANTHROPIC_API_KEY"
							/>
						</Field>
					</View>
				</Card>
			</Section>

			<Section styles={styles} title="Resources">
				<Card styles={styles}>
					<Row
						styles={styles}
						title="Extensions & skills"
						hint="Each one has its own switch in Extensions & skills. Changes apply to new sessions."
					/>
					<Row
						styles={styles}
						title="Read context files"
						hint="AGENTS.md and CLAUDE.md."
						actions={
							<Switch
								styles={styles}
								label="Read context files"
								value={!values.noContextFiles}
								onChange={(enabled) => update({ noContextFiles: !enabled })}
							/>
						}
					/>
					<Row
						styles={styles}
						title="Use MCP servers"
						hint="From ~/.pi/agent/mcp.json and the project."
						actions={
							<Switch
								styles={styles}
								label="Use MCP servers"
								value={!values.noMcp}
								onChange={(enabled) => update({ noMcp: !enabled })}
							/>
						}
					/>
					<Row
						styles={styles}
						title="Reload command"
						hint="Adds /reload for settings, models, extensions, skills, prompts, and context files."
						actions={
							<Switch
								styles={styles}
								label="Reload command"
								value={values.reloadCommand}
								onChange={(enabled) => update({ reloadCommand: enabled })}
							/>
						}
					/>
				</Card>
			</Section>

			<Card styles={styles}>
				<View style={styles.form}>
					<Notice styles={styles} message={state.saveError} tone="error" />
					<View style={styles.formFooter}>
						<Button
							styles={styles}
							label={state.saving ? "Saving…" : "Save changes"}
							variant="primary"
							size="md"
							loading={state.saving}
							disabled={!dirty}
							onPress={() => void save()}
						/>
						<Text style={styles.small}>{dirty ? "Unsaved changes" : "All changes saved"}</Text>
					</View>
				</View>
			</Card>
		</View>
	);
}
