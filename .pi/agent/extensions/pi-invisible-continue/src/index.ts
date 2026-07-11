/**
 * Shared constants and utilities for pi-invisible-continue.
 *
 * The extension is small enough that heavy shared logic is unnecessary.
 * The command description and a session introspection helper are the only exports.
 */

/** Description shown in the / commands list. */
export const CONTINUE_COMMAND_DESCRIPTION =
  "Resume the agentic loop without sending a prompt the LLM can read";

/**
 * Extract the text content of the last assistant message in the session.
 * Returns undefined if no assistant message exists.
 */
export function getLastAssistantMessageText(
  entries: ReadonlyArray<{ type: string; message?: { role?: string; content?: unknown } }>,
): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (
      entry.type === "message" &&
      entry.message?.role === "assistant" &&
      entry.message?.content
    ) {
      const content = entry.message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const textBlocks = content.filter(
          (block: any): block is { type: "text"; text: string } =>
            typeof block === "object" &&
            block !== null &&
            block.type === "text" &&
            typeof block.text === "string",
        );
        if (textBlocks.length === 0) return undefined;
        return textBlocks.map((block) => block.text).join("\n");
      }
    }
  }
  return undefined;
}
