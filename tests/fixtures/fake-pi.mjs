import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const response = (id, data) => ({ type: "response", id, command: "test", success: true, data });

rl.on("line", (line) => {
	let record;
	try {
		record = JSON.parse(line);
	} catch {
		return;
	}
	switch (record.mode) {
		case "respond":
			send(response(record.id, { echoed: record.value ?? null }));
			break;
		case "error":
			send({ type: "response", id: record.id, command: "test", success: false, error: "boom" });
			break;
		case "event":
			send({ type: "agent_start" });
			send({ type: "queue_update", pending: 1 });
			send(response(record.id, { ok: true }));
			break;
		case "split": {
			const frame = `${JSON.stringify(response(record.id, { split: true }))}\n`;
			process.stdout.write(frame.slice(0, 10));
			setTimeout(() => process.stdout.write(frame.slice(10)), 20);
			break;
		}
		case "two":
			process.stdout.write(
				`${JSON.stringify(response(record.id, { first: true }))}\n${JSON.stringify({ type: "agent_end" })}\n`,
			);
			break;
		case "crlf":
			process.stdout.write(
				`${JSON.stringify(response(record.id, { crlf: true })).replace(/\n/g, "")}\r\n`,
			);
			break;
		case "garbage":
			process.stdout.write("this is not json\n");
			send(response(record.id, { survived: true }));
			break;
		case "silent":
			break;
		case "die":
			process.exit(3);
			break;
		default:
			send(response(record.id, null));
	}
});

process.stdin.on("end", () => process.exit(0));
