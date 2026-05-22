# pi-extensions

A workspace of extensions for [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent).

## Available Extensions

- **[echo](./extensions/echo)**: A simple `/echo` command that echoes back whatever you type.
- **[stop-command](./extensions/stop-command)**: A `/stop` command that interrupts current model generation.
- **[cd](./extensions/cd)**: A `/cd` command that attempts to change the current working directory of the agent and start a new session.

---

## Technical Limitations

### The `/cd` Extension and Dynamic Directory Switching

The `cd` extension attempts to dynamically change the active working directory and start a new session. Even when paired with a custom fork of `pi` that provides `ctx.ui.setCwd(path)`, there are still known issues with this approach.

#### Why "there are still issues"
When the `cd` command executes, it changes the process directory via `process.chdir(resolved)` and calls `ctx.ui.setCwd(resolved)` to update the display and active `SessionManager` CWD. 

However, when a new session is subsequently started with `ctx.newSession()`, the agent's runtime tools and environment (bash, file explorer, etc.) **still start in the old directory**.

This is because:
1. `AgentSessionRuntime` caches the startup working directory under `this.cwd` (read from `this._services.cwd` at process launch).
2. `ctx.ui.setCwd(resolved)` does not update `this._services.cwd` on the runtime instance.
3. During the `newSession()` flow, the core framework instantiates the new runtime environment and builds its workspace tools by passing the old, cached `this.cwd` to `createRuntime`.

For a full technical breakdown of this limitation, see the [cd extension README](./extensions/cd/README.md).
