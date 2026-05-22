import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("echo", {
		description: "Echo back whatever you type",
		handler: async (args, ctx) => {
			ctx.ui.notify(args || "Nothing to echo", "info");
		},
	});
}
