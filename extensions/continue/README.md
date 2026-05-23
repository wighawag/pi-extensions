# pi-continue

An extension for `pi-coding-agent` that automatically or manually schedules a continuation message (e.g., "continue") after a Claude plan limit (HTTP 429 Rate Limit) or other provider rate limit is hit, and resumes execution once available.

## Features

- **Automated Rate Limit Detection**: Listens to the `after_provider_response` event to detect HTTP 429 errors.
- **Multi-Header Delay Parsing**: Extracts precise reset delays from standard and provider-specific response headers, including:
  - `retry-after`
  - `anthropic-ratelimit-requests-reset`
  - `anthropic-ratelimit-tokens-reset`
  - `x-ratelimit-reset`
  - `ratelimit-reset`
- **TUI Live Countdown**: Displays a real-time countdown in the status bar (footer) so you can see exactly when the agent will resume.
- **Smart Cancellation**:
  - Automatically cancels the countdown if you start entering a manual prompt or command.
  - Cancel anytime with the `/continue-cancel` command.
- **Manual Continuation**: Schedule manual continuations in the future using `/continue-in <duration> [message]`.

---

## Slash Commands

### 1. `/continue-in <duration> [message]`
Schedules an automatic continuation message in a specific amount of time. 

**Format:**
```bash
/continue-in <duration> [message]
```

**Examples:**
- `/continue-in 10s` - Send "continue" in 10 seconds.
- `/continue-in 5m` - Send "continue" in 5 minutes.
- `/continue-in 1h` - Send "continue" in 1 hour.
- `/continue-in 1m30s` - Send "continue" in 1 minute and 30 seconds.
- `/continue-in 5m "Keep going with the implementation"` - Send a custom message in 5 minutes.

---

### 2. `/continue-cancel`
Cancels any currently active countdown timer.

**Examples:**
```bash
/continue-cancel
```

---

## CLI Flags & Configuration

You can configure the default behavior using command-line flags.

### `--continue-delay <duration>`
The default delay to use if an HTTP 429 error occurs but no rate limit reset headers can be parsed (or if the headers don't specify a delay).

- **Type**: `string`
- **Default**: `"60s"`
- **Examples**:
  ```bash
  pi --continue-delay 5m
  pi --continue-delay 30s
  ```

### `--continue-auto <true|false>`
Enable or disable automatic continuation after a provider rate limit is hit. If disabled, you can still schedule continuations manually using `/continue-in`.

- **Type**: `boolean`
- **Default**: `true`
- **Examples**:
  ```bash
  pi --continue-auto false
  ```

---

## Technical Details

1. **Wait-For-Idle Safety**: When the countdown timer expires, the extension calls `await ctx.waitForIdle()` before sending the message to ensure any running agent processes or UI teardowns have completed cleanly.
2. **Graceful Cleanup**: Registered timers and countdown intervals are fully disposed during `session_shutdown` to prevent memory leaks or background task execution when switching sessions or reloading the runtime.
