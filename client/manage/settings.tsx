import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	piReadSettingsRpc,
	piSaveSettingsRpc,
	type PiSettingsRecord,
} from "../../shared/management";
import {
	Button,
	Card,
	Field,
	Notice,
	Section,
	Switch,
	TextArea,
	TextField,
	type ManageStyles,
} from "./shared";

function textValue(record: PiSettingsRecord, key: string): string {
	const value = record[key];
	return typeof value === "string" ? value : "";
}

function listValue(record: PiSettingsRecord, key: string): string {
	const value = record[key];
	return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "";
}

function splitList(value: string): string[] {
	return value
		.split(/[,\n]/u)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function SettingsTab({ styles }: { styles: ManageStyles }) {
	const readRpc = useRpc(piReadSettingsRpc);
	const saveRpc = useRpc(piSaveSettingsRpc);

	const [path, setPath] = useState("");
	const [revision, setRevision] = useState<string | null>(null);
	const [record, setRecord] = useState<PiSettingsRecord>({});
	const [defaultProvider, setDefaultProvider] = useState("");
	const [defaultModel, setDefaultModel] = useState("");
	const [thinking, setThinking] = useState("");
	const [enabledModels, setEnabledModels] = useState("");
	const [defaultTools, setDefaultTools] = useState("");
	const [sessionDir, setSessionDir] = useState("");
	const [skillCommands, setSkillCommands] = useState(true);
	const [raw, setRaw] = useState("");
	const [showRaw, setShowRaw] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const apply = (next: PiSettingsRecord) => {
		setRecord(next);
		setDefaultProvider(textValue(next, "defaultProvider"));
		setDefaultModel(textValue(next, "defaultModel"));
		setThinking(textValue(next, "defaultThinkingLevel"));
		setEnabledModels(listValue(next, "enabledModels"));
		setDefaultTools(listValue(next, "defaultTools"));
		setSessionDir(textValue(next, "sessionDir"));
		setSkillCommands(next.enableSkillCommands !== false);
		setRaw(`${JSON.stringify(next, null, 2)}\n`);
	};

	const load = async () => {
		setError(null);
		try {
			const data = await readRpc({});
			setPath(data.path);
			setRevision(data.revision);
			apply(data.settings);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	};

	useEffect(() => {
		void load();
		// Loaded once; saves reload explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const setOrDelete = (next: PiSettingsRecord, key: string, value: string) => {
		if (value.trim()) next[key] = value.trim();
		else delete next[key];
	};

	const save = async (override?: PiSettingsRecord) => {
		if (!revision) return;
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const next: PiSettingsRecord = override ? { ...override } : { ...record };
			if (!override) {
				setOrDelete(next, "defaultProvider", defaultProvider);
				setOrDelete(next, "defaultModel", defaultModel);
				setOrDelete(next, "defaultThinkingLevel", thinking);
				setOrDelete(next, "sessionDir", sessionDir);
				const models = splitList(enabledModels);
				if (models.length) next.enabledModels = models;
				else delete next.enabledModels;
				const tools = splitList(defaultTools);
				if (tools.length) next.defaultTools = tools;
				else delete next.defaultTools;
				if (skillCommands) delete next.enableSkillCommands;
				else next.enableSkillCommands = false;
			}
			const saved = await saveRpc({ revision, settings: next });
			setRevision(saved.revision);
			setNotice("Settings saved.");
			await load();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const applyRaw = () => {
		setError(null);
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Settings must be a JSON object.");
			}
			apply(parsed as PiSettingsRecord);
			setShowRaw(false);
			setNotice("JSON parsed. Save to write it.");
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	};

	return (
		<>
			<Notice styles={styles} message={error} tone="error" />

			<Section
				styles={styles}
				title="Pi settings"
				hint={path || "Written to the pi agent directory"}
				trailing={
					<Button
						styles={styles}
						label="Reload"
						variant="outline"
						onPress={() => void load()}
						disabled={busy}
					/>
				}
			>
				<Card styles={styles}>
					<View style={styles.form}>
						<View style={styles.fieldGrid}>
							<View style={styles.fieldHalf}>
								<Field styles={styles} label="Default provider" hint="For example Zen. Empty lets pi choose.">
									<TextField
										styles={styles}
										value={defaultProvider}
										onChangeText={setDefaultProvider}
									/>
								</Field>
							</View>
							<View style={styles.fieldHalf}>
								<Field styles={styles} label="Default model">
									<TextField styles={styles} value={defaultModel} onChangeText={setDefaultModel} />
								</Field>
							</View>
						</View>
						<View style={styles.fieldGrid}>
							<View style={styles.fieldHalf}>
								<Field
									styles={styles}
									label="Thinking level"
									hint="off, minimal, low, medium, high, xhigh, or max."
								>
									<TextField styles={styles} value={thinking} onChangeText={setThinking} />
								</Field>
							</View>
							<View style={styles.fieldHalf}>
								<Field
									styles={styles}
									label="Session directory"
									hint="Empty uses the agent session directory."
								>
									<TextField styles={styles} value={sessionDir} onChangeText={setSessionDir} />
								</Field>
							</View>
						</View>
						<Field
							styles={styles}
							label="Enabled models"
							hint="Comma separated patterns. Empty enables all."
						>
							<TextField
								styles={styles}
								value={enabledModels}
								onChangeText={setEnabledModels}
							/>
						</Field>
						<Field
							styles={styles}
							label="Default tools"
							hint="Comma separated. Empty uses pi's defaults."
						>
							<TextField styles={styles} value={defaultTools} onChangeText={setDefaultTools} />
						</Field>
						<View style={styles.toggleRow}>
							<View style={styles.toggleText}>
								<Text style={styles.label}>Register skills as slash commands</Text>
								<Text style={styles.hint}>Skills appear as /skill:name in the composer.</Text>
							</View>
							<Switch
								styles={styles}
								label="Register skills as slash commands"
								value={skillCommands}
								onChange={setSkillCommands}
							/>
						</View>
						<View style={styles.formFooter}>
							<Button
								styles={styles}
								label={busy ? "Saving…" : "Save settings"}
								variant="primary"
								loading={busy}
								disabled={!revision}
								onPress={() => void save()}
							/>
							<Button
								styles={styles}
								label={showRaw ? "Close JSON" : "Edit JSON"}
								variant="ghost"
								onPress={() => setShowRaw((value) => !value)}
							/>
							{notice ? <Text style={styles.small}>{notice}</Text> : null}
						</View>
					</View>
				</Card>
			</Section>

			{showRaw ? (
				<Section styles={styles} title="settings.json" hint={path || undefined}>
					<Card styles={styles}>
						<View style={styles.form}>
							<TextArea
								styles={styles}
								value={raw}
								onChangeText={setRaw}
								minHeight={280}
								accessibilityLabel="settings.json content"
							/>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label="Apply to form"
									variant="outline"
									onPress={applyRaw}
								/>
								<Button
									styles={styles}
									label="Reload from disk"
									variant="ghost"
									onPress={() => void load()}
								/>
							</View>
						</View>
					</Card>
				</Section>
			) : null}
		</>
	);
}
