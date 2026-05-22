import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "path";
import { statSync } from "fs";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cd", {
		description: "Change working directory and start a new session",
		handler: async (args, ctx) => {
			const target = args.trim();
			if (!target) {
				ctx.ui.notify(
					"Usage: /cd <directory>\n\nExamples:\n  /cd ../another-project\n  /cd ~/dev/my-app",
					"warning",
				);
				return;
			}

			const resolved = resolve(join(ctx.cwd, target));
			const display = resolved.replace(process.env.HOME ?? "", "~");

			try {
				const stats = statSync(resolved);
				if (!stats.isDirectory()) {
					ctx.ui.notify(`${display} is not a directory`, "error");
					return;
				}
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				ctx.ui.notify(`Error: ${msg}`, "error");
				return;
			}

			const oldSession = ctx.sessionManager.getSessionFile();

			// Change the Node.js process working directory
			process.chdir(resolved);

			ctx.ui.notify(`Working directory: ${display}`, "info");

			// Create a new session in the new directory
			// Pass the old session as parent so it can be resumed
			const result = await ctx.newSession({
				parentSession: oldSession,
				withSession: async (newCtx) => {
					if (oldSession) {
						const oldDisplay = oldSession.replace(process.env.HOME ?? "", "~");
						newCtx.ui.notify(`Old session: ${oldDisplay} (use /resume to switch back)`, "info");
					}
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("New session cancelled", "warning");
			}
		},
	});
}
