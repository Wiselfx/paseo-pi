import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	piAddModelsRpc,
	piDeleteModelRpc,
	piDeleteProviderRpc,
	piFetchModelsRpc,
	piReadModelsRpc,
	piSaveModelRpc,
	piSaveModelsJsonRpc,
	piSaveProviderRpc,
	PI_MODELS_SECRET_MASK,
	type PiFetchedModel,
	type PiProviderEntry,
} from "../../shared/management";
import {
	Badge,
	Button,
	Card,
	ConfirmButton,
	EmptyState,
	Field,
	Notice,
	Row,
	Section,
	Switch,
	TextArea,
	TextField,
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
	const fetchModelsRpc = useRpc(piFetchModelsRpc);
	const addModelsRpc = useRpc(piAddModelsRpc);

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
	const [loading, setLoading] = useState(true);
	const [fetching, setFetching] = useState<{
		provider: string;
		api: string;
		baseUrl: string;
		models: PiFetchedModel[];
	} | null>(null);
	const [selected, setSelected] = useState<Record<string, boolean>>({});
	const [modelFilter, setModelFilter] = useState("");

	const load = async () => {
		setError(null);
		setLoading(true);
		try {
			const data = await readRpc({});
			setProviders(data.providers);
			setRevision(data.revision);
			setPath(data.path);
			setRaw(data.raw);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setLoading(false);
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

	const fetchModels = (entry: PiProviderEntry) =>
		void run(async () => {
			const result = await fetchModelsRpc({ provider: entry.name });
			if (result.models.length === 0) {
				setFetching(null);
				setNotice(`${entry.name} returned no models.`);
				return;
			}
			setFetching({
				provider: entry.name,
				api: result.api,
				baseUrl: result.baseUrl,
				models: result.models,
			});
			setModelFilter("");
			setSelected({});
			setNotice(`${result.models.length} models offered by ${entry.name}.`);
		});

	const addSelectedModels = () =>
		void run(async () => {
			if (!fetching || !revision) return;
			const models = fetching.models.filter((model) => selected[model.id]);
			if (models.length === 0) return;
			const result = await addModelsRpc({
				revision,
				provider: fetching.provider,
				models,
			});
			setRevision(result.revision);
			setFetching(null);
			setSelected({});
			setNotice(
				`Added ${result.added} model${result.added === 1 ? "" : "s"}` +
					(result.skipped ? `; ${result.skipped} already existed.` : "."),
			);
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

	const matchesFilter = (model: PiFetchedModel) =>
		`${model.id} ${model.name ?? ""}`.toLowerCase().includes(modelFilter.trim().toLowerCase());
	const shown = fetching?.models.filter(matchesFilter) ?? [];
	const isInstalled = (id: string) =>
		providers.find((entry) => entry.name === fetching?.provider)?.models.some((model) => model.id === id) ??
		false;
	const shownInstallable = shown.filter((model) => !isInstalled(model.id));
	const selectedCount = fetching?.models.filter((model) => selected[model.id]).length ?? 0;

	return (
		<>
			<Notice styles={styles} message={error} tone="error" />
			<Notice styles={styles} message={notice} tone="ok" />

			{fetching ? (
				<Section
					styles={styles}
					title={`Add models from ${fetching.provider}`}
					hint={`${fetching.api} at ${fetching.baseUrl}. Pick the models pi should know about.`}
					trailing={
						<Button
							styles={styles}
							label="Cancel"
							variant="ghost"
							onPress={() => {
								setFetching(null);
								setSelected({});
							}}
						/>
					}
				>
					<Card styles={styles}>
						<View style={styles.form}>
							<View style={styles.inline}>
								<View style={styles.grow}>
									<TextField
										styles={styles}
										value={modelFilter}
										onChangeText={setModelFilter}
										placeholder="Filter models"
										accessibilityLabel="Filter models"
									/>
								</View>
								<Button
									styles={styles}
									label="Select all shown"
									variant="ghost"
									disabled={busy || shownInstallable.length === 0}
									onPress={() =>
										setSelected(
											Object.fromEntries(shownInstallable.map((model) => [model.id, true])),
										)
									}
								/>
								<Button
									styles={styles}
									label="Clear"
									variant="ghost"
									disabled={busy || selectedCount === 0}
									onPress={() => setSelected({})}
								/>
							</View>
						</View>
						{shown.length === 0 ? (
							<EmptyState styles={styles} title="No models match that filter" />
						) : (
							shown.map((model) => {
								const installed = isInstalled(model.id);
								return (
									<Row
										key={model.id}
										styles={styles}
										title={model.name ?? model.id}
										mono={model.name && model.name !== model.id ? model.id : undefined}
										badges={
											<>
												{model.contextWindow ? (
													<Badge styles={styles} label={`${model.contextWindow} ctx`} />
												) : null}
												{model.maxTokens ? (
													<Badge styles={styles} label={`${model.maxTokens} out`} />
												) : null}
												{model.input?.includes("image") ? <Badge styles={styles} label="vision" /> : null}
												{model.reasoning ? <Badge styles={styles} label="reasoning" /> : null}
												{installed ? <Badge styles={styles} label="installed" /> : null}
											</>
										}
										actions={
											<Switch
												styles={styles}
												label={`Add ${model.id}`}
												value={installed || selected[model.id] === true}
												disabled={busy || installed}
												onChange={(value) =>
													setSelected((current) => ({ ...current, [model.id]: value }))
												}
											/>
										}
									/>
								);
							})
						)}
						<View style={styles.form}>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label={
										busy
											? "Adding…"
											: `Add selected${selectedCount ? ` (${selectedCount})` : ""}`
									}
									variant="primary"
									loading={busy}
									disabled={selectedCount === 0}
									onPress={addSelectedModels}
								/>
								<Button
									styles={styles}
									label="Cancel"
									variant="ghost"
									disabled={busy}
									onPress={() => {
										setFetching(null);
										setSelected({});
									}}
								/>
							</View>
						</View>
					</Card>
				</Section>
			) : null}

			<Section
				styles={styles}
				title="Providers"
				hint={`Endpoints in ${path || "models.json"}. Keys are never returned.`}
				trailing={
					<>
						<Button
							styles={styles}
							label="Reload"
							variant="ghost"
							onPress={() => void load()}
							disabled={busy || loading}
						/>
						<Button
							styles={styles}
							label={provider ? "Close" : "Add provider"}
							variant="outline"
							disabled={loading}
							onPress={() => (provider ? setProvider(null) : addProvider())}
						/>
					</>
				}
			>
				{provider ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Text style={styles.rowTitle}>
								{provider.originalName ? "Edit provider" : "New provider"}
							</Text>
							<View style={styles.fieldGrid}>
								<View style={styles.fieldHalf}>
									<Field
										styles={styles}
										label="Provider ID"
										hint="Used as provider/model. Letters, numbers, dots, and dashes."
									>
										<TextField
											styles={styles}
											value={provider.name}
											onChangeText={(name) => setProvider({ ...provider, name })}
											placeholder="ollama"
										/>
									</Field>
								</View>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Display name">
										<TextField
											styles={styles}
											value={provider.label}
											onChangeText={(label) => setProvider({ ...provider, label })}
											placeholder="Ollama"
											autoCapitalize="sentences"
										/>
									</Field>
								</View>
							</View>
							<Field styles={styles} label="Base URL">
								<TextField
									styles={styles}
									value={provider.baseUrl}
									onChangeText={(baseUrl) => setProvider({ ...provider, baseUrl })}
									placeholder="http://localhost:11434/v1"
								/>
							</Field>
							<View style={styles.fieldGrid}>
								<View style={styles.fieldHalf}>
									<Field
										styles={styles}
										label="API"
										hint="openai-completions, openai-responses, anthropic-messages, or google-generative-ai."
									>
										<TextField
											styles={styles}
											value={provider.api}
											onChangeText={(api) => setProvider({ ...provider, api })}
											placeholder="openai-completions"
										/>
									</Field>
								</View>
								<View style={styles.fieldHalf}>
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
											onChangeText={(apiKey) =>
												setProvider({ ...provider, apiKey, apiKeyTouched: true })
											}
											placeholder="$OPENAI_API_KEY"
											secure
										/>
									</Field>
								</View>
							</View>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label={busy ? "Saving…" : "Save provider"}
									variant="primary"
									loading={busy}
									disabled={!provider.name.trim()}
									onPress={saveProvider}
								/>
								<Button
									styles={styles}
									label="Cancel"
									variant="ghost"
									onPress={() => setProvider(null)}
								/>
							</View>
						</View>
					</Card>
				) : null}

				{modelsFor ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Text style={styles.rowTitle}>
								{modelsFor.originalId ? "Edit model" : "New model"} in {modelsFor.provider}
							</Text>
							<View style={styles.fieldGrid}>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Model ID" hint="The ID sent to the API.">
										<TextField
											styles={styles}
											value={modelsFor.id}
											onChangeText={(id) => setModelsFor({ ...modelsFor, id })}
											placeholder="qwen2.5-coder:7b"
										/>
									</Field>
								</View>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Display name">
										<TextField
											styles={styles}
											value={modelsFor.name}
											onChangeText={(name) => setModelsFor({ ...modelsFor, name })}
											autoCapitalize="sentences"
										/>
									</Field>
								</View>
							</View>
							<View style={styles.fieldGrid}>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Context window" hint="Tokens. Empty uses pi's default.">
										<TextField
											styles={styles}
											value={modelsFor.contextWindow}
											onChangeText={(contextWindow) =>
												setModelsFor({ ...modelsFor, contextWindow })
											}
											placeholder="128000"
										/>
									</Field>
								</View>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Max output tokens">
										<TextField
											styles={styles}
											value={modelsFor.maxTokens}
											onChangeText={(maxTokens) => setModelsFor({ ...modelsFor, maxTokens })}
											placeholder="16384"
										/>
									</Field>
								</View>
							</View>
							<View style={styles.fieldGrid}>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Reasoning" hint="The model emits thinking.">
										<Switch
											styles={styles}
											label="Reasoning"
											value={modelsFor.reasoning}
											onChange={(reasoning) => setModelsFor({ ...modelsFor, reasoning })}
										/>
									</Field>
								</View>
								<View style={styles.fieldHalf}>
									<Field styles={styles} label="Images" hint="The model accepts image input.">
										<Switch
											styles={styles}
											label="Images"
											value={modelsFor.images}
											onChange={(images) => setModelsFor({ ...modelsFor, images })}
										/>
									</Field>
								</View>
							</View>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label={busy ? "Saving…" : "Save model"}
									variant="primary"
									loading={busy}
									disabled={!modelsFor.id.trim()}
									onPress={saveModel}
								/>
								<Button
									styles={styles}
									label="Cancel"
									variant="ghost"
									onPress={() => setModelsFor(null)}
								/>
							</View>
						</View>
					</Card>
				) : null}

				<Card styles={styles}>
					{loading && providers.length === 0 ? (
						<EmptyState styles={styles} title="Reading models.json…" />
					) : providers.length === 0 ? (
						<EmptyState
							styles={styles}
							title={error ? "Could not read models.json" : "No providers yet"}
							hint={
								error
									? "See the error above."
									: "Add an OpenAI-, Anthropic-, or Google-compatible endpoint."
							}
							action={
								<Button
									styles={styles}
									label="Add provider"
									variant="outline"
									onPress={addProvider}
								/>
							}
						/>
					) : (
						providers.map((entry) => (
							<View key={entry.name} style={styles.provider}>
								<View style={styles.providerHeader}>
									<View style={styles.rowText}>
										<View style={styles.rowTitleLine}>
											<Text style={styles.rowTitle}>{entry.label ?? entry.name}</Text>
											{entry.label ? <Badge styles={styles} label={entry.name} /> : null}
											{entry.apiKeySet ? <Badge styles={styles} label="key set" /> : null}
											<Badge styles={styles} label={`${entry.models.length} model${entry.models.length === 1 ? "" : "s"}`} />
										</View>
										{entry.baseUrl ? (
											<Text style={styles.rowMono} selectable>
												{entry.baseUrl}
											</Text>
										) : null}
										{entry.api ? <Text style={styles.rowHint}>{entry.api}</Text> : null}
									</View>
									<View style={styles.rowActions}>
										<Button
											styles={styles}
											label="Edit"
											variant="ghost"
											onPress={() => editProvider(entry)}
											disabled={busy}
										/>
										<Button
											styles={styles}
											label="Fetch models"
											variant="outline"
											disabled={busy || !entry.baseUrl}
											onPress={() => fetchModels(entry)}
										/>
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

								<View style={styles.modelList}>
									{entry.models.map((model) => (
										<View key={`${entry.name}/${model.id}`} style={styles.modelRow}>
											<View style={styles.rowText}>
												<Text style={styles.rowTitle}>{model.name ?? model.id}</Text>
												{model.name && model.name !== model.id ? (
													<Text style={styles.rowMono}>{model.id}</Text>
												) : null}
												<View style={styles.rowTitleLine}>
													{model.reasoning ? <Badge styles={styles} label="reasoning" /> : null}
													{model.input.includes("image") ? <Badge styles={styles} label="vision" /> : null}
													{model.contextWindow ? (
														<Badge styles={styles} label={`${model.contextWindow} ctx`} />
													) : null}
												</View>
											</View>
											<View style={styles.rowActions}>
												<Button
													styles={styles}
													label="Edit"
													variant="ghost"
													onPress={() => editModel(entry, model)}
													disabled={busy}
												/>
												<ConfirmButton
													styles={styles}
													label="Delete"
													confirmLabel="Confirm delete"
													disabled={busy}
													onConfirm={() =>
														void run(async () => {
															if (!revision) return;
															await deleteModelRpc({
																revision,
																provider: entry.name,
																id: model.id,
															});
															setNotice("Model deleted.");
														})
													}
												/>
											</View>
										</View>
									))}
								</View>
								<View style={styles.alignStart}>
									<Button
										styles={styles}
										label={entry.models.length ? "Add model" : "Add the first model"}
										variant="ghost"
										onPress={() => addModel(entry)}
										disabled={busy}
									/>
								</View>
							</View>
						))
					)}
				</Card>
			</Section>

			<Section styles={styles} title="models.json" hint={path || undefined}>
				<Card styles={styles}>
					<Row
						styles={styles}
						title="Raw editor"
						hint={`Keeps fields this form does not show, such as headers, cost, compat, and modelOverrides. Secret values appear as ${PI_MODELS_SECRET_MASK} and are restored when saved.`}
						actions={
							<Button
								styles={styles}
								label={showRaw ? "Close editor" : "Open editor"}
								variant="outline"
								onPress={() => setShowRaw((value) => !value)}
							/>
						}
					/>
				</Card>
				{showRaw ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<TextArea
								styles={styles}
								value={raw}
								onChangeText={setRaw}
								minHeight={340}
								placeholder="{ }"
								accessibilityLabel="models.json content"
							/>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label={busy ? "Saving…" : "Save JSON"}
									variant="primary"
									loading={busy}
									onPress={saveRaw}
								/>
								<Button
									styles={styles}
									label="Discard changes"
									variant="ghost"
									onPress={() => void load()}
									disabled={busy}
								/>
							</View>
						</View>
					</Card>
				) : null}
			</Section>
		</>
	);
}
