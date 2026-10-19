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
	Field,
	Notice,
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
			await deleteRpc({ sessionFile: session.sessionFile });
			setNotice(`Deleted ${session.sessionId || session.sessionFile}.`);
			await load(true);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Card
				styles={styles}
				title="Pi sessions"
				trailing={
					<Button styles={styles} label="Reload sessions" onPress={() => void load(true)} disabled={loading || busy} />
				}
			>
				<Text style={styles.muted}>{sessionDir}</Text>
				<View style={styles.row}>
					<View style={{ flex: 1 }}>
						<Field styles={styles} label="Working directory">
							<TextField styles={styles} value={cwd} onChangeText={setCwd} placeholder="/path/to/project" />
						</Field>
					</View>
					<View style={{ flex: 1 }}>
						<Field styles={styles} label="Search">
							<TextField styles={styles} value={query} onChangeText={setQuery} placeholder="title or id" />
						</Field>
					</View>
				</View>
				<View style={styles.wrap}>
					<Button styles={styles} label="Apply filters" onPress={() => void load(true)} disabled={loading || busy} />
					<Button
						styles={styles}
						label="All sessions"
						onPress={() => {
							setCwd("");
							setQuery("");
							void load(false);
						}}
						disabled={loading || busy}
					/>
				</View>
				<Notice styles={styles} message={error} tone="error" />
				<Notice styles={styles} message={notice} tone="ok" />

				{loading ? <Text style={styles.muted}>Reading session files...</Text> : null}
				{!loading && sessions.length === 0 ? <Text style={styles.muted}>No sessions match.</Text> : null}
				{sessions.map((session) => (
					<View key={session.sessionFile} style={[styles.item, styles.between]}>
						<View style={{ flex: 1, gap: 3 }}>
							<View style={styles.wrap}>
								<Text style={styles.text}>{session.title || "(untitled)"}</Text>
								<Badge styles={styles} label={age(session.updatedAt)} />
							</View>
							<Text style={styles.mono}>{session.sessionId}</Text>
							<Text style={styles.muted}>{session.cwd}</Text>
							<Text style={styles.mono}>{session.sessionFile}</Text>
						</View>
						<ConfirmButton
							styles={styles}
							label="Delete"
							confirmLabel="Confirm delete"
							disabled={busy || !session.sessionFile}
							onConfirm={() => void remove(session)}
						/>
					</View>
				))}
			</Card>
		</>
	);
}
