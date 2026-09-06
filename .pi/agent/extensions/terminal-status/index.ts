import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerTerminalNotification from "./terminal-notification.ts";
import titlebarSpinnerExtension from "./titlebar-spinner.ts";

/** Register terminal status callbacks in order so notifications use the idle title. */
export default function registerTerminalStatus(pi: ExtensionAPI) {
  // Pi awaits callbacks in registration order. Clear the spinner before OSC 9.
  titlebarSpinnerExtension(pi);
  registerTerminalNotification(pi);
}
