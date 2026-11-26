/**
 * Completes `$name` in the editor and replaces it with the variable's value.
 *
 * `$workdir` and `$cwd` resolve to the session's working directory; any other
 * name resolves to an environment variable.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

const MAX_SUGGESTIONS = 20;
const TOKEN_PATTERN = /(?:^|[\s"'`(])\$([A-Za-z_][A-Za-z0-9_]*)?$/;
const OWN_PREFIX = /^\$[A-Za-z0-9_]*$/;

function variables(cwd: string): Map<string, string> {
  const vars = new Map<string, string>([
    ["workdir", cwd],
    ["cwd", cwd],
  ]);
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !vars.has(name)) vars.set(name, value);
  }
  return vars;
}

function matching(vars: Map<string, string>, query: string): AutocompleteItem[] {
  const lowerQuery = query.toLowerCase();
  return [...vars]
    .filter(([name]) => name.toLowerCase().startsWith(lowerQuery))
    .slice(0, MAX_SUGGESTIONS)
    .map(([name, value]) => ({ value, label: `$${name}`, description: value }));
}

function createProvider(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
  return {
    triggerCharacters: [...(current.triggerCharacters ?? []), "$"],

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const match = beforeCursor.match(TOKEN_PATTERN);
      if (!match) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      const query = match[1] ?? "";
      const items = matching(variables(cwd), query);
      if (items.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      return { prefix: `$${query}`, items };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!OWN_PREFIX.test(prefix)) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }
      const line = lines[cursorLine] ?? "";
      const start = cursorCol - prefix.length;
      const newLines = [...lines];
      newLines[cursorLine] = line.slice(0, start) + item.value + line.slice(cursorCol);
      return { lines: newLines, cursorLine, cursorCol: start + item.value.length };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) => createProvider(current, ctx.cwd));
  });
}
