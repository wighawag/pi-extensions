# pi-cd

An extension for `pi-coding-agent` that registers a `/cd` command, designed to change the working directory of the agent and start a new session.

## Usage

```bash
/cd <directory>
```

**Examples:**
```bash
/cd ../another-project
/cd ~/dev/my-app
```

---

## Technical Limitation and Footguns (Detailed Analysis)

> ⚠️ **Note:** Dynamic directory switching (even when utilizing custom forks of `pi`) has known issues and is not fully supported by the agent's runtime.

### The Custom Fork Attempt (`ctx.ui.setCwd`)

In custom development forks of `pi-coding-agent` (such as `/home/wighawag/dev/github/wighawag/pi`), a `ctx.ui.setCwd(resolved)` API was introduced to try to handle directory switching. An implementation of `/cd` (or `/new [folder]`) using that fork looks like this:

```typescript
// Change the Node.js process working directory
process.chdir(resolved);

// Update pi's internal CWD tracking (footer display + session manager)
ctx.ui.setCwd(resolved);

// Create a new session in the new directory
await ctx.newSession({ ... });
```

### Why "there are still issues" (Root Cause)

Even with the custom fork's `ctx.ui.setCwd(resolved)` helper, the directory switch does not fully propagate to the new session's tools (such as bash, file explorer, etc.). This happens because:

1. **Unchanged `AgentSessionRuntime.cwd`:** The `AgentSessionRuntime` class has a getter that references its active services CWD:
   ```javascript
   get cwd() {
       return this._services.cwd;
   }
   ```
   Calling `ctx.ui.setCwd(resolved)` updates the active `SessionManager`'s CWD, but it does **not** update the underlying `this._services.cwd` property on the running `AgentSessionRuntime` instance.

2. **New Session is Created with Old CWD:** When `ctx.newSession()` is called, it initializes the new session using the runtime's fixed `this.cwd` (the original startup directory):
   ```javascript
   const sessionManager = SessionManager.create(this.cwd, sessionDir);
   ```

3. **Services Rebuilt with Old CWD:** The runtime then recreates its environment and tools by calling `createRuntime` with that same old CWD:
   ```javascript
   this.apply(await this.createRuntime({
       cwd: this.cwd, // <--- Still references the original cached CWD!
       agentDir: this.services.agentDir,
       sessionManager,
       sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
   }));
   ```

Because of this, the new session's workspace tools (like file explorer and terminal/bash execution) are rebuilt using the **original starting directory**, completely ignoring the process-level `process.chdir(resolved)` and `ctx.ui.setCwd(resolved)` modifications.

### Conclusion

To properly support a dynamic `/cd` command, the `pi-coding-agent` core framework would need to be updated to:
- Dynamically resolve `process.cwd()` instead of caching `this.cwd` at startup, or
- Support a `cwd` / `cwdOverride` parameter directly on the `ctx.newSession({ cwd })` API so that the next runtime rebuild is fully targeted to the new directory.
