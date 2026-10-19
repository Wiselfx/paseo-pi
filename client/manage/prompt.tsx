import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
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

	const load = async (nextKind = kind) => {
		setError(null);
		try {
			const data = await readRpc({ kind: nextKind });
			setPath(data.path);
			setRevision(data.revision);
			setContent(data.content);
			setSaved(data.content);
			setExists(data.exists);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
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
			<Card styles={styles} title="System prompt">
				<Text style={styles.muted}>
					APPEND_SYSTEM.md adds instructions to pi's default prompt. SYSTEM.md replaces it. Both are read from
					the pi agent directory; the project's .pi versions take precedence when a project is trusted.
				</Text>
				<View style={styles.wrap}>
					<Button
						styles={styles}
						label="APPEND_SYSTEM.md"
						primary={kind === "append"}
						onPress={() => setKind("append")}
					/>
					<Button styles={styles} label="SYSTEM.md" primary={kind === "system"} onPress={() => setKind("system")} />
				</View>
				<Text style={styles.mono}>{path}</Text>
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
					minHeight={280}
					placeholder={kind === "append" ? "Additional instructions for every pi session." : "Replacement system prompt."}
				/>
				<View style={styles.wrap}>
					<Button
						styles={styles}
						label={busy ? "Saving..." : dirty ? "Save prompt" : exists ? "Saved" : "Create file"}
						primary
						disabled={busy || !dirty}
						onPress={() => void save(content)}
					/>
					<Button styles={styles} label="Reload" onPress={() => void load()} disabled={busy || dirty} />
					{exists ? (
						<ConfirmButton
							styles={styles}
							label="Clear file"
							confirmLabel="Confirm clear"
							disabled={busy}
							onConfirm={() => void save("")}
						/>
					) : null}
				</View>
			</Card>
		</>
	);
}
