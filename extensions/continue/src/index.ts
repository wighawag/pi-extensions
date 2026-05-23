import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let activeTimer: NodeJS.Timeout | null = null;
  let countdownInterval: NodeJS.Timeout | null = null;
  let remainingMs = 0;
  let currentReason = "";

  // Register CLI flags
  pi.registerFlag("continue-delay", {
    description:
      "Default wait time (e.g., 30s, 2m, 60) for automatic continuation after rate limit",
    type: "string",
    default: "60s",
  });

  pi.registerFlag("continue-auto", {
    description:
      "Enable automatic continuation after rate limit / plan limit hit",
    type: "boolean",
    default: true,
  });

  // Helper to format remaining time nicely
  function formatTime(ms: number): string {
    if (ms <= 0) return "0s";
    const seconds = Math.ceil(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  }

  // Helper to parse duration string (e.g., 30s, 5m, 1h) into milliseconds
  function parseDuration(arg: string): number | null {
    const trimmed = arg.trim().toLowerCase();
    if (!trimmed) return null;

    // Regex to match parts like "1h", "5m", "30s", "100ms"
    const regex =
      /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?\s*(?:(\d+)\s*ms)?$/;
    const match = trimmed.match(regex);
    if (match) {
      const hours = Number(match[1] || 0);
      const minutes = Number(match[2] || 0);
      const seconds = Number(match[3] || 0);
      const ms = Number(match[4] || 0);

      if (hours || minutes || seconds || ms) {
        return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
      }
    }

    // Fallback to pure number as seconds
    const val = Number(trimmed);
    if (!isNaN(val)) {
      return val * 1000;
    }

    return null;
  }

  // Helper to parse reset header values (timestamps or durations)
  function parseResetHeader(headerVal: string): number | null {
    if (!headerVal) return null;
    const num = Number(headerVal);
    if (!isNaN(num)) {
      // If it's a small number, assume it's seconds
      if (num < 1000000) {
        return num * 1000;
      } else {
        // Unix timestamp in seconds or milliseconds
        if (num < 9999999999) {
          return Math.max(0, num * 1000 - Date.now());
        } else {
          return Math.max(0, num - Date.now());
        }
      }
    }

    // ISO 8601 or HTTP Date
    const parsedDate = Date.parse(headerVal);
    if (!isNaN(parsedDate)) {
      return Math.max(0, parsedDate - Date.now());
    }

    return null;
  }

  // Helper to get configured default delay
  function getDefaultDelay(): number {
    const flagVal = pi.getFlag("continue-delay");
    if (typeof flagVal === "string") {
      const parsed = parseDuration(flagVal);
      if (parsed !== null) return parsed;
    }
    return 60 * 1000; // Default to 60 seconds
  }

  // Helper to wait until the agent is completely idle
  async function waitForIdle(ctx: ExtensionContext) {
    while (!ctx.isIdle()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Clear active timer and status indicator
  function clearActiveTimer(ctx: ExtensionContext) {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    remainingMs = 0;
    currentReason = "";
    ctx.ui.setStatus("pi-continue-extension", undefined);
  }

  // Start a countdown timer to trigger continuation
  function startContinuationTimer(
    delayMs: number,
    reason: string,
    ctx: ExtensionContext,
    customMessage = "continue",
  ) {
    clearActiveTimer(ctx);

    remainingMs = delayMs;
    currentReason = reason;

    ctx.ui.notify(
      `Rate limit / plan limit hit (${reason}). Scheduling continuation in ${formatTime(delayMs)}. Run /continue-cancel to abort.`,
      "warning",
    );

    const updateStatus = () => {
      if (remainingMs <= 0) {
        ctx.ui.setStatus("pi-continue-extension", undefined);
        return;
      }
      ctx.ui.setStatus(
        "pi-continue-extension",
        ctx.ui.theme.fg(
          "warning",
          `Continuing in ${formatTime(remainingMs)}... [${reason}] (Run /continue-cancel to abort)`,
        ),
      );
    };

    updateStatus();

    countdownInterval = setInterval(() => {
      remainingMs -= 1000;
      if (remainingMs <= 0) {
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
      } else {
        updateStatus();
      }
    }, 1000);

    activeTimer = setTimeout(async () => {
      clearActiveTimer(ctx);
      ctx.ui.notify(`Time is up! Sending "${customMessage}"...`, "info");
      try {
        // Wait for the agent to be completely idle (in case any tasks/teardown are finishing)
        await waitForIdle(ctx);
        pi.sendUserMessage(customMessage);
      } catch (err: any) {
        ctx.ui.notify(
          `Failed to automatically continue: ${err.message}`,
          "error",
        );
      }
    }, delayMs);
  }

  // Event: after_provider_response
  pi.on("after_provider_response", (event, ctx) => {
    const autoEnabled = pi.getFlag("continue-auto");
    if (autoEnabled === false || autoEnabled === "false") {
      return;
    }

    if (event.status === 429) {
      let delayMs = 0;

      // Check for standard and provider-specific rate limit / reset headers (case-insensitive keys)
      const headers = Object.fromEntries(
        Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v]),
      );

      const retryAfter = headers["retry-after"];
      const anthropicRequestsReset =
        headers["anthropic-ratelimit-requests-reset"];
      const anthropicTokensReset = headers["anthropic-ratelimit-tokens-reset"];
      const xRateLimitReset = headers["x-ratelimit-reset"];
      const rateLimitReset = headers["ratelimit-reset"];

      if (retryAfter) {
        const parsed = parseResetHeader(retryAfter);
        if (parsed !== null) delayMs = Math.max(delayMs, parsed);
      }
      if (anthropicRequestsReset) {
        const parsed = parseResetHeader(anthropicRequestsReset);
        if (parsed !== null) delayMs = Math.max(delayMs, parsed);
      }
      if (anthropicTokensReset) {
        const parsed = parseResetHeader(anthropicTokensReset);
        if (parsed !== null) delayMs = Math.max(delayMs, parsed);
      }
      if (xRateLimitReset) {
        const parsed = parseResetHeader(xRateLimitReset);
        if (parsed !== null) delayMs = Math.max(delayMs, parsed);
      }
      if (rateLimitReset) {
        const parsed = parseResetHeader(rateLimitReset);
        if (parsed !== null) delayMs = Math.max(delayMs, parsed);
      }

      // Use default delay if no reset time found or if parsed delay is <= 0
      if (delayMs <= 0) {
        delayMs = getDefaultDelay();
      }

      // Add a tiny buffer (e.g., 500ms) to ensure we are truly past the reset window
      delayMs += 500;

      startContinuationTimer(delayMs, "HTTP 429 Rate Limit", ctx);
    }
  });

  // Event: agent_start
  // If a new agent loop starts while a timer is pending, cancel the timer (user is manually typing or interacting)
  pi.on("agent_start", (_event, ctx) => {
    if (activeTimer) {
      clearActiveTimer(ctx);
      ctx.ui.notify(
        "Scheduled continuation cancelled because a new agent turn started.",
        "info",
      );
    }
  });

  // Event: session_shutdown
  pi.on("session_shutdown", (_event, ctx) => {
    clearActiveTimer(ctx);
  });

  // Command: /continue-in <duration> [message]
  pi.registerCommand("continue-in", {
    description:
      "Schedule an automatic continuation message in X time (e.g., 5m, 30s)",
    getArgumentCompletions: (prefix: string) => {
      const suggestions = ["10s", "30s", "1m", "5m", "10m"];
      return suggestions
        .filter((s) => s.startsWith(prefix))
        .map((s) => ({ value: s, label: s }));
    },
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify(
          "Usage: /continue-in <duration> [message]. E.g., /continue-in 5m",
          "error",
        );
        return;
      }

      const spaceIdx = args.indexOf(" ");
      let durationStr = args;
      let customMessage = "continue";

      if (spaceIdx !== -1) {
        durationStr = args.slice(0, spaceIdx);
        customMessage = args.slice(spaceIdx + 1).trim();
        // Strip outer quotes if they exist
        if (
          (customMessage.startsWith('"') && customMessage.endsWith('"')) ||
          (customMessage.startsWith("'") && customMessage.endsWith("'"))
        ) {
          customMessage = customMessage.slice(1, -1);
        }
      }

      const delayMs = parseDuration(durationStr);
      if (delayMs === null) {
        ctx.ui.notify(
          `Invalid duration: "${durationStr}". Supported formats: 30s, 5m, 1h, or raw seconds.`,
          "error",
        );
        return;
      }

      startContinuationTimer(delayMs, "Manual Request", ctx, customMessage);
    },
  });

  // Command: /continue-cancel
  pi.registerCommand("continue-cancel", {
    description: "Cancel any scheduled automatic continuation timer",
    handler: async (_args, ctx) => {
      if (activeTimer || countdownInterval) {
        clearActiveTimer(ctx);
        ctx.ui.notify("Scheduled continuation cancelled.", "info");
      } else {
        ctx.ui.notify("No active continuation timer to cancel.", "warning");
      }
    },
  });
}
