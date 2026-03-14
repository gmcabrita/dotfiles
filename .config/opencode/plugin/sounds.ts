import type { PluginInput, Plugin } from "@opencode-ai/plugin";

const isMainSession = async (client: PluginInput["client"], sessionID: string) => {
  try {
    const result = await client.session.get({ path: { id: sessionID } });
    return !result.data?.parentID;
  } catch {
    return true;
  }
};

export const NotificationPlugin: Plugin = async ({ client, $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        if (await isMainSession(client, sessionID)) {
          await $`afplaybg /System/Library/Sounds/Submarine.aiff`.quiet().nothrow();
        }
      } else if (event.type === "permission.updated") {
        await $`afplaybg /System/Library/Sounds/Ping.aiff`.quiet().nothrow();
      } else {
        return;
      }
    },
  };
};
