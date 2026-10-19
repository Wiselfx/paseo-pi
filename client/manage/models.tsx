import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	piDeleteModelRpc,
	piDeleteProviderRpc,
	piReadModelsRpc,
	piSaveModelRpc,
	piSaveModelsJsonRpc,
	piSaveProviderRpc,
	PI_MODELS_SECRET_MASK,
	type PiProviderEntry,
} from "../../shared/management";
import {
	Badge,
	Button,
	Card,
	ConfirmButton,
	Field,
	Notice,
	TextArea,
	TextField,
	Toggle,
	type ManageStyles,
} from "./shared";

interface ProviderDraft {
	originalName?: string;
	name: string;
	label: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	apiKeyTouched: boolean;
}

interface ModelDraft {
	provider: string;
	originalId?: string;
	id: string;
	name: string;
	reasoning: boolean;
	images: boolean;
	contextWindow: string;
	maxTokens: string;
}

const EMPTY_PROVIDER: ProviderDraft = {
	name: "",
	label: "",
	baseUrl: "",
	api: "",
	apiKey: "",
	apiKeyTouched: false,
};

function parsePositive(value: string): number | undefined {
	if (!value.trim()) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Not a positive number: ${value}`);
	return parsed;
}

export function ModelsTab({ styles }: { styles: ManageStyles }) {
	const readRpc = useRpc(piReadModelsRpc);
	const saveProviderRpc = useRpc(piSaveProviderRpc);
	const deleteProviderRpc = useRpc(piDeleteProviderRpc);
	const saveModelRpc = useRpc(piSaveModelRpc);
	const deleteModelRpc = useRpc(piDeleteModelRpc);
	const saveRawRpc = useRpc(piSaveModelsJsonRpc);

	const [providers, setProviders] = useState<PiProviderEntry[]>([]);
	const [revision, setRevision] = useState<string | null>(null);
	const [path, setPath] = useState("");
	const [raw, setRaw] = useState("");
	const [showRaw, setShowRaw] = useState(false);
	const [provider, setProvider] = useState<ProviderDraft | null>(null);
	const [modelsFor, setModelsFor] = useState<ModelDraft | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = async () => {
		setError(null);
		try {
			const data = await readRpc({});
			setProviders(data.providers);
			setRevision(data.revision);
			setPath(data.path);
			setRaw(data.raw);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	};

	useEffect(() => {
		void load();
		// Loaded once; mutations reload explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await action();
			await load();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const saveProvider = () =>
		void run(async () => {
			if (!provider || !revision) return;
			await saveProviderRpc({
				revision,
				...(provider.originalName ? { originalName: provider.originalName } : {}),
				provider: {
					name: provider.name.trim(),
					label: provider.label,
					baseUrl: provider.baseUrl,
					api: provider.api,
					...(provider.apiKeyTouched ? { apiKey: provider.apiKey } : {}),
				},
			});
			setProvider(null);
			setNotice("Provider saved.");
		});

	const saveModel = () =>
		void run(async () => {
			if (!modelsFor || !revision) return;
			await saveModelRpc({
				revision,
				provider: modelsFor.provider,
				...(modelsFor.originalId ? { originalId: modelsFor.originalId } : {}),
				model: {
					id: modelsFor.id.trim(),
					name: modelsFor.name,
					reasoning: modelsFor.reasoning,
					input: modelsFor.images ? ["text", "image"] : ["text"],
					contextWindow: parsePositive(modelsFor.contextWindow) ?? null,
					maxTokens: parsePositive(modelsFor.maxTokens) ?? null,
				},
			});
			setModelsFor(null);
			setNotice("Model saved.");
		});

	const saveRaw = () =>
		void run(async () => {
			if (!revision) return;
			await saveRawRpc({ revision, json: raw });
			setShowRaw(false);
			setNotice("models.json saved.");
		});

	const editProvider = (entry: PiProviderEntry) => {
		setProvider({
			originalName: entry.name,
			name: entry.name,
			label: entry.label ?? "",
			baseUrl: entry.baseUrl ?? "",
			api: entry.api ?? "",
			apiKey: "",
			apiKeyTouched: false,
		});
		setModelsFor(null);
	};

	const addProvider = () => {
		setProvider({ ...EMPTY_PROVIDER });
		setModelsFor(null);
	};

	const addModel = (entry: PiProviderEntry) => {
		setModelsFor({
			provider: entry.name,
			id: "",
			name: "",
			reasoning: false,
			images: false,
			contextWindow: "",
			maxTokens: "",
		});
		setProvider(null);
	};

	const editModel = (entry: PiProviderEntry, model: PiProviderEntry["models"][number]) => {
		setModelsFor({
			provider: entry.name,
			originalId: model.id,
			id: model.id,
			name: model.name ?? "",
			reasoning: model.reasoning,
			images: model.input.includes("image"),
			contextWindow: model.contextWindow ? String(model.contextWindow) : "",
			maxTokens: model.maxTokens ? String(model.maxTokens) : "",
		});
		setProvider(null);
	};

	return (
		<>
			<Card
				styles={styles}
				title="Providers & models"
				trailing={
					<View style={styles.wrap}>
						<Button styles={styles} label="Reload" onPress={() => void load()} disabled={busy} />
						<Button styles={styles} label="Add provider" primary onPress={addProvider} />
					</View>
				}
			>
				<Text style={styles.muted}>
					{path || "models.json"} adds OpenAI-, Anthropic-, and Google-compatible endpoints. A key is never
					returned; leave it blank while editing to keep the stored value.
				</Text>
				<Notice styles={styles} message={error} tone="error" />
				<Notice styles={styles} message={notice} tone="ok" />

			{provider ? (
				<Card styles={styles} title={provider.originalName ? "Edit provider" : "Add provider"}>
					<Field styles={styles} label="Provider ID" hint="Used as provider/model. Letters, numbers, dots, dashes.">
						<TextField
							styles={styles}
							value={provider.name}
							onChangeText={(name) => setProvider({ ...provider, name })}
							placeholder="ollama"
						/>
					</Field>
					<Field styles={styles} label="Display name">
						<TextField
							styles={styles}
							value={provider.label}
							onChangeText={(label) => setProvider({ ...provider, label })}
							placeholder="Ollama"
							autoCapitalize="sentences"
						/>
					</Field>
					<Field styles={styles} label="Base URL">
						<TextField
							styles={styles}
							value={provider.baseUrl}
							onChangeText={(baseUrl) => setProvider({ ...provider, baseUrl })}
							placeholder="http://localhost:11434/v1"
						/>
					</Field>
					<Field styles={styles} label="API" hint="openai-completions, openai-responses, anthropic-messages, google-generative-ai">
						<TextField
							styles={styles}
							value={provider.api}
							onChangeText={(api) => setProvider({ ...provider, api })}
							placeholder="openai-completions"
						/>
					</Field>
					<Field
						styles={styles}
						label="API key"
						hint={
							provider.apiKeyTouched
								? "Blank clears the stored key."
								: "Blank keeps the stored key. $NAME reads an environment variable."
						}
					>
						<TextField
							styles={styles}
							value={provider.apiKey}
							onChangeText={(apiKey) => setProvider({ ...provider, apiKey, apiKeyTouched: true })}
							placeholder="$OPENAI_API_KEY"
							secure
						/>
					</Field>
					<View style={styles.wrap}>
						<Button
							styles={styles}
							label={busy ? "Saving..." : "Save provider"}
							primary
							disabled={busy || !provider.name.trim()}
							onPress={saveProvider}
						/>
						<Button styles={styles} label="Cancel" onPress={() => setProvider(null)} />
					</View>
				</Card>
			) : null}

			{modelsFor ? (
				<Card
					styles={styles}
					title={`${modelsFor.originalId ? "Edit" : "Add"} model in ${modelsFor.provider}`}
				>
					<Field styles={styles} label="Model ID" hint="The ID sent to the API.">
						<TextField
							styles={styles}
							value={modelsFor.id}
							onChangeText={(id) => setModelsFor({ ...modelsFor, id })}
							placeholder="qwen2.5-coder:7b"
						/>
					</Field>
					<Field styles={styles} label="Display name">
						<TextField
							styles={styles}
							value={modelsFor.name}
							onChangeText={(name) => setModelsFor({ ...modelsFor, name })}
							autoCapitalize="sentences"
						/>
					</Field>
					<View style={styles.row}>
						<View style={{ flex: 1 }}>
							<Toggle
								styles={styles}
								label="Reasoning"
								value={modelsFor.reasoning}
								onChange={(reasoning) => setModelsFor({ ...modelsFor, reasoning })}
							/>
						</View>
						<View style={{ flex: 1 }}>
							<Toggle
								styles={styles}
								label="Images"
								value={modelsFor.images}
								onChange={(images) => setModelsFor({ ...modelsFor, images })}
							/>
						</View>
					</View>
					<Field styles={styles} label="Context window" hint="Tokens. Empty uses pi's default.">
						<TextField
							styles={styles}
							value={modelsFor.contextWindow}
							onChangeText={(contextWindow) => setModelsFor({ ...modelsFor, contextWindow })}
							placeholder="128000"
						/>
					</Field>
					<Field styles={styles} label="Max output tokens">
						<TextField
							styles={styles}
							value={modelsFor.maxTokens}
							onChangeText={(maxTokens) => setModelsFor({ ...modelsFor, maxTokens })}
							placeholder="16384"
						/>
					</Field>
					<View style={styles.wrap}>
						<Button
							styles={styles}
							label={busy ? "Saving..." : "Save model"}
							primary
							disabled={busy || !modelsFor.id.trim()}
							onPress={saveModel}
						/>
						<Button styles={styles} label="Cancel" onPress={() => setModelsFor(null)} />
					</View>
				</Card>
			) : null}

				{providers.length === 0 ? <Text style={styles.muted}>No providers in models.json yet.</Text> : null}
				{providers.map((entry) => (
					<View key={entry.name} style={styles.item}>
						<View style={styles.between}>
							<View style={{ flex: 1, gap: 2 }}>
								<View style={styles.wrap}>
									<Text style={styles.text}>{entry.label ?? entry.name}</Text>
									<Badge styles={styles} label={entry.name} />
									{entry.apiKeySet ? <Badge styles={styles} label="key set" /> : null}
								</View>
								{entry.baseUrl ? <Text style={styles.mono}>{entry.baseUrl}</Text> : null}
								{entry.api ? <Text style={styles.muted}>{entry.api}</Text> : null}
							</View>
							<View style={styles.wrap}>
								<Button styles={styles} label="Edit" onPress={() => editProvider(entry)} disabled={busy} />
								<ConfirmButton
									styles={styles}
									label="Remove"
									confirmLabel="Confirm remove"
									disabled={busy}
									onConfirm={() =>
										void run(async () => {
											if (!revision) return;
											await deleteProviderRpc({ revision, name: entry.name });
											setNotice("Provider removed.");
										})
									}
								/>
							</View>
						</View>

						{entry.models.map((model) => (
							<View key={`${entry.name}/${model.id}`} style={[styles.between, { paddingLeft: 10 }]}>
								<View style={{ flex: 1 }}>
									<Text style={styles.text}>{model.name ?? model.id}</Text>
									<Text style={styles.mono}>{model.id}</Text>
									<View style={styles.wrap}>
										{model.reasoning ? <Badge styles={styles} label="reasoning" /> : null}
										{model.input.includes("image") ? <Badge styles={styles} label="vision" /> : null}
										{model.contextWindow ? <Badge styles={styles} label={`${model.contextWindow} ctx`} /> : null}
									</View>
								</View>
								<View style={styles.wrap}>
									<Button styles={styles} label="Edit" onPress={() => editModel(entry, model)} disabled={busy} />
									<ConfirmButton
										styles={styles}
										label="Delete"
										confirmLabel="Confirm delete"
										disabled={busy}
										onConfirm={() =>
											void run(async () => {
												if (!revision) return;
												await deleteModelRpc({ revision, provider: entry.name, id: model.id });
												setNotice("Model deleted.");
											})
										}
									/>
								</View>
							</View>
						))}

						<View style={styles.wrap}>
							<Button styles={styles} label="Add model" onPress={() => addModel(entry)} disabled={busy} />
						</View>
					</View>
				))}
			</Card>

			<Card
				styles={styles}
				title="models.json"
				trailing={
					<Button
						styles={styles}
						label={showRaw ? "Hide editor" : "Raw editor"}
						onPress={() => setShowRaw((value) => !value)}
					/>
				}
			>
				<Text style={styles.muted}>
					The raw editor keeps fields this form does not show, such as headers, cost, compat, and
					modelOverrides. Secret-looking values appear as {PI_MODELS_SECRET_MASK} and are restored when saved.
				</Text>
				{showRaw ? (
					<>
						<TextArea styles={styles} value={raw} onChangeText={setRaw} minHeight={340} />
						<View style={styles.wrap}>
							<Button
								styles={styles}
								label={busy ? "Saving..." : "Save JSON"}
								primary
								disabled={busy}
								onPress={saveRaw}
							/>
							<Button styles={styles} label="Discard changes" onPress={() => void load()} disabled={busy} />
						</View>
					</>
				) : null}
			</Card>
		</>
	);
}
