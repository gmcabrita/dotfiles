// Check if a session is a main (non-subagent) session
const isMainSession = async (sessionID) => {
  try {
    const result = await client.session.get({ path: { id: sessionID } });
    const session = result.data ?? result;
    return !session.parentID;
  } catch {
    // If we can't fetch the session, assume it's main to avoid missing notifications
    return true;
  }
};

export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        if (await isMainSession(sessionID)) {
          await $`afplaybg /System/Library/Sounds/Submarine.aiff`.quiet().nothrow();
        }
      } else if (event.type === "permission.updated") {
        // or permission.requested
        await $`afplaybg /System/Library/Sounds/Ping.aiff`.quiet().nothrow();
      } else {
        return;
      }
    },
  };
};
