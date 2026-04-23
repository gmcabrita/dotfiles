import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

function isReviewPrompt(prompt: string): boolean {
  return prompt.includes("Please perform a code review");
}

export default function reviewThinkingExtension(pi: ExtensionAPI) {
  let previousThinkingLevel: ThinkingLevel | undefined;

  pi.on("before_agent_start", (event, _ctx) => {
    if (!isReviewPrompt(event.prompt)) return;

    previousThinkingLevel = pi.getThinkingLevel();
    pi.setThinkingLevel("xhigh");
  });
}
