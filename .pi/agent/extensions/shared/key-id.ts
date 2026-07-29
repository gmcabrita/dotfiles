import type { KeyId } from "@earendil-works/pi-tui";

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
const SPECIAL_KEYS = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageUp",
  "pageDown",
  "up",
  "down",
  "left",
  "right",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);
const SYMBOL_KEYS = new Set([
  "`",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "|",
  "~",
  "{",
  "}",
  ":",
  "<",
  ">",
  "?",
]);

function isBaseKey(value: string): boolean {
  return /^[a-z0-9]$/.test(value) || SPECIAL_KEYS.has(value) || SYMBOL_KEYS.has(value);
}

/** Validate extension-config input before narrowing it to Pi's closed key-id type. */
export function isKeyId(value: string): value is KeyId {
  let key = value;
  const modifiers = new Set<string>();

  while (key !== "+") {
    const separator = key.indexOf("+");
    if (separator <= 0) break;

    const modifier = key.slice(0, separator);
    if (!MODIFIERS.has(modifier) || modifiers.has(modifier)) return false;

    modifiers.add(modifier);
    key = key.slice(separator + 1);
  }

  return isBaseKey(key);
}
