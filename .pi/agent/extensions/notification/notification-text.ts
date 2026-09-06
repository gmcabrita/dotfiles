import { stripVTControlCharacters } from "node:util";

const NOTIFICATION_PREVIEW_GRAPHEMES = 200;
// Ghostty captures text after "9;" in 2048 bytes, including its trailing NUL.
const NOTIFICATION_MAX_BYTES = 2047;
const NOTIFICATION_ELLIPSIS = "…";
const notificationSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Format response text for OSC 9 without control codes or split Unicode graphemes. */
export function formatNotificationText(response: string): string {
  const text = stripVTControlCharacters(response)
    .replace(/\s+/gu, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/gu, "")
    .replace(/ +/g, " ")
    .trim();
  if (!text) return "Pi is ready for input";

  // Ghostty can read text that starts with a digit as a ConEmu OSC 9 command.
  const prefix = /^[0-9]/u.test(text) ? " " : "";
  const graphemes: string[] = [];
  let bytes = Buffer.byteLength(prefix);
  for (const { segment } of notificationSegmenter.segment(text)) {
    const segmentBytes = Buffer.byteLength(segment);
    if (
      graphemes.length === NOTIFICATION_PREVIEW_GRAPHEMES ||
      bytes + segmentBytes > NOTIFICATION_MAX_BYTES
    ) {
      while (
        graphemes.length > 0 &&
        (graphemes.length >= NOTIFICATION_PREVIEW_GRAPHEMES ||
          bytes + Buffer.byteLength(NOTIFICATION_ELLIPSIS) > NOTIFICATION_MAX_BYTES)
      ) {
        bytes -= Buffer.byteLength(graphemes.pop()!);
      }
      return prefix + graphemes.join("").trimEnd() + NOTIFICATION_ELLIPSIS;
    }
    graphemes.push(segment);
    bytes += segmentBytes;
  }
  return prefix + graphemes.join("");
}
