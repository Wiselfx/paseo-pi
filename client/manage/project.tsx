import { useRpc } from "@getpaseo/plugin/client";
import { useState } from "react";
import { View } from "react-native";
import {
	piReadProjectRpc,
	piSaveProjectPromptRpc,
	piSaveProjectSettingsRpc,
} from "../../shared/management";
import {
	Button,
	Card,
	EmptyState,
	Field,
	Notice,
	Row,
	Section,
	TextArea,
	TextField,
	type ManageStyles,
} from "./shared";

function formatJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function ProjectTab({ styles }: { styles: ManageStyles }) {
	const readRpc = useRpc(piReadProjectRpc);
	const saveSettingsRpc = useRpc(piSaveProjectSettingsRpc);
	const savePromptRpc = useRpc(piSaveProjectPromptRpc);
	const [cwd, setCwd] = useState("");
	const [openCwd, setOpenCwd] = useState("");
	const [settingsPath, setSettingsPath] = useState("");
	const [settingsText, setSettingsText] = useState("");
	const [settingsRevision, setSettingsRevision] = useState("");
	const [promptPath, setPromptPath] = useState("");
	const [prompt, setPrompt] = useState("");
	const [promptRevision, setPromptRevision] = useState("");
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const open = async () => {
		setLoading(true);
		setError(null);
		setNotice(null);
		try {
			const project = await readRpc({ cwd: cwd.trim() });
			setOpenCwd(project.cwd);
			setSettingsPath(project.settingsPath);
			setSettingsText(formatJson(project.settings));
			setSettingsRevision(project.revision);
			setPromptPath(project.promptPath);
			setPrompt(project.prompt);
			setPromptRevision(project.promptRevision);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setLoading(false);
		}
	};

	const saveSettings = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			let parsed: unknown;
			try {
				parsed = JSON.parse(settingsText);
			} catch (failure) {
				throw new Error(`settings.json is not valid JSON: ${failure instanceof Error ? failure.message : String(failure)}`);
			}
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Project settings must be a JSON object");
			}
			const saved = await saveSettingsRpc({
				cwd: openCwd,
				revision: settingsRevision,
				settings: parsed as Record<string, unknown>,
			});
			setSettingsRevision(saved.revision);
			setSettingsText(formatJson(parsed));
			setNotice("Project settings saved. New sessions in this directory use them after project trust.");
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const savePrompt = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const saved = await savePromptRpc({
				cwd: openCwd,
				revision: promptRevision,
				content: prompt,
			});
			setPromptRevision(saved.revision);
			setNotice("Project prompt saved. New sessions in this directory use it after project trust.");
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Notice styles={styles} message={error} tone="error" />
			<Notice styles={styles} message={notice} tone="ok" />

			<Section
				styles={styles}
				title="Project"
				hint="Project configuration lives in .pi under the working directory. Pi loads it after you trust the project."
			>
				<Card styles={styles}>
					<View style={styles.form}>
						<Field
							styles={styles}
							label="Working directory"
							hint="The project whose .pi/settings.json and .pi/APPEND_SYSTEM.md you want to edit."
						>
							<View style={styles.inline}>
								<View style={styles.grow}>
									<TextField
										styles={styles}
										value={cwd}
										onChangeText={setCwd}
										placeholder="/path/to/project"
										autoCapitalize="none"
									/>
								</View>
								<Button
									styles={styles}
									label={loading ? "Opening…" : "Open"}
									variant="primary"
									loading={loading}
									disabled={!cwd.trim()}
									onPress={() => void open()}
								/>
							</View>
						</Field>
						{openCwd ? (
							<Row
								styles={styles}
								title="Project root"
								hint="Settings apply only to sessions whose working directory is this project or a child of it."
								mono={openCwd}
							/>
						) : null}
					</View>
				</Card>
			</Section>

			{!openCwd ? (
				<Card styles={styles}>
					<EmptyState
						styles={styles}
						title="Choose a project"
						hint="Enter an absolute path above to edit its project-level Pi settings."
					/>
				</Card>
			) : (
				<>
					<Section styles={styles} title="Settings" hint={settingsPath}>
						<Card styles={styles}>
							<View style={styles.form}>
								<Field
									styles={styles}
									label=".pi/settings.json"
									hint="A JSON object merged over the user settings for this project. Project values take precedence."
								>
									<TextArea
										styles={styles}
										value={settingsText}
										onChangeText={setSettingsText}
										minHeight={280}
										accessibilityLabel="Project settings JSON"
									/>
								</Field>
								<View style={styles.formFooter}>
									<Button
										styles={styles}
										label="Save settings"
										variant="primary"
										loading={busy}
										onPress={() => void saveSettings()}
									/>
								</View>
							</View>
						</Card>
					</Section>

					<Section styles={styles} title="Project prompt" hint={promptPath}>
						<Card styles={styles}>
							<View style={styles.form}>
								<Field
									styles={styles}
									label=".pi/APPEND_SYSTEM.md"
									hint="Appended to the system prompt for sessions in this project. Leave empty to remove it."
								>
									<TextArea
										styles={styles}
										value={prompt}
										onChangeText={setPrompt}
										minHeight={200}
										accessibilityLabel="Project append system prompt"
									/>
								</Field>
								<View style={styles.formFooter}>
									<Button
										styles={styles}
										label="Save prompt"
										variant="primary"
										loading={busy}
										onPress={() => void savePrompt()}
									/>
								</View>
							</View>
						</Card>
					</Section>
				</>
			)}
		</>
	);
}
