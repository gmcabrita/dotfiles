---
description: Add AI session summary to GitHub PR description
---

Use the session-export skill to update the PR description with an AI session export summary.

Target: $ARGUMENTS

Instructions:

1. Parse target - can be PR number, URL, or branch name
2. Run `opencode export` to get session data (models array)
3. Generate summary JSON from conversation context
4. Fetch existing PR description and append session export block
5. Update PR with new description

If no target provided, use current branch's PR.
