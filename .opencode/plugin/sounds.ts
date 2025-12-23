export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      // Send notification on session completion
      if (event.type === "session.idle") {
        await $`afplay /System/Library/Sounds/Submarine.aiff`;
      } else if (event.type === "permission.ask") {
        await $`afplay /System/Library/Sounds/Ping.aiff`;
      }
    },
  };
};
