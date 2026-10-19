import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

export type ManageTheme = PluginSurfaceProps["theme"];

export function useStyles(theme: ManageTheme) {
	return useMemo(
		() => ({
			page: { gap: 14, paddingBottom: 40 },
			card: {
				borderWidth: 1,
				borderColor: theme.colors.border,
				backgroundColor: theme.colors.surface1,
				borderRadius: 12,
				padding: 14,
				gap: 10,
			},
			cardTitle: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const },
			sectionLabel: {
				color: theme.colors.foregroundMuted,
				fontSize: 11,
				letterSpacing: 0.5,
				textTransform: "uppercase" as const,
			},
			text: { color: theme.colors.foreground, fontSize: 14 },
			muted: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
			error: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 },
			ok: { color: theme.colors.statusSuccess, fontSize: 12, lineHeight: 18 },
			warning: { color: theme.colors.statusWarning, fontSize: 12, lineHeight: 18 },
			mono: { color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace" as const },
			row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
			wrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
			between: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				justifyContent: "space-between" as const,
				gap: 10,
			},
			item: {
				borderTopWidth: 1,
				borderTopColor: theme.colors.border,
				paddingTop: 10,
				gap: 4,
			},
			label: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
			input: {
				color: theme.colors.foreground,
				backgroundColor: theme.colors.surface2,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				paddingHorizontal: 10,
				paddingVertical: 8,
				fontSize: 14,
			},
			textarea: {
				color: theme.colors.foreground,
				backgroundColor: theme.colors.surface2,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				paddingHorizontal: 10,
				paddingVertical: 8,
				fontSize: 12,
				fontFamily: "monospace" as const,
				minHeight: 160,
				textAlignVertical: "top" as const,
			},
			button: {
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				paddingVertical: 7,
				paddingHorizontal: 11,
				backgroundColor: theme.colors.surface2,
			},
			buttonText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "500" as const },
			primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
			primaryText: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
			danger: { borderColor: theme.colors.statusDanger },
			dangerText: { color: theme.colors.statusDanger, fontSize: 12, fontWeight: "500" as const },
			disabled: { opacity: 0.45 },
			badge: {
				color: theme.colors.foregroundMuted,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 999,
				paddingHorizontal: 7,
				paddingVertical: 2,
				fontSize: 10,
				overflow: "hidden" as const,
			},
			tab: {
				borderBottomWidth: 2,
				borderBottomColor: "transparent",
				paddingVertical: 7,
				paddingHorizontal: 3,
			},
			tabActive: { borderBottomColor: theme.colors.accent },
			tabText: { color: theme.colors.foregroundMuted, fontSize: 13 },
			tabTextActive: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
			notice: {
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				padding: 9,
				backgroundColor: theme.colors.surface2,
			},
		}),
		[theme],
	);
}

export type ManageStyles = ReturnType<typeof useStyles>;

export function Card({
	styles,
	title,
	trailing,
	children,
}: {
	styles: ManageStyles;
	title?: string;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<View style={styles.card}>
			{title || trailing ? (
				<View style={styles.between}>
					{title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
					{trailing}
				</View>
			) : null}
			{children}
		</View>
	);
}

export function Field({
	styles,
	label,
	hint,
	children,
}: {
	styles: ManageStyles;
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<View style={{ gap: 4 }}>
			<Text style={styles.label}>{label}</Text>
			{children}
			{hint ? <Text style={styles.muted}>{hint}</Text> : null}
		</View>
	);
}

export function TextField({
	styles,
	value,
	onChangeText,
	placeholder,
	secure = false,
	autoCapitalize = "none",
}: {
	styles: ManageStyles;
	value: string;
	onChangeText(value: string): void;
	placeholder?: string;
	secure?: boolean;
	autoCapitalize?: "none" | "sentences";
}) {
	return (
		<TextInput
			value={value}
			onChangeText={onChangeText}
			placeholder={placeholder}
			placeholderTextColor={styles.muted.color}
			secureTextEntry={secure}
			autoCapitalize={autoCapitalize}
			autoCorrect={false}
			style={styles.input}
		/>
	);
}

export function TextArea({
	styles,
	value,
	onChangeText,
	placeholder,
	minHeight = 160,
}: {
	styles: ManageStyles;
	value: string;
	onChangeText(value: string): void;
	placeholder?: string;
	minHeight?: number;
}) {
	return (
		<TextInput
			value={value}
			onChangeText={onChangeText}
			placeholder={placeholder}
			placeholderTextColor={styles.muted.color}
			multiline
			autoCapitalize="none"
			autoCorrect={false}
			style={[styles.textarea, { minHeight }]}
		/>
	);
}

export function Button({
	styles,
	label,
	onPress,
	primary = false,
	danger = false,
	disabled = false,
}: {
	styles: ManageStyles;
	label: string;
	onPress(): void;
	primary?: boolean;
	danger?: boolean;
	disabled?: boolean;
}) {
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={[
				styles.button,
				primary ? styles.primary : null,
				danger ? styles.danger : null,
				disabled ? styles.disabled : null,
			]}
		>
			<Text style={[styles.buttonText, primary ? styles.primaryText : null, danger ? styles.dangerText : null]}>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * Two-step destructive action, so a single tap cannot delete a package, skill, provider, model,
 * prompt, or session.
 */
export function ConfirmButton({
	styles,
	label,
	confirmLabel,
	onConfirm,
	disabled = false,
}: {
	styles: ManageStyles;
	label: string;
	confirmLabel: string;
	onConfirm(): void;
	disabled?: boolean;
}) {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const timer = setTimeout(() => setArmed(false), 5_000);
		return () => clearTimeout(timer);
	}, [armed]);
	return (
		<Button
			styles={styles}
			label={armed ? confirmLabel : label}
			onPress={() => {
				if (!armed) {
					setArmed(true);
					return;
				}
				setArmed(false);
				onConfirm();
			}}
			danger
			disabled={disabled}
		/>
	);
}

export function Badge({ styles, label }: { styles: ManageStyles; label: string }) {
	return <Text style={styles.badge}>{label}</Text>;
}

export function Notice({
	styles,
	message,
	tone = "muted",
}: {
	styles: ManageStyles;
	message: string | null;
	tone?: "muted" | "error" | "ok" | "warning";
}) {
	if (!message) return null;
	const style =
		tone === "error" ? styles.error : tone === "ok" ? styles.ok : tone === "warning" ? styles.warning : styles.muted;
	return (
		<View style={styles.notice}>
			<Text style={style}>{message}</Text>
		</View>
	);
}

export function Toggle({
	styles,
	label,
	value,
	onChange,
	disabled = false,
}: {
	styles: ManageStyles;
	label: string;
	value: boolean;
	onChange(value: boolean): void;
	disabled?: boolean;
}) {
	return (
		<Pressable
			onPress={() => onChange(!value)}
			disabled={disabled}
			style={[styles.between, disabled ? styles.disabled : null]}
		>
			<Text style={styles.text}>{label}</Text>
			<Text style={value ? styles.ok : styles.muted}>{value ? "On" : "Off"}</Text>
		</Pressable>
	);
}
