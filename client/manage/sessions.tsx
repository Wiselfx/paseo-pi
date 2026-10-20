import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	piDeleteSessionRpc,
	piListManagedSessionsRpc,
	type PiManagedSession,
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
	TextField,
	type ManageStyles,
} from "./shared";

function age(iso: string): string {
	const time = Date.parse(iso);
	if (!Number.isFinite(time)) return "unknown time";
	const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function SessionsTab({ styles }: { styles: ManageStyles }) {
	const listRpc = useRpc(piListManagedSessionsRpc);
	const deleteRpc = useRpc(piDeleteSessionRpc);
	const [sessions, setSessions] = useState<PiManagedSession[]>([]);
	const [sessionDir, setSessionDir] = useState("");
	const [cwd, setCwd] = useState("");
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const load = async (filter = false) => {
		setLoading(true);
		setError(null);
		try {
			const data = await listRpc({
				...(filter && cwd.trim() ? { cwd: cwd.trim() } : {}),
				...(filter && query.trim() ? { query: query.trim() } : {}),
				limit: 100,
			});
			setSessions(data.sessions);
			setSessionDir(data.sessionDir);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// Loaded once; refresh and filters are explicit.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const remove = async (session: PiManagedSession) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await deleteRpc({ sessionFile: session.sessionFile });
			setNotice(
				result.deletedAgents > 0
					? `Deleted ${session.sessionId || session.sessionFile} and ${result.deletedAgents} Paseo agent${result.deletedAgents === 1 ? "" : "s"}.`
					: `Deleted ${session.sessionId || session.sessionFile}. It had no Paseo agent.`,
			);
			await load(true);
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
				title="Sessions"
				hint={sessionDir || "JSONL session files written by pi"}
				trailing={
					<Button
						styles={styles}
						label="Reload"
						variant="outline"
						onPress={() => void load(true)}
						disabled={loading || busy}
					/>
				}
			>
				<Card styles={styles}>
					<View style={styles.form}>
						<View style={styles.fieldGrid}>
							<View style={styles.fieldHalf}>
								<Field styles={styles} label="Working directory">
									<TextField
										styles={styles}
										value={cwd}
										onChangeText={setCwd}
										placeholder="/path/to/project"
									/>
								</Field>
							</View>
							<View style={styles.fieldHalf}>
								<Field styles={styles} label="Search">
									<TextField
										styles={styles}
										value={query}
										onChangeText={setQuery}
										placeholder="Title or session ID"
									/>
								</Field>
							</View>
						</View>
						<View style={styles.formFooter}>
							<Button
								styles={styles}
								label="Apply filters"
								variant="primary"
								onPress={() => void load(true)}
								disabled={loading || busy}
							/>
							<Button
								styles={styles}
								label="Clear filters"
								variant="ghost"
								onPress={() => {
									setCwd("");
									setQuery("");
									void load(false);
								}}
								disabled={loading || busy}
							/>
							<Text style={styles.small}>
								{loading ? "Reading…" : `${sessions.length} shown`}
							</Text>
						</View>
					</View>
				</Card>

				<Card styles={styles}>
					{loading && sessions.length === 0 ? (
						<EmptyState styles={styles} title="Reading session files…" />
					) : sessions.length === 0 ? (
						<EmptyState
							styles={styles}
							title={error ? "Could not read sessions" : "No sessions match"}
							hint={error ? "See the error above." : "Clear the filters to see every session in this directory."}
						/>
					) : (
						sessions.map((session) => (
							<Row
								key={session.sessionFile}
								styles={styles}
								stack
								title={session.title || "Untitled session"}
								hint={session.cwd}
								mono={session.sessionFile}
								badges={<Badge styles={styles} label={age(session.updatedAt)} />}
								actions={
									<ConfirmButton
										styles={styles}
										label="Delete"
										confirmLabel="Confirm delete"
										disabled={busy || !session.sessionFile}
										onConfirm={() => void remove(session)}
									/>
								}
							/>
						))
					)}
				</Card>
			</Section>
		</>
	);
}
