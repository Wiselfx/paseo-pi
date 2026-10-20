import {
	Children,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ActivityIndicator,
	Animated,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

export type ManageTheme = PluginSurfaceProps["theme"];

const MONO_FONT = Platform.select({
	ios: "ui-monospace",
	web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
	default: "monospace",
});

const PAGE_WIDTH = 820;

function withAlpha(color: string, alpha: number): string {
	if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
	return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

export function useStyles(theme: ManageTheme, compact: boolean) {
	return useMemo(
		() => ({
			compact,
			page: {
				width: "100%" as const,
				maxWidth: PAGE_WIDTH,
				alignSelf: "flex-start" as const,
				paddingHorizontal: compact ? 16 : 28,
				paddingTop: compact ? 20 : 28,
				paddingBottom: 48,
				gap: 28,
			},
			scroll: { flexGrow: 1 },
			tabBar: {
				borderBottomWidth: 1,
				borderBottomColor: theme.colors.border,
			},
			tabBarContent: {
				paddingHorizontal: compact ? 16 : 28,
				gap: 22,
				alignItems: "flex-end" as const,
			},
			tab: {
				borderBottomWidth: 2,
				borderBottomColor: "transparent",
				paddingTop: 12,
				paddingBottom: 10,
			},
			tabActive: { borderBottomColor: theme.colors.accent },
			tabFocused: {
				backgroundColor: theme.colors.surface2,
				borderTopLeftRadius: 6,
				borderTopRightRadius: 6,
			},
			tabText: { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
			tabTextActive: {
				color: theme.colors.foreground,
				fontSize: 14,
				lineHeight: 20,
				fontWeight: "500" as const,
			},
			section: { gap: 12 },
			sectionHeader: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				justifyContent: "space-between" as const,
				flexWrap: "wrap" as const,
				gap: 8,
				paddingHorizontal: 2,
			},
			sectionTitles: { flexGrow: 1, flexShrink: 1, gap: 2 },
			sectionTitle: {
				color: theme.colors.foregroundMuted,
				fontSize: 13,
				lineHeight: 18,
			},
			sectionHint: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 17,
				opacity: 0.85,
			},
			sectionActions: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				flexWrap: "wrap" as const,
				gap: 8,
			},
			card: {
				borderWidth: 1,
				borderColor: theme.colors.border,
				backgroundColor: theme.colors.surface1,
				borderRadius: 12,
				overflow: "hidden" as const,
			},
			rowBorder: {
				borderTopWidth: 1,
				borderTopColor: theme.colors.border,
			},
			row: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 12,
				paddingVertical: 14,
				paddingHorizontal: 16,
			},
			rowStacked: { flexDirection: "column" as const, alignItems: "stretch" as const },
			rowText: { flexGrow: 1, flexShrink: 1, gap: 3, minWidth: 0 },
			rowTitleLine: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				flexWrap: "wrap" as const,
				gap: 6,
			},
			rowTitle: {
				color: theme.colors.foreground,
				fontSize: 14,
				lineHeight: 20,
			},
			rowHint: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 17,
			},
			rowMono: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 17,
				fontFamily: MONO_FONT,
			},
			rowActions: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				justifyContent: "flex-end" as const,
				flexWrap: "wrap" as const,
				gap: 8,
				flexShrink: 0,
			},
			rowActionsStacked: { justifyContent: "flex-start" as const },
			form: { padding: 16, gap: 14 },
			formFooter: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				flexWrap: "wrap" as const,
				gap: 8,
			},
			inline: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 8,
				flexWrap: "wrap" as const,
			},
			grow: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
			alignStart: { alignItems: "flex-start" as const },
			fieldGrid: {
				flexDirection: "row" as const,
				flexWrap: "wrap" as const,
				gap: 12,
			},
			fieldHalf: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 200 },
			field: { gap: 6 },
			label: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
			hint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
			text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
			muted: {
				color: theme.colors.foregroundMuted,
				fontSize: 13,
				lineHeight: 19,
				maxWidth: 680,
			},
			small: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
			error: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 17 },
			ok: { color: theme.colors.statusSuccess, fontSize: 12, lineHeight: 17 },
			warning: { color: theme.colors.statusWarning, fontSize: 12, lineHeight: 17 },
			mono: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 18,
				fontFamily: MONO_FONT,
			},
			input: {
				color: theme.colors.foreground,
				backgroundColor: theme.colors.surface2,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				paddingHorizontal: 10,
				minHeight: 36,
				paddingVertical: 7,
				fontSize: 14,
			},
			inputFocused: { borderColor: theme.colors.accent },
			buttonFocused: { borderColor: theme.colors.accent },
			buttonFocusedDanger: { borderColor: theme.colors.statusDanger },
			textarea: {
				color: theme.colors.foreground,
				backgroundColor: theme.colors.surface2,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				paddingHorizontal: 12,
				paddingVertical: 10,
				fontSize: 12,
				lineHeight: 19,
				fontFamily: MONO_FONT,
				textAlignVertical: "top" as const,
			},
			button: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				justifyContent: "center" as const,
				gap: 6,
				borderWidth: 1,
				borderColor: "transparent",
				borderRadius: 8,
			},
			buttonSm: { minHeight: 30, paddingHorizontal: 10, paddingVertical: 5 },
			buttonMd: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 8 },
			buttonSecondary: {
				backgroundColor: theme.colors.surface2,
				borderColor: theme.colors.border,
			},
			buttonOutline: {
				backgroundColor: "transparent",
				borderColor: theme.colors.border,
			},
			buttonGhost: { backgroundColor: "transparent" },
			buttonPrimary: {
				backgroundColor: theme.colors.accent,
				borderColor: theme.colors.accent,
			},
			buttonDestructive: {
				backgroundColor: theme.colors.statusDanger,
				borderColor: theme.colors.statusDanger,
			},
			buttonText: { fontSize: 13, lineHeight: 18 },
			buttonTextSm: { fontSize: 12, lineHeight: 17 },
			buttonTextSecondary: { color: theme.colors.foreground },
			buttonTextOutline: { color: theme.colors.foreground },
			buttonTextGhost: { color: theme.colors.foregroundMuted },
			buttonTextPrimary: { color: theme.colors.accentForeground, fontWeight: "500" as const },
			buttonTextDanger: { color: theme.colors.statusDanger },
			buttonTextDestructive: { color: "#ffffff", fontWeight: "500" as const },
			pressed: { opacity: 0.7 },
			disabled: { opacity: 0.45 },
			badge: {
				color: theme.colors.foregroundMuted,
				backgroundColor: theme.colors.surface2,
				borderRadius: 999,
				paddingHorizontal: 7,
				paddingVertical: 1,
				fontSize: 11,
				lineHeight: 16,
				overflow: "hidden" as const,
			},
			notice: {
				flexDirection: "row" as const,
				alignItems: "flex-start" as const,
				gap: 9,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 10,
				paddingHorizontal: 12,
				paddingVertical: 10,
				backgroundColor: theme.colors.surface1,
			},
			noticeDot: {
				width: 6,
				height: 6,
				borderRadius: 3,
				marginTop: 6,
			},
			noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
			empty: {
				alignItems: "center" as const,
				paddingHorizontal: 24,
				paddingVertical: 28,
				gap: 4,
			},
			emptyTitle: {
				color: theme.colors.foregroundMuted,
				fontSize: 13,
				lineHeight: 19,
				textAlign: "center" as const,
			},
			emptyHint: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 17,
				textAlign: "center" as const,
			},
			emptyAction: { paddingTop: 8 },
			statusDot: { width: 8, height: 8, borderRadius: 4 },
			hero: { padding: 16, gap: 4 },
			heroLine: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 8,
			},
			heroTitle: {
				color: theme.colors.foreground,
				fontSize: 16,
				lineHeight: 22,
			},
			heroHint: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 18,
			},
			actionRowFocused: { backgroundColor: theme.colors.surface2 },
			actionRow: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 12,
				paddingVertical: 13,
				paddingHorizontal: 16,
			},
			actionRowText: { flexGrow: 1, flexShrink: 1, gap: 2 },
			actionRowTitle: {
				color: theme.colors.foreground,
				fontSize: 14,
				lineHeight: 20,
			},
			actionRowHint: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 17,
			},
			chevron: {
				color: theme.colors.foregroundMuted,
				fontSize: 18,
				lineHeight: 20,
				paddingLeft: 4,
			},
			provider: { paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
			providerHeader: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 12,
				flexWrap: "wrap" as const,
			},
			modelList: { gap: 0 },
			modelRow: {
				borderTopWidth: 1,
				borderTopColor: theme.colors.border,
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 12,
				paddingVertical: 10,
				paddingLeft: 12,
			},
			segmented: {
				flexDirection: "row" as const,
				alignSelf: "flex-start" as const,
				backgroundColor: theme.colors.surface2,
				borderRadius: 8,
				padding: 2,
				gap: 2,
			},
			segment: {
				borderRadius: 6,
				paddingHorizontal: 12,
				paddingVertical: 5,
				borderWidth: 1,
				borderColor: "transparent",
			},
			segmentActive: {
				backgroundColor: theme.colors.surface1,
				borderColor: theme.colors.border,
			},
			segmentText: {
				color: theme.colors.foregroundMuted,
				fontSize: 12,
				lineHeight: 17,
			},
			segmentTextActive: {
				color: theme.colors.foreground,
				fontSize: 12,
				lineHeight: 17,
				fontWeight: "500" as const,
			},
			segmentFocused: { borderColor: theme.colors.accent },
			toggleRow: {
				flexDirection: "row" as const,
				alignItems: "center" as const,
				gap: 12,
			},
			toggleText: { flexGrow: 1, flexShrink: 1, gap: 2 },
			switch: { paddingVertical: 2, flexShrink: 0 },
			switchTrack: {
				width: 40,
				height: 24,
				borderRadius: 12,
				borderWidth: 1,
				padding: 2,
				justifyContent: "center" as const,
			},
			switchOff: { backgroundColor: withAlpha(theme.colors.foregroundMuted, 0.32) },
			switchThumb: {
				width: 18,
				height: 18,
				borderRadius: 9,
				shadowColor: "#000000",
				shadowOffset: { width: 0, height: 1 },
				shadowRadius: 2,
				shadowOpacity: 0.25,
				elevation: 2,
			},
		}),
		[compact, theme],
	);
}

export type ManageStyles = ReturnType<typeof useStyles>;

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "destructive";
type ButtonSize = "sm" | "md";

export function Button({
	styles,
	label,
	onPress,
	variant = "secondary",
	size = "sm",
	disabled = false,
	loading = false,
}: {
	styles: ManageStyles;
	label: string;
	onPress(): void;
	variant?: ButtonVariant;
	size?: ButtonSize;
	disabled?: boolean;
	loading?: boolean;
}) {
	const [focused, setFocused] = useState(false);
	const fill =
		variant === "primary"
			? styles.buttonPrimary
			: variant === "outline"
				? styles.buttonOutline
				: variant === "ghost" || variant === "danger"
					? styles.buttonGhost
					: variant === "destructive"
						? styles.buttonDestructive
						: styles.buttonSecondary;
	const text =
		variant === "primary"
			? styles.buttonTextPrimary
			: variant === "ghost"
				? styles.buttonTextGhost
				: variant === "danger"
					? styles.buttonTextDanger
					: variant === "destructive"
						? styles.buttonTextDestructive
						: variant === "outline"
							? styles.buttonTextOutline
							: styles.buttonTextSecondary;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: disabled || loading, busy: loading }}
			aria-busy={loading}
			aria-disabled={disabled || loading}
			focusable={!disabled && !loading}
			hitSlop={4}
			onPress={onPress}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			disabled={disabled || loading}
			style={({ pressed }) => [
				styles.button,
				size === "sm" ? styles.buttonSm : styles.buttonMd,
				fill,
				focused
					? variant === "danger" || variant === "destructive"
						? styles.buttonFocusedDanger
						: styles.buttonFocused
					: null,
				pressed ? styles.pressed : null,
				disabled || loading ? styles.disabled : null,
			]}
		>
			{loading ? (
				<ActivityIndicator
					size="small"
					color={
						variant === "primary"
							? styles.buttonTextPrimary.color
							: variant === "destructive"
								? styles.buttonTextDestructive.color
								: undefined
					}
				/>
			) : null}
			<Text
				style={[styles.buttonText, size === "sm" ? styles.buttonTextSm : null, text]}
				numberOfLines={1}
			>
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
			variant={armed ? "destructive" : "danger"}
			disabled={disabled}
		/>
	);
}

export function Card({ styles, children }: { styles: ManageStyles; children: ReactNode }) {
	const items = Children.toArray(children);
	return (
		<View style={styles.card}>
			{items.map((child, index) => (
				<View
					key={isValidElement(child) && child.key !== null ? child.key : index}
					style={index ? styles.rowBorder : undefined}
				>
					{child}
				</View>
			))}
		</View>
	);
}

export function Section({
	styles,
	title,
	hint,
	trailing,
	children,
}: {
	styles: ManageStyles;
	title: string;
	hint?: string;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<View style={styles.section}>
			<View style={styles.sectionHeader}>
				<View style={styles.sectionTitles}>
					<Text style={styles.sectionTitle}>{title}</Text>
					{hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
				</View>
				{trailing ? <View style={styles.sectionActions}>{trailing}</View> : null}
			</View>
			{children}
		</View>
	);
}

export function Row({
	styles,
	title,
	hint,
	mono,
	badges,
	actions,
	stack = false,
}: {
	styles: ManageStyles;
	title: string;
	hint?: string | null;
	mono?: string | null;
	badges?: ReactNode;
	actions?: ReactNode;
	stack?: boolean;
}) {
	return (
		<View style={[styles.row, stack && styles.compact ? styles.rowStacked : null]}>
			<View style={styles.rowText}>
				<View style={styles.rowTitleLine}>
					<Text style={styles.rowTitle}>{title}</Text>
					{badges}
				</View>
				{hint ? (
					<Text style={styles.rowHint} numberOfLines={2}>
						{hint}
					</Text>
				) : null}
				{mono ? (
					<Text style={styles.rowMono} numberOfLines={1} selectable>
						{mono}
					</Text>
				) : null}
			</View>
			{actions ? (
				<View style={[styles.rowActions, stack && styles.compact ? styles.rowActionsStacked : null]}>
					{actions}
				</View>
			) : null}
		</View>
	);
}

export function ActionRow({
	styles,
	title,
	hint,
	onPress,
}: {
	styles: ManageStyles;
	title: string;
	hint?: string;
	onPress(): void;
}) {
	const [focused, setFocused] = useState(false);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={title}
			focusable
			onPress={onPress}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			style={({ pressed }) => [
				styles.actionRow,
				focused ? styles.actionRowFocused : null,
				pressed ? styles.pressed : null,
			]}
		>
			<View style={styles.actionRowText}>
				<Text style={styles.actionRowTitle}>{title}</Text>
				{hint ? <Text style={styles.actionRowHint}>{hint}</Text> : null}
			</View>
			<Text style={styles.chevron}>›</Text>
		</Pressable>
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
	const control =
		isValidElement(children) && (children.type === TextField || children.type === TextArea)
			? cloneElement(children as ReactElement<{ accessibilityLabel?: string }>, {
					accessibilityLabel:
						(children.props as { accessibilityLabel?: string }).accessibilityLabel ?? label,
				})
			: children;
	return (
		<View style={styles.field}>
			<Text style={styles.label}>{label}</Text>
			{control}
			{hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
	accessibilityLabel,
}: {
	styles: ManageStyles;
	value: string;
	onChangeText(value: string): void;
	placeholder?: string;
	secure?: boolean;
	autoCapitalize?: "none" | "sentences";
	accessibilityLabel?: string;
}) {
	const [focused, setFocused] = useState(false);
	return (
		<TextInput
			value={value}
			onChangeText={onChangeText}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			placeholder={placeholder}
			placeholderTextColor={styles.muted.color}
			accessibilityLabel={accessibilityLabel}
			secureTextEntry={secure}
			autoCapitalize={autoCapitalize}
			autoCorrect={false}
			style={[styles.input, focused ? styles.inputFocused : null]}
		/>
	);
}

export function TextArea({
	styles,
	value,
	onChangeText,
	placeholder,
	minHeight = 160,
	accessibilityLabel,
}: {
	styles: ManageStyles;
	value: string;
	onChangeText(value: string): void;
	placeholder?: string;
	minHeight?: number;
	accessibilityLabel?: string;
}) {
	const [focused, setFocused] = useState(false);
	return (
		<TextInput
			value={value}
			onChangeText={onChangeText}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			placeholder={placeholder}
			placeholderTextColor={styles.muted.color}
			accessibilityLabel={accessibilityLabel}
			multiline
			autoCapitalize="none"
			autoCorrect={false}
			style={[styles.textarea, { minHeight }, focused ? styles.inputFocused : null]}
		/>
	);
}

export function Badge({ styles, label }: { styles: ManageStyles; label: string }) {
	return <Text style={styles.badge}>{label}</Text>;
}

export function Notice({
	styles,
	tone = "muted",
	message,
}: {
	styles: ManageStyles;
	tone?: "muted" | "error" | "ok" | "warning";
	message: string | null;
}) {
	if (!message) return null;
	const color =
		tone === "error"
			? styles.error
			: tone === "ok"
				? styles.ok
				: tone === "warning"
					? styles.warning
					: styles.small;
	const dot =
		tone === "error"
			? styles.error
			: tone === "ok"
				? styles.ok
				: tone === "warning"
					? styles.warning
					: styles.muted;
	return (
		<View
			accessibilityRole={tone === "error" ? "alert" : undefined}
			accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
			style={[styles.notice, { borderColor: dot.color }]}
		>
			<View style={[styles.noticeDot, { backgroundColor: dot.color }]} />
			<Text style={[styles.noticeText, color]}>{message}</Text>
		</View>
	);
}

export function EmptyState({
	styles,
	title,
	hint,
	action,
}: {
	styles: ManageStyles;
	title: string;
	hint?: string;
	action?: ReactNode;
}) {
	return (
		<View style={styles.empty}>
			<Text style={styles.emptyTitle}>{title}</Text>
			{hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
			{action ? <View style={styles.emptyAction}>{action}</View> : null}
		</View>
	);
}

export function Switch({
	styles,
	value,
	onChange,
	disabled = false,
	label,
}: {
	styles: ManageStyles;
	value: boolean;
	onChange(value: boolean): void;
	disabled?: boolean;
	label: string;
}) {
	const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
	const [focused, setFocused] = useState(false);
	useEffect(() => {
		Animated.timing(progress, {
			toValue: value ? 1 : 0,
			duration: 160,
			useNativeDriver: false,
		}).start();
	}, [progress, value]);
	const trackColor = progress.interpolate({
		inputRange: [0, 1],
		outputRange: [styles.switchOff.backgroundColor, styles.buttonPrimary.backgroundColor],
	});
	const borderColor = focused
		? styles.inputFocused.borderColor
		: progress.interpolate({
				inputRange: [0, 1],
				outputRange: [styles.card.borderColor, styles.buttonPrimary.backgroundColor],
			});
	const thumbColor = progress.interpolate({
		inputRange: [0, 1],
		outputRange: ["#ffffff", styles.buttonTextPrimary.color],
	});
	const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 16] });
	return (
		<Pressable
			accessibilityRole="switch"
			accessibilityLabel={label}
			accessibilityState={{ checked: value, disabled }}
			aria-checked={value}
			focusable={!disabled}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onPress={() => onChange(!value)}
			disabled={disabled}
			hitSlop={8}
			style={[styles.switch, disabled ? styles.disabled : null]}
		>
			<Animated.View
				style={[styles.switchTrack, { backgroundColor: trackColor, borderColor }]}
			>
				<Animated.View
					style={[
						styles.switchThumb,
						{ backgroundColor: thumbColor, transform: [{ translateX }] },
					]}
				/>
			</Animated.View>
		</Pressable>
	);
}

export function Segmented<T extends string>({
	styles,
	value,
	options,
	onChange,
	disabled = false,
}: {
	styles: ManageStyles;
	value: T;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange(value: T): void;
	disabled?: boolean;
}) {
	const [focused, setFocused] = useState<string | null>(null);
	return (
		<View style={styles.segmented}>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<Pressable
						key={option.value}
						accessibilityRole="button"
						accessibilityState={{ selected: active }}
						aria-pressed={active}
						aria-disabled={disabled}
						focusable={!disabled}
						disabled={disabled}
						onPress={() => onChange(option.value)}
						onFocus={() => setFocused(option.value)}
						onBlur={() => setFocused(null)}
						style={[
							styles.segment,
							active ? styles.segmentActive : null,
							focused === option.value ? styles.segmentFocused : null,
						]}
					>
						<Text style={active ? styles.segmentTextActive : styles.segmentText}>
							{option.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

export function StatusDot({ styles, tone = "ok" }: { styles: ManageStyles; tone?: "ok" | "warning" | "error" }) {
	return (
		<View
			style={[
				styles.statusDot,
				{
					backgroundColor:
						tone === "error"
							? styles.error.color
							: tone === "warning"
								? styles.warning.color
								: styles.ok.color,
				},
			]}
		/>
	);
}
