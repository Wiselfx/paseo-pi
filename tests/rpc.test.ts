import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PiRpc, PiRpcError } from "../server/provider/rpc";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));

function open(diagnostics: string[] = []) {
	return new PiRpc(
		{
			command: process.execPath,
			args: [fixture],
			cwd: process.cwd(),
			env: { NODE_OPTIONS: "" },
		},
		(text) => diagnostics.push(text),
	);
}

describe("PiRpc", () => {
	it("resolves a response by id", async () => {
		const rpc = open();
		try {
			await expect(rpc.request("test", { mode: "respond", value: 7 })).resolves.toEqual({
				echoed: 7,
			});
		} finally {
			await rpc.close();
		}
	});

	it("delivers events in order before the response", async () => {
		const rpc = open();
		const events: string[] = [];
		rpc.onEvent((record) => events.push(String(record.type)));
		try {
			await rpc.request("test", { mode: "event" });
			expect(events).toEqual(["agent_start", "queue_update"]);
		} finally {
			await rpc.close();
		}
	});

	it("reassembles a frame split across chunks", async () => {
		const rpc = open();
		try {
			await expect(rpc.request("test", { mode: "split" })).resolves.toEqual({ split: true });
		} finally {
			await rpc.close();
		}
	});

	it("handles two frames in one chunk and CRLF line endings", async () => {
		const rpc = open();
		const events: string[] = [];
		rpc.onEvent((record) => events.push(String(record.type)));
		try {
			await expect(rpc.request("test", { mode: "two" })).resolves.toEqual({ first: true });
			expect(events).toContain("agent_end");
			await expect(rpc.request("test", { mode: "crlf" })).resolves.toEqual({ crlf: true });
		} finally {
			await rpc.close();
		}
	});

	it("reports a malformed line as a diagnostic and keeps going", async () => {
		const diagnostics: string[] = [];
		const rpc = open(diagnostics);
		try {
			await expect(rpc.request("test", { mode: "garbage" })).resolves.toEqual({
				survived: true,
			});
			expect(diagnostics.join("\n")).toContain("not JSON");
		} finally {
			await rpc.close();
		}
	});

	it("rejects an unsuccessful response with pi's message", async () => {
		const rpc = open();
		try {
			await expect(rpc.request("test", { mode: "error" })).rejects.toMatchObject({
				name: "PiRpcError",
				message: "boom",
			});
		} finally {
			await rpc.close();
		}
	});

	it("times out, then fails pending requests when the child exits", async () => {
		const rpc = open();
		try {
			await expect(rpc.request("test", { mode: "silent" }, 150)).rejects.toThrow(
				/did not answer/,
			);
			const pending = rpc.request("test", { mode: "die" }, 5_000);
			await expect(pending).rejects.toBeInstanceOf(PiRpcError);
			await expect(rpc.request("test", { mode: "respond" })).rejects.toThrow(/closed|exited|writable/);
		} finally {
			await rpc.close();
		}
	});
});
