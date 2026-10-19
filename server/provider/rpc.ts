import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export class PiRpcError extends Error {
	constructor(
		message: string,
		readonly command?: string,
	) {
		super(message);
		this.name = "PiRpcError";
	}
}

export interface PiRpcSpawnOptions {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

type Pending = {
	command: string;
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout;
};

const MAX_STDERR = 16 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * One pi RPC child process. JSONL on stdout, commands on stdin, diagnostics on stderr, exactly as
 * docs/rpc.md describes: split on LF only, and never parse stderr as protocol data.
 */
export class PiRpc {
	readonly child: ChildProcessWithoutNullStreams;
	readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	private readonly pending = new Map<string, Pending>();
	private readonly events = new Set<(record: Record<string, unknown>) => void>();
	private readonly exits = new Set<(info: { code: number | null }) => void>();
	private stderr = "";
	private closed = false;
	private closePromise: Promise<void> | null = null;
	private resolveExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;

	constructor(
		options: PiRpcSpawnOptions,
		private readonly onDiagnostic?: (text: string) => void,
	) {
		this.child = spawn(options.command, options.args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		this.child.stdin.on("error", (error: Error) => {
			this.onDiagnostic?.(`pi stdin failed: ${error.message}`);
			this.failPending(new PiRpcError(`pi stdin failed: ${error.message}`));
		});
		this.child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
		this.child.stderr.setEncoding("utf8");
		this.child.stderr.on("data", (chunk: string) => this.recordStderr(chunk));
		this.exit = new Promise((resolve) => {
			this.resolveExit = resolve;
			this.child.on("exit", (code, signal) => {
				const error = new PiRpcError(
					`pi exited (${signal ?? code ?? "unknown"})${this.stderrSuffix()}`,
				);
				this.failPending(error);
				for (const listener of this.exits) listener({ code });
				resolve({ code, signal });
			});
		});
		this.child.on("error", (error) => {
			this.failPending(new PiRpcError(`pi could not start: ${error.message}`));
			// A spawn error does not always produce an exit event; unblock close().
			this.resolveExit?.({ code: null, signal: null });
		});
	}

	get stderrText(): string {
		return this.stderr;
	}

	get namespaceId(): string {
		return randomUUID();
	}

	onEvent(listener: (record: Record<string, unknown>) => void): () => void {
		this.events.add(listener);
		return () => this.events.delete(listener);
	}

	onExit(listener: (info: { code: number | null }) => void): () => void {
		this.exits.add(listener);
		return () => this.exits.delete(listener);
	}

	/** Send a command and wait for its response record; resolves the response `data`. */
	async request(
		command: string,
		payload: Record<string, unknown> = {},
		timeoutMs = REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		if (this.closed) throw new PiRpcError("pi RPC session is closed", command);
		const id = `${this.namespaceId.slice(0, 8)}-${++requestCounter}`;
		const record = { id, type: command, ...payload };
		const response = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new PiRpcError(`pi did not answer ${command} in ${timeoutMs} ms`, command));
			}, timeoutMs);
			this.pending.set(id, { command, resolve, reject, timer });
		});
		try {
			this.write(record);
		} catch (error) {
			const pending = this.pending.get(id);
			if (pending) clearTimeout(pending.timer);
			this.pending.delete(id);
			throw error;
		}
		const data = await response;
		return data;
	}

	/** Send a command whose response is not awaited (prompt/steer already stream events). */
	write(record: Record<string, unknown>): void {
		if (this.closed) throw new PiRpcError("pi RPC session is closed");
		if (!this.child.stdin.writable) throw new PiRpcError("pi RPC stdin is not writable");
		this.child.stdin.write(`${JSON.stringify(record)}\n`);
	}

	async close(timeoutMs = 5_000): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = (async () => {
			this.closed = true;
			// Closing stdin is pi's orderly shutdown request.
			this.child.stdin.end();
			const exited = await Promise.race([
				this.exit.then(() => true),
				new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
			]);
			if (!exited) {
				this.child.kill("SIGTERM");
				const terminated = await Promise.race([
					this.exit.then(() => true),
					new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
				]);
				if (!terminated) this.child.kill("SIGKILL");
			}
			this.failPending(new PiRpcError("pi RPC session closed"));
		})();
		return this.closePromise;
	}

	kill(): void {
		this.closed = true;
		this.child.kill("SIGKILL");
	}

	private writeFrame(record: Record<string, unknown>): void {
		this.write(record);
	}

	private consume(chunk: Buffer): void {
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const index = this.buffer.indexOf(0x0a);
			if (index === -1) {
				// A single frame is a few hundred KB at most; anything larger is not protocol data.
				if (this.buffer.length > 64 * 1024 * 1024) {
					this.buffer = Buffer.alloc(0);
					this.onDiagnostic?.("pi sent an oversized RPC frame");
				}
				return;
			}
			let line = this.buffer.subarray(0, index);
			this.buffer = this.buffer.subarray(index + 1);
			if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, -1);
			if (line.length === 0) continue;
			let record: unknown;
			try {
				record = JSON.parse(line.toString("utf8"));
			} catch {
				this.onDiagnostic?.("pi sent a line that is not JSON");
				continue;
			}
			if (!record || typeof record !== "object" || Array.isArray(record)) continue;
			this.handle(record as Record<string, unknown>);
		}
	}

	private handle(record: Record<string, unknown>): void {
		if (record.type === "response") {
			const id = typeof record.id === "string" ? record.id : undefined;
			const pending = id ? this.pending.get(id) : undefined;
			if (pending) {
				this.pending.delete(id as string);
				clearTimeout(pending.timer);
				if (record.success === true) pending.resolve(record.data);
				else {
					pending.reject(
						new PiRpcError(
							typeof record.error === "string" && record.error.trim()
								? record.error
								: `${pending.command} failed`,
							pending.command,
						),
					);
				}
			}
			// A parse failure has no id; it is diagnostic only.
			return;
		}
		for (const listener of this.events) {
			try {
				listener(record);
			} catch (error) {
				this.onDiagnostic?.(
					`pi event listener failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	private recordStderr(text: string): void {
		this.stderr += text;
		if (this.stderr.length > MAX_STDERR) this.stderr = this.stderr.slice(-MAX_STDERR);
	}

	private stderrSuffix(): string {
		const trimmed = this.stderr.trim();
		if (!trimmed) return "";
		const lastLine = trimmed.split("\n").at(-1) ?? trimmed;
		return `: ${lastLine.slice(0, 300)}`;
	}

	private failPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

let requestCounter = 0;
