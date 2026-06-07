import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  registerFooterEmoji,
  setFooterEmoji,
  setFooterEmojiActive,
} from "./lib/footer-inline-emojis";

const FOOTER_KEY = "eyebags";
const EYEBAGS = "🫩";
const START_MINUTE = 23 * 60 + 30;
const END_MINUTE = 7 * 60;
const DAY_MINUTES = 24 * 60;
const EXTRA_INTERVAL_MINUTES = 30;

let timer: ReturnType<typeof setTimeout> | undefined;
let lastCtx: ExtensionContext | undefined;

function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function isEyebagsTime(date: Date): boolean {
  const minute = minuteOfDay(date);
  return minute >= START_MINUTE || minute < END_MINUTE;
}

function eyebagsStart(date: Date): Date {
  const minute = minuteOfDay(date);

  if (minute >= START_MINUTE) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 30, 0, 0);
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 23, 30, 0, 0);
}

function minutesSinceStart(date: Date): number {
  const minute = minuteOfDay(date);
  if (minute >= START_MINUTE) {
    return minute - START_MINUTE;
  }

  return DAY_MINUTES - START_MINUTE + minute;
}

function eyebagsCount(date: Date): number {
  if (!isEyebagsTime(date)) {
    return 0;
  }

  return Math.floor(minutesSinceStart(date) / EXTRA_INTERVAL_MINUTES) + 1;
}

function nextUpdate(date: Date): Date {
  const minute = minuteOfDay(date);

  if (minute < END_MINUTE) {
    const start = eyebagsStart(date);
    const elapsed = minutesSinceStart(date);
    const nextElapsed = (Math.floor(elapsed / EXTRA_INTERVAL_MINUTES) + 1) * EXTRA_INTERVAL_MINUTES;
    const next = new Date(start.getTime() + nextElapsed * 60_000);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0, 0);
    return next < end ? next : end;
  }

  if (minute < START_MINUTE) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 30, 0, 0);
  }

  const start = eyebagsStart(date);
  const elapsed = minutesSinceStart(date);
  const nextElapsed = (Math.floor(elapsed / EXTRA_INTERVAL_MINUTES) + 1) * EXTRA_INTERVAL_MINUTES;
  return new Date(start.getTime() + nextElapsed * 60_000);
}

function clearTimer(): void {
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  timer = undefined;
}

function scheduleNextUpdate(ctx: ExtensionContext | undefined): void {
  clearTimer();
  lastCtx = ctx;

  const now = new Date();
  const delayMs = Math.max(1_000, nextUpdate(now).getTime() - now.getTime());
  timer = setTimeout(() => {
    update(lastCtx);
  }, delayMs);
  timer.unref?.();
}

function update(ctx: ExtensionContext | undefined): void {
  const count = eyebagsCount(new Date());
  setFooterEmoji(FOOTER_KEY, EYEBAGS.repeat(count), ctx);
  setFooterEmojiActive(FOOTER_KEY, count > 0, ctx);
  scheduleNextUpdate(ctx);
}

export default function eyebagsExtension(pi: ExtensionAPI) {
  const unregisterFooterEmoji = registerFooterEmoji(FOOTER_KEY, EYEBAGS, 10);

  const cleanup = () => {
    clearTimer();
    setFooterEmojiActive(FOOTER_KEY, false, lastCtx);
    unregisterFooterEmoji();
    lastCtx = undefined;
  };
  process.once("exit", cleanup);

  pi.on("session_start", (_event, ctx) => {
    update(ctx);
  });

  pi.on("session_shutdown", () => {
    cleanup();
    process.off("exit", cleanup);
  });
}
