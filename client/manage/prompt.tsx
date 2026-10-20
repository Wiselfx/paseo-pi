import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
	piReadPromptRpc,
	piWritePromptRpc,
	type PiPromptKind,
} from "../../shared/management";
import {
	Button,
	Card,
	ConfirmButton,
	Notice,
	Section,
	Segmented,
	TextArea,
	type ManageStyles,
} from "./shared";

export function PromptTab({ styles }: { styles: ManageStyles }) {
	const readRpc = useRpc(piReadPromptRpc);
	const writeRpc = useRpc(piWritePromptRpc);
	const [kind, setKind] = useState<PiPromptKind>("append");
	const [path, setPath] = useState("");
	const [revision, setRevision] = useState<string | null>(null);
	const [content, setContent] = useState("");
	const [saved, setSaved] = useState("");
	const [exists, setExists] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const loadSeq = useRef(0);

	const load = async (nextKind = kind) => {
		const seq = ++loadSeq.current;
		setError(null);
		setNotice(null);
		setLoading(true);
		setPath("");
		setRevision(null);
		setContent("");
		setSaved("");
		setExists(false);
		try {
			const data = await readRpc({ kind: nextKind });
			if (seq !== loadSeq.current) return;
			setPath(data.path);
			setRevision(data.revision);
			setContent(data.content);
			setSaved(data.content);
			setExists(data.exists);
		} catch (failure) {
			if (seq !== loadSeq.current) return;
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			if (seq === loadSeq.current) setLoading(false);
		}
	};

	useEffect(() => {
		void load(kind);
		// The selected file changed; unsaved edits are intentionally discarded.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [kind]);

	const save = async (value: string) => {
		if (!revision) return;
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await writeRpc({ kind, revision, content: value });
			setRevision(result.revision);
			setExists(result.exists);
			setSaved(value);
			setContent(value);
			setNotice(value ? `Saved ${path}.` : `Cleared ${path}.`);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const dirty = content !== saved;

	return (
		<>
			<Section
				styles={styles}
				title="Prompt file"
				hint={path || "Read from the pi agent directory"}
			>
				<Card styles={styles}>
					<View style={styles.form}>
						<View style={styles.inline}>
							<Segmented<PiPromptKind>
								styles={styles}
								value={kind}
								disabled={busy || loading}
								options={[
									{ value: "append", label: "APPEND_SYSTEM.md" },
									{ value: "system", label: "SYSTEM.md" },
								]}
								onChange={setKind}
							/>
							<Text style={styles.small}>
								{loading
									? "Reading…"
									: exists
										? dirty
											? "Unsaved changes"
											: "Saved"
										: "Not created yet"}
							</Text>
						</View>
						<Text style={styles.muted}>
							APPEND_SYSTEM.md adds instructions to pi's default prompt. SYSTEM.md replaces it. Both
							are read from the agent directory; a project's .pi versions take precedence when the
							project is trusted.
						</Text>
						{kind === "system" ? (
							<Notice
								styles={styles}
								tone="warning"
								message="SYSTEM.md replaces pi's entire default system prompt. Prefer APPEND_SYSTEM.md unless you intend that."
							/>
						) : null}
						<Notice styles={styles} message={error} tone="error" />
						<Notice styles={styles} message={notice} tone="ok" />
						<TextArea
							styles={styles}
							value={content}
							onChangeText={setContent}
							minHeight={320}
							accessibilityLabel={kind === "append" ? "APPEND_SYSTEM.md content" : "SYSTEM.md content"}
							placeholder={
								kind === "append"
									? "Additional instructions for every pi session."
									: "Replacement system prompt."
							}
						/>
						<View style={styles.formFooter}>
							<Button
								styles={styles}
								label={busy ? "Saving…" : exists ? "Save prompt" : "Create file"}
								variant="primary"
								loading={busy}
								disabled={!dirty || !revision || busy || loading}
								onPress={() => void save(content)}
							/>
							<Button
								styles={styles}
								label="Reload"
								variant="ghost"
								onPress={() => void load()}
								disabled={busy || loading || dirty}
							/>
							{exists ? (
								<ConfirmButton
									styles={styles}
									label="Clear file"
									confirmLabel="Confirm clear"
									disabled={busy || loading || !revision}
									onConfirm={() => void save("")}
								/>
							) : null}
						</View>
					</View>
				</Card>
			</Section>
		</>
	);
}
