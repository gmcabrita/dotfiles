import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import titlebarSpinnerExtension from "./titlebar-spinner.ts";

/** Register terminal status callbacks. Rex sends the notification when Pi finishes. */
export default function registerTerminalStatus(pi: ExtensionAPI) {
  titlebarSpinnerExtension(pi);
}
