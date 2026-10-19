import { listPiSessions } from "../server/sessions";
import { fail, smokeDir } from "./pi-env";

const sessions = await listPiSessions({
	sessionDir: process.env.PI_SMOKE_DIR ?? smokeDir,
	cwd: process.env.PI_SMOKE_CWD ?? "/tmp",
	limit: 5,
});
if (!sessions.length) fail("no sessions found");
const createdAt = sessions[0]?.persistence.data;
if (!createdAt || typeof createdAt !== "object" || Array.isArray(createdAt)) fail("bad persistence");
if (typeof createdAt.sessionFile !== "string") fail("persistence has no sessionFile");
console.log(`OK list: ${sessions.length} session(s), newest ${createdAt.sessionFile}`);
