import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
	piAddExtensionRpc,
	piCreateSkillRpc,
	piDeleteSkillRpc,
	piInspectSkillSourceRpc,
	piInstallPackageRpc,
	piInstallSkillSourceRpc,
	piListResourcesRpc,
	piReadSkillRpc,
	piSetBuiltinExtensionRpc,
	piSetExtensionEnabledRpc,
	piSetSkillEnabledRpc,
	piUpdatePackageRpc,
	piUpdateSkillRpc,
	piRemoveExtensionRpc,
	piRemovePackageRpc,
	type PiExtensionEntry,
	type PiSkillEntry,
	type PiSkillSourceCandidate,
} from "../../shared/management";
import { looksLikePackageSource, normalizePackageInput } from "../../shared/source";
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

const BUILTIN_HINTS: Record<string, string> = {
	mcp: "Model Context Protocol servers from mcp.json.",
	"llama.cpp": "Local llama.cpp inference.",
	codemode: "Batched tool calls through one script.",
	"tool-search": "Find tools on demand instead of loading every definition.",
};

export function ResourcesTab({ styles }: { styles: ManageStyles }) {
	const listRpc = useRpc(piListResourcesRpc);
	const installRpc = useRpc(piInstallPackageRpc);
	const removeRpc = useRpc(piRemovePackageRpc);
	const addExtensionRpc = useRpc(piAddExtensionRpc);
	const removeExtensionRpc = useRpc(piRemoveExtensionRpc);
	const setBuiltinRpc = useRpc(piSetBuiltinExtensionRpc);
	const setExtensionEnabledRpc = useRpc(piSetExtensionEnabledRpc);
	const setSkillEnabledRpc = useRpc(piSetSkillEnabledRpc);
	const updateRpc = useRpc(piUpdatePackageRpc);
	const createRpc = useRpc(piCreateSkillRpc);
	const inspectSkillRpc = useRpc(piInspectSkillSourceRpc);
	const installSkillRpc = useRpc(piInstallSkillSourceRpc);
	const deleteRpc = useRpc(piDeleteSkillRpc);
	const readSkillRpc = useRpc(piReadSkillRpc);
	const updateSkillRpc = useRpc(piUpdateSkillRpc);

	const [extensions, setExtensions] = useState<PiExtensionEntry[]>([]);
	const [skills, setSkills] = useState<PiSkillEntry[]>([]);
	const [agentDir, setAgentDir] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [showInstall, setShowInstall] = useState(false);
	const [showExtension, setShowExtension] = useState(false);
	const [source, setSource] = useState("");
	const [extensionPath, setExtensionPath] = useState("");
	const [showSkillForm, setShowSkillForm] = useState(false);
	const [showManualSkill, setShowManualSkill] = useState(false);
	const [skillSource, setSkillSource] = useState("");
	const [skillCandidates, setSkillCandidates] = useState<PiSkillSourceCandidate[] | null>(null);
	const [skillFilter, setSkillFilter] = useState("");
	const [skillName, setSkillName] = useState("");
	const [skillDescription, setSkillDescription] = useState("");
	const [skillInstructions, setSkillInstructions] = useState("");
	const [editingSkill, setEditingSkill] = useState<PiSkillEntry | null>(null);
	const [skillContent, setSkillContent] = useState("");
	const [skillOriginal, setSkillOriginal] = useState("");
	const [skillRevision, setSkillRevision] = useState("");
	const [skillEditLoading, setSkillEditLoading] = useState(false);

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await listRpc({});
			setExtensions(data.extensions);
			setSkills(data.skills);
			setAgentDir(data.agentDir);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// Loaded once on mount; mutations reload explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const run = async (action: () => Promise<string | void>) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await action();
			if (typeof result === "string" && result) setNotice(result);
			await load();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const packages = extensions.filter((entry) => entry.kind === "package");
	const configured = extensions.filter((entry) => entry.kind === "extension");
	const builtins = extensions.filter((entry) => entry.kind === "builtin");
	const visibleCandidates = (skillCandidates ?? []).filter((candidate) =>
		`${candidate.name} ${candidate.description}`
			.toLowerCase()
			.includes(skillFilter.trim().toLowerCase()),
	);

	const addExtension = () =>
		void run(async () => {
			const value = normalizePackageInput(extensionPath);
			if (looksLikePackageSource(value)) {
				throw new Error("That is a package source. Use Install package instead.");
			}
			const added = await addExtensionRpc({ path: value });
			setExtensionPath("");
			setShowExtension(false);
			return `Added ${added.path}. New sessions load it.`;
		});

	const install = () =>
		void run(async () => {
			const result = await installRpc({ source: normalizePackageInput(source) });
			setSource("");
			setShowInstall(false);
			return result.output || "Package installed.";
		});

	const inspectSkill = () =>
		void run(async () => {
			const result = await inspectSkillRpc({ source: skillSource.trim() });
			setSkillCandidates(result.candidates);
			setSkillFilter("");
			const fresh = result.candidates.filter((candidate) => !candidate.installed).length;
			return fresh === 0
				? "Every skill in that repository is already installed."
				: `${fresh} skill${fresh === 1 ? "" : "s"} found. Choose what to add.`;
		});

	const installSkill = (candidate: PiSkillSourceCandidate) =>
		void run(async () => {
			const installed = await installSkillRpc({
				source: skillSource.trim(),
				path: candidate.path,
			});
			setSkillCandidates(null);
			setSkillSource("");
			setShowSkillForm(false);
			return `Installed ${installed.name}. New sessions load it.`;
		});

	const openSkillEditor = async (skill: PiSkillEntry) => {
		setSkillEditLoading(true);
		setError(null);
		setNotice(null);
		try {
			const skillFile = await readSkillRpc({ path: skill.path });
			setEditingSkill(skill);
			setSkillContent(skillFile.content);
			setSkillOriginal(skillFile.content);
			setSkillRevision(skillFile.revision);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setSkillEditLoading(false);
		}
	};

	const saveSkill = () =>
		void run(async () => {
			if (!editingSkill) return;
			await updateSkillRpc({
				path: editingSkill.path,
				revision: skillRevision,
				content: skillContent,
			});
			setEditingSkill(null);
			setSkillContent("");
			setSkillOriginal("");
			setSkillRevision("");
			return `Saved ${editingSkill.name}. New sessions use the change.`;
		});

	const createSkill = () =>
		void run(async () => {
			const created = await createRpc({
				name: skillName.trim(),
				description: skillDescription.trim(),
				instructions: skillInstructions,
			});
			setSkillName("");
			setSkillDescription("");
			setSkillInstructions("");
			setShowManualSkill(false);
			setShowSkillForm(false);
			return `Skill written to ${created.path}`;
		});

	return (
		<>
			<Notice styles={styles} message={error} tone="error" />
			<Notice styles={styles} message={notice} tone="ok" />

			<Section
				styles={styles}
				title="Packages"
				hint={agentDir ? `Installed with pi's own installer in ${agentDir}` : undefined}
				trailing={
					<>
						<Button
							styles={styles}
							label={busy ? "Updating…" : "Update all"}
							variant="ghost"
							disabled={busy || packages.length === 0}
							onPress={() =>
								void run(async () => {
									const result = await updateRpc({});
									return result.output || "Packages updated.";
								})
							}
						/>
						<Button
							styles={styles}
							label={showInstall ? "Close" : "Install package"}
							variant="outline"
							onPress={() => setShowInstall((value) => !value)}
						/>
					</>
				}
			>
				{showInstall ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Field
								styles={styles}
								label="Package source"
								hint="npm:package, git:host/repo, an https or ssh URL, or a local path. A pasted pi install command works too."
							>
								<View style={styles.inline}>
									<View style={styles.grow}>
										<TextField
											styles={styles}
											value={source}
											onChangeText={(value) => setSource(normalizePackageInput(value))}
											placeholder="npm:pi-tools"
											accessibilityLabel="Package source"
										/>
									</View>
									<Button
										styles={styles}
										label="Install"
										variant="primary"
										loading={busy}
										disabled={!source.trim()}
										onPress={install}
									/>
								</View>
							</Field>
						</View>
					</Card>
				) : null}
				<Card styles={styles}>
					{loading && packages.length === 0 ? (
						<EmptyState styles={styles} title="Reading packages…" />
					) : packages.length === 0 ? (
						<EmptyState
							styles={styles}
							title={error ? "Could not read packages" : "No packages installed"}
							hint={
								error
									? "See the error above."
									: "Packages can add providers, tools, commands, extensions, and skills."
							}
							action={
								error ? undefined : (
									<Button
										styles={styles}
										label="Install a package"
										variant="outline"
										onPress={() => setShowInstall(true)}
									/>
								)
							}
						/>
					) : (
						packages.map((entry) => (
							<Row
								key={entry.id}
								styles={styles}
								stack
								title={entry.label}
								hint={entry.source}
								mono={entry.path}
								badges={
									<>
										{entry.version ? <Badge styles={styles} label={entry.version} /> : null}
										{entry.note ? <Badge styles={styles} label={entry.note} /> : null}
									</>
								}
								actions={
									entry.removable ? (
										<>
											<Button
												styles={styles}
												label="Update"
												variant="ghost"
												disabled={busy}
												onPress={() =>
													void run(async () => {
														const result = await updateRpc({ source: entry.source });
														return result.output || `Updated ${entry.source}.`;
													})
												}
											/>
											<ConfirmButton
												styles={styles}
												label="Remove"
												confirmLabel="Confirm remove"
												disabled={busy}
												onConfirm={() =>
													void run(async () => {
														const result = await removeRpc({ source: entry.source });
														return result.output || `Removed ${entry.source}.`;
													})
												}
											/>
										</>
									) : null
								}
							/>
						))
					)}
				</Card>
			</Section>

			<Section
				styles={styles}
				title="Extensions"
				hint="Each extension has its own switch. Changes apply to new sessions."
				trailing={
					<Button
						styles={styles}
						label={showExtension ? "Close" : "Add extension"}
						variant="outline"
						onPress={() => setShowExtension((value) => !value)}
					/>
				}
			>
				{showExtension ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Field
								styles={styles}
								label="Extension path"
								hint="A .ts or .js file, or a directory with index.ts, index.js, or a pi.extensions manifest."
							>
								<View style={styles.inline}>
									<View style={styles.grow}>
										<TextField
											styles={styles}
											value={extensionPath}
											onChangeText={(value) => setExtensionPath(normalizePackageInput(value))}
											placeholder="/home/me/.pi/extensions/my-extension.ts"
											accessibilityLabel="Extension path"
										/>
									</View>
									<Button
										styles={styles}
										label="Add"
										variant="primary"
										loading={busy}
										disabled={!extensionPath.trim()}
										onPress={addExtension}
									/>
								</View>
							</Field>
						</View>
					</Card>
				) : null}
				<Card styles={styles}>
					{configured.length === 0 ? (
						<EmptyState
							styles={styles}
							title={error ? "Could not read extensions" : "No extensions configured"}
							hint={error ? "See the error above." : "Add a file or folder outside a package."}
						/>
					) : (
						configured.map((entry) => (
							<Row
								key={entry.id}
								styles={styles}
								stack
								title={entry.label}
								hint={entry.note}
								mono={entry.path ?? entry.source}
								badges={<Badge styles={styles} label={entry.removable ? "configured" : "discovered"} />}
								actions={
									<>
										<Switch
											styles={styles}
											label={`${entry.label} enabled`}
											value={entry.enabled}
											disabled={busy}
											onChange={(enabled) =>
												void run(async () => {
													const result = await setExtensionEnabledRpc({
														path: entry.source,
														enabled,
													});
													return `${result.path} ${result.enabled ? "enabled" : "disabled"}. New sessions use the change.`;
												})
											}
										/>
										{entry.removable ? (
											<ConfirmButton
												styles={styles}
												label="Remove"
												confirmLabel="Confirm remove"
												disabled={busy}
												onConfirm={() =>
													void run(async () => {
														await removeExtensionRpc({ path: entry.source });
														return `Removed ${entry.source}.`;
													})
												}
											/>
										) : null}
									</>
								}
							/>
						))
					)}
				</Card>
			</Section>

			<Section
				styles={styles}
				title="Built-in extensions"
				hint="Ships with pi. Changes apply to new sessions."
			>
				<Card styles={styles}>
					{builtins.map((entry) => (
						<Row
							key={entry.id}
							styles={styles}
							title={entry.label}
							hint={entry.note ?? BUILTIN_HINTS[entry.label]}
							actions={
								<Switch
									styles={styles}
									label={`${entry.label} enabled`}
									value={entry.enabled}
									disabled={busy}
									onChange={(enabled) =>
										void run(async () => {
											await setBuiltinRpc({
												name: entry.label as "mcp" | "llama.cpp" | "codemode" | "tool-search",
												enabled,
											});
											return `${entry.label} ${enabled ? "enabled" : "disabled"}. New sessions use the change.`;
										})
									}
								/>
							}
						/>
					))}
				</Card>
			</Section>

			<Section
				styles={styles}
				title="Skills"
				hint="SKILL.md folders from this agent and ~/.agents. New sessions use changes."
				trailing={
					<Button
						styles={styles}
						label={showSkillForm ? "Close" : "Add skill"}
						variant="outline"
						onPress={() => {
							setShowSkillForm((value) => !value);
							setSkillCandidates(null);
							setSkillFilter("");
							setShowManualSkill(false);
						}}
					/>
				}
			>
				{showSkillForm ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Field
								styles={styles}
								label="GitHub link"
								hint="A SKILL.md file or a repository, such as github.com/owner/repo or github.com/owner/repo/blob/main/skills/name/SKILL.md."
							>
								<View style={styles.inline}>
									<View style={styles.grow}>
										<TextField
											styles={styles}
											value={skillSource}
											onChangeText={setSkillSource}
											placeholder="https://github.com/owner/repo"
											accessibilityLabel="GitHub link"
										/>
									</View>
									<Button
										styles={styles}
										label="Find skills"
										variant="primary"
										loading={busy}
										disabled={!skillSource.trim()}
										onPress={inspectSkill}
									/>
								</View>
							</Field>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label={showManualSkill ? "Hide manual form" : "Write one instead"}
									variant="ghost"
									onPress={() => setShowManualSkill((value) => !value)}
								/>
							</View>
						</View>
						{skillCandidates ? (
							<View style={{ padding: 16 }}>
								<TextField
									styles={styles}
									value={skillFilter}
									onChangeText={setSkillFilter}
									placeholder="Filter by name"
									accessibilityLabel="Filter skills"
								/>
							</View>
						) : null}
						{skillCandidates && visibleCandidates.length === 0 ? (
							<EmptyState
								styles={styles}
								title={
									skillCandidates.length === 0
										? "No skills found at that link"
										: "No skills match that filter"
								}
							/>
						) : null}
						{visibleCandidates.map((candidate) => (
							<Row
								key={candidate.path}
								styles={styles}
								stack
								title={candidate.name}
								hint={candidate.description}
								mono={candidate.path}
								badges={candidate.installed ? <Badge styles={styles} label="installed" /> : null}
								actions={
									<Button
										styles={styles}
										label="Add"
										variant="outline"
										disabled={busy || candidate.installed}
										onPress={() => installSkill(candidate)}
									/>
								}
							/>
						))}
					</Card>
				) : null}

				{showSkillForm && showManualSkill ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Field styles={styles} label="Name" hint="Lowercase letters, numbers, and hyphens.">
								<TextField
									styles={styles}
									value={skillName}
									onChangeText={setSkillName}
									placeholder="my-skill"
								/>
							</Field>
							<Field styles={styles} label="Description" hint="What it does and when the model should use it.">
								<TextField
									styles={styles}
									value={skillDescription}
									onChangeText={setSkillDescription}
									placeholder="Extract tables from PDF files."
									autoCapitalize="sentences"
								/>
							</Field>
							<Field styles={styles} label="Instructions">
								<TextArea
									styles={styles}
									value={skillInstructions}
									onChangeText={setSkillInstructions}
									placeholder={"# My skill\n\nSteps the model should follow."}
								/>
							</Field>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label="Create skill"
									variant="primary"
									loading={busy}
									disabled={!skillName.trim() || !skillDescription.trim()}
									onPress={createSkill}
								/>
								<Button
									styles={styles}
									label="Cancel"
									variant="ghost"
									onPress={() => setShowManualSkill(false)}
								/>
							</View>
						</View>
					</Card>
				) : null}

				{editingSkill ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Field
								styles={styles}
								label={`Edit ${editingSkill.name}`}
								hint="Edit the SKILL.md file directly, including its YAML frontmatter. Name and description are required."
							>
								<TextArea
									styles={styles}
									value={skillContent}
									onChangeText={setSkillContent}
									minHeight={360}
									accessibilityLabel={`${editingSkill.name} SKILL.md`}
								/>
							</Field>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label="Save skill"
									variant="primary"
									loading={busy}
									disabled={!skillContent.trim() || skillContent === skillOriginal}
									onPress={saveSkill}
								/>
								<Button
									styles={styles}
									label="Cancel"
									variant="ghost"
									onPress={() => {
										setEditingSkill(null);
										setSkillContent("");
										setSkillOriginal("");
										setSkillRevision("");
									}}
								/>
							</View>
						</View>
					</Card>
				) : null}

				<Card styles={styles}>
					{loading && skills.length === 0 ? (
						<EmptyState styles={styles} title="Reading skills…" />
					) : skills.length === 0 ? (
						<EmptyState
							styles={styles}
							title={error ? "Could not read skills" : "No skills found"}
							hint={
								error
									? "See the error above."
									: "Add one from GitHub, or write a SKILL.md by hand."
							}
							action={
								error ? undefined : (
									<Button
										styles={styles}
										label="Add a skill"
										variant="outline"
										onPress={() => setShowSkillForm(true)}
									/>
								)
							}
						/>
					) : (
						skills.map((skill) => (
							<Row
								key={skill.path}
								styles={styles}
								stack
								title={skill.name}
								hint={skill.description}
								mono={skill.path}
								badges={<Badge styles={styles} label={skill.source} />}
								actions={
									skill.source === "package" ? undefined : (
										<>
											<Button
												styles={styles}
												label="Edit"
												variant="outline"
												disabled={busy || skillEditLoading}
												onPress={() => void openSkillEditor(skill)}
											/>
											<Switch
												styles={styles}
												label={`${skill.name} enabled`}
												value={skill.enabled}
												disabled={busy}
												onChange={(enabled) =>
													void run(async () => {
														const result = await setSkillEnabledRpc({
															path: skill.path,
															enabled,
														});
														return `${skill.name} ${result.enabled ? "enabled" : "disabled"}. New sessions use the change.`;
													})
												}
											/>
											{skill.removable ? (
												<ConfirmButton
													styles={styles}
													label="Remove"
													confirmLabel="Confirm remove"
													disabled={busy}
													onConfirm={() =>
														void run(async () => {
															await deleteRpc({ path: skill.path });
															return `Removed ${skill.name}.`;
														})
													}
												/>
											) : null}
										</>
									)
								}
							/>
						))
					)}
				</Card>
			</Section>
		</>
	);
}
