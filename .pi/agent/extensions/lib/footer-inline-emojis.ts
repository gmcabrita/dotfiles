import { FooterComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type FooterEmoji = {
  emoji: string;
  order: number;
  active: boolean;
};

const entries = new Map<string, FooterEmoji>();
const originalFooterRender = FooterComponent.prototype.render;
let patched = false;

function activeEmojis(): string[] {
  return Array.from(entries.values())
    .filter((entry) => entry.active)
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.emoji);
}

function addEmojisAfterCwd(line: string, width: number, emojis: string[]): string {
  if (emojis.length === 0) {
    return line;
  }

  const suffix = ` ${emojis.join(" ")}`;
  const suffixWidth = visibleWidth(suffix);

  if (visibleWidth(line) + suffixWidth <= width) {
    return line + suffix;
  }

  return truncateToWidth(line, Math.max(0, width - suffixWidth), "") + suffix;
}

function patchNativeFooter(): void {
  if (patched) {
    return;
  }

  FooterComponent.prototype.render = function renderWithFooterEmojis(this: FooterComponent, width: number): string[] {
    const lines = originalFooterRender.call(this, width);
    const emojis = activeEmojis();
    if (emojis.length === 0 || lines.length < 1) {
      return lines;
    }

    return [addEmojisAfterCwd(lines[0], width, emojis), ...lines.slice(1)];
  };
  patched = true;
}

function restoreNativeFooter(): void {
  if (!patched || entries.size > 0) {
    return;
  }

  FooterComponent.prototype.render = originalFooterRender;
  patched = false;
}

export function registerFooterEmoji(key: string, emoji: string, order: number): () => void {
  entries.set(key, { emoji, order, active: false });
  patchNativeFooter();

  return () => {
    entries.delete(key);
    restoreNativeFooter();
  };
}

export function setFooterEmojiActive(key: string, active: boolean, ctx?: ExtensionContext): void {
  const entry = entries.get(key);
  if (!entry) {
    return;
  }

  entry.active = active;
  if (ctx?.mode === "tui") {
    ctx.ui.setStatus(key, undefined);
  }
}

export function setFooterEmoji(key: string, emoji: string, ctx?: ExtensionContext): void {
  const entry = entries.get(key);
  if (!entry) {
    return;
  }

  entry.emoji = emoji;
  if (ctx?.mode === "tui") {
    ctx.ui.setStatus(key, undefined);
  }
}
