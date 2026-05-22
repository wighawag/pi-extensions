import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("stop", {
		description: "Interrupt the current model generation",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				await ctx.abort();
				ctx.ui.notify("Aborted.", "info");
			} else {
				ctx.ui.notify("Nothing to stop.", "info");
			}
		},
	});
}
