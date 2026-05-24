import {
  DynamicBorder,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";
import { join, resolve } from "path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  renameSync,
} from "fs";

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getFilenameTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function parseNoteFile(
  filename: string,
  content: string,
): { title: string; date: string } {
  // Parse timestamp from filename: YYYYMMDD_HHMMSS
  const match = filename.match(
    /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.*)\.md$/,
  );
  let dateStr = "";
  if (match) {
    const [_, year, month, day, hour, minute] = match;
    dateStr = `${year}-${month}-${day} ${hour}:${minute}`;
  } else {
    dateStr = "Unknown Date";
  }

  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let title = "";

  if (lines.length > 0) {
    const firstLine = lines[0];
    if (firstLine.startsWith("# ")) {
      const parsedTitle = firstLine.slice(2).trim();
      if (parsedTitle === "Quick Note" || parsedTitle === "Note") {
        // Find first non-empty line of text that doesn't start with '#' or '*'
        const contentLine = lines.find(
          (line) => !line.startsWith("#") && !line.startsWith("*"),
        );
        title = contentLine || parsedTitle;
      } else {
        title = parsedTitle;
      }
    } else {
      title = firstLine;
    }
  }

  if (!title) {
    title = "Untitled Note";
  }

  return { title, date: dateStr };
}

export default function (pi: ExtensionAPI) {
  // Register custom flag for notes directory
  pi.registerFlag("notes-dir", {
    description:
      "Custom directory to save notes (absolute or relative to home/cwd)",
    type: "string",
  });

  // Helper to resolve the notes directory
  function getNotesDir(cwd: string): string {
    const flagVal = pi.getFlag("notes-dir") as string | undefined;
    if (flagVal) {
      if (flagVal.startsWith("~/")) {
        return join(process.env.HOME ?? "", flagVal.slice(2));
      }
      if (flagVal.startsWith("~")) {
        return join(process.env.HOME ?? "", flagVal.slice(1));
      }
      return resolve(cwd, flagVal);
    }
    // Default to notes/ folder in the current directory
    return join(cwd, "notes");
  }

  // Helper to ensure the notes directory exists
  function ensureNotesDir(cwd: string): string {
    const dir = getNotesDir(cwd);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  pi.registerCommand("note", {
    description:
      "Take a note. With arguments, saves a quick note. Without, opens multi-line editor.",
    handler: async (args, ctx) => {
      const text = args.trim();
      const dir = ensureNotesDir(ctx.cwd);
      const timestamp = getTimestamp();
      const tsFilename = getFilenameTimestamp();

      if (text) {
        // 1. Quick note
        // Sanitize the first 45 chars of text for the filename
        const sanitizedText = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 45)
          .replace(/-$/, ""); // Remove trailing hyphen if truncated

        const suffix = sanitizedText || "quick-note";
        const filename = `${tsFilename}_${suffix}.md`;
        const filePath = join(dir, filename);
        const fullNoteText = `# Quick Note\n\n*Created on ${timestamp}*\n\n${text}\n`;

        try {
          writeFileSync(filePath, fullNoteText, "utf-8");
          ctx.ui.notify(`Quick note saved to ${filename}`, "info");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`Error saving note: ${msg}`, "error");
        }
        return;
      }

      // 2. Interactive multi-line editor note
      const noteContent = await ctx.ui.editor(
        "Write your note (Esc to save, Ctrl+C to cancel):",
        "",
      );
      if (noteContent === null || noteContent === undefined) {
        ctx.ui.notify("Note cancelled", "warning");
        return;
      }

      if (!noteContent.trim()) {
        ctx.ui.notify("Cannot save empty note", "warning");
        return;
      }

      // Prompt for an optional title
      const titleInput = await ctx.ui.input(
        "Enter an optional title for this note:",
        "",
      );
      const title = titleInput?.trim() || "";

      const sanitizedTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const filename = sanitizedTitle
        ? `${tsFilename}_${sanitizedTitle}.md`
        : `${tsFilename}_note.md`;
      const filePath = join(dir, filename);

      const fullNoteText = `# ${title || "Note"}\n\n*Created on ${timestamp}*\n\n${noteContent}\n`;

      try {
        writeFileSync(filePath, fullNoteText, "utf-8");
        ctx.ui.notify(`Note saved to ${filename}`, "info");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Error saving note: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("notes", {
    description: "List, view, edit, or delete notes",
    handler: async (_args, ctx) => {
      const dir = ensureNotesDir(ctx.cwd);
      let lastSelectedFile: string | undefined;

      while (true) {
        if (!existsSync(dir)) {
          ctx.ui.notify("No notes directory found.", "info");
          return;
        }

        let files: string[] = [];
        try {
          files = readdirSync(dir).filter((f) => f.endsWith(".md"));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`Error reading notes: ${msg}`, "error");
          return;
        }

        if (files.length === 0) {
          ctx.ui.notify("No notes found.", "info");
          return;
        }

        // Sort files descending (newest first based on timestamp prefix)
        files.sort((a, b) => b.localeCompare(a));

        // Parse titles and dates for display formatting
        const selectItems = files.map((file) => {
          const filePath = join(dir, file);
          let content = "";
          try {
            content = readFileSync(filePath, "utf-8");
          } catch {
            // Fallback if read fails
          }
          const { title, date } = parseNoteFile(file, content);

          const isDone = file.endsWith("_done.md");
          const statusPrefix = isDone ? "[✓] " : "[ ] ";
          // Slice title if too long and pad to align dates nicely
          const displayTitle =
            title.length > 38 ? title.slice(0, 35) + "..." : title;
          const rawTitle = statusPrefix + displayTitle;
          const paddedRawTitle = rawTitle.padEnd(45, " ");

          let label = "";
          if (isDone) {
            label =
              ctx.ui.theme.fg("success", "[✓] ") +
              ctx.ui.theme.fg("muted", paddedRawTitle.slice(4)) +
              " " +
              ctx.ui.theme.fg("dim", date);
          } else {
            label =
              ctx.ui.theme.fg("muted", "[ ] ") +
              paddedRawTitle.slice(4) +
              " " +
              ctx.ui.theme.fg("dim", date);
          }

          return {
            value: file,
            label,
          };
        });

        const hasDoneNotes = files.some((file) => file.endsWith("_done.md"));
        if (hasDoneNotes) {
          selectItems.push({
            value: "__clear_completed__",
            label: ctx.ui.theme.fg("warning", "  [Clear Completed Notes]"),
          });
        }

        selectItems.push({
          value: "__delete_all__",
          label: ctx.ui.theme.fg("error", "  [Delete All Notes]"),
        });

        const result = await ctx.ui.custom<{
          action: "select" | "toggle" | "delete-all" | "clear-completed";
          file: string;
        } | null>((tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(
            new DynamicBorder((str: string) => theme.fg("accent", str)),
          );

          // Header
          container.addChild(
            new Text(theme.fg("accent", theme.bold(" Notes Manager")), 1, 0),
          );

          // SelectList with themed styling
          const selectList = new SelectList(
            selectItems,
            Math.min(selectItems.length, 12),
            {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          );

          // Restore last selected item position if possible
          if (lastSelectedFile) {
            const index = selectItems.findIndex(
              (item) => item.value === lastSelectedFile,
            );
            if (index !== -1) {
              selectList.setSelectedIndex(index);
            }
          }

          selectList.onSelect = (item) => {
            if (item.value === "__delete_all__") {
              done({ action: "delete-all", file: "" });
            } else if (item.value === "__clear_completed__") {
              done({ action: "clear-completed", file: "" });
            } else {
              done({ action: "select", file: item.value });
            }
          };
          selectList.onCancel = () => done(null);

          container.addChild(selectList);

          // Footer hint
          container.addChild(
            new Text(
              theme.fg(
                "dim",
                " ↑↓ navigate • enter action • space toggle done • esc exit",
              ),
              1,
              0,
            ),
          );

          container.addChild(
            new DynamicBorder((str: string) => theme.fg("accent", str)),
          );

          return {
            render(width: number) {
              return container.render(width);
            },
            invalidate() {
              container.invalidate();
            },
            handleInput(data: string) {
              if (data === " " || data === "t" || data === "x") {
                const selected = selectList.getSelectedItem();
                if (
                  selected &&
                  selected.value !== "__delete_all__" &&
                  selected.value !== "__clear_completed__"
                ) {
                  done({ action: "toggle", file: selected.value });
                  return;
                }
              }
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        });

        if (!result) break;

        if (result.action === "toggle") {
          const oldFile = result.file;
          const isDone = oldFile.endsWith("_done.md");
          const newFile = isDone
            ? oldFile.replace(/_done\.md$/, ".md")
            : oldFile.replace(/\.md$/, "_done.md");
          try {
            renameSync(join(dir, oldFile), join(dir, newFile));
            ctx.ui.notify(
              isDone ? "Marked note as undone" : "Marked note as done",
              "info",
            );
            lastSelectedFile = newFile;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            ctx.ui.notify(`Error toggling status: ${msg}`, "error");
          }
          continue;
        }

        if (result.action === "clear-completed") {
          const completedFiles = files.filter((f) => f.endsWith("_done.md"));
          const count = completedFiles.length;
          const confirm = await ctx.ui.confirm(
            "Clear Completed Notes?",
            `Are you sure you want to delete all ${count} completed notes?`,
          );
          if (confirm) {
            try {
              for (const file of completedFiles) {
                unlinkSync(join(dir, file));
              }
              ctx.ui.notify(`Cleared ${count} completed notes`, "info");
              lastSelectedFile = undefined;
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              ctx.ui.notify(`Error clearing completed notes: ${msg}`, "error");
            }
          }
          continue;
        }

        if (result.action === "delete-all") {
          const confirm = await ctx.ui.confirm(
            "Delete all notes?",
            "Are you sure you want to delete ALL notes? This action cannot be undone.",
          );
          if (confirm) {
            try {
              for (const file of files) {
                unlinkSync(join(dir, file));
              }
              ctx.ui.notify("Deleted all notes", "info");
              lastSelectedFile = undefined;
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              ctx.ui.notify(`Error deleting notes: ${msg}`, "error");
            }
          }
          continue;
        }

        const selectedFile = result.file;
        const filePath = join(dir, selectedFile);
        lastSelectedFile = selectedFile;

        try {
          const content = readFileSync(filePath, "utf-8");
          const isDone = selectedFile.endsWith("_done.md");
          const toggleLabel = isDone ? "Mark as Undone" : "Mark as Done";

          const action = await ctx.ui.select(`Note: ${selectedFile}`, [
            "View",
            toggleLabel,
            "Edit",
            "Delete",
            "Back to list",
          ]);
          if (!action || action === "Back to list") {
            continue;
          }

          if (action === toggleLabel) {
            const newFile = isDone
              ? selectedFile.replace(/_done\.md$/, ".md")
              : selectedFile.replace(/\.md$/, "_done.md");
            renameSync(filePath, join(dir, newFile));
            ctx.ui.notify(
              isDone ? "Marked note as undone" : "Marked note as done",
              "info",
            );
            lastSelectedFile = newFile;
          } else if (action === "View") {
            ctx.ui.notify(content, "info");
          } else if (action === "Edit") {
            // We open the editor prefilled with the file content
            const newContent = await ctx.ui.editor(
              `Editing ${selectedFile}:`,
              content,
            );
            if (
              newContent !== null &&
              newContent !== undefined &&
              newContent !== content
            ) {
              writeFileSync(filePath, newContent, "utf-8");
              ctx.ui.notify(`Saved changes to ${selectedFile}`, "info");
            }
          } else if (action === "Delete") {
            const confirm = await ctx.ui.confirm(
              "Delete note?",
              `Are you sure you want to delete ${selectedFile}?`,
            );
            if (confirm) {
              unlinkSync(filePath);
              ctx.ui.notify(`Deleted ${selectedFile}`, "info");
              lastSelectedFile = undefined;
            }
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`Error processing note: ${msg}`, "error");
        }
      }
    },
  });
}
