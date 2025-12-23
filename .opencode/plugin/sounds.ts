export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`afplaybg /System/Library/Sounds/Submarine.aiff`.quiet().nothrow();
      } else if (event.type === "permission.updated") {
        await $`afplaybg /System/Library/Sounds/Ping.aiff`.quiet().nothrow();
      } else {
        return;
      }
    },
  };
};
