---
name: google-workspace
description: "Access Google Workspace APIs (Drive, Docs, Calendar, Gmail, Sheets, Slides, Chat, People) via local helper scripts without MCP. Handles OAuth login and direct API calls."
---

# Google Workspace (No MCP)

Use this skill when the user wants Google Workspace access in pi **without MCP**.

This skill provides local Node.js helper scripts for:

- OAuth login + token management
- Direct Google API calls (generic and convenience commands)

## Files

- `scripts/auth.js` — login/status/clear token
- `scripts/workspace.js` — call APIs
- `scripts/common.js` — shared auth logic

## One-time setup

1. Dependencies auto-install on first script run (`auth.js` or `workspace.js`).

Optional (to prewarm manually):

```bash
cd /Users/mitsuhiko/Development/agent-stuff/skills/google-workspace
npm install
```

2. Auth mode defaults to **cloud** (same hosted OAuth approach used by the workspace extension), so no local `credentials.json` is required.

Optional local OAuth mode:

- Set `GOOGLE_WORKSPACE_AUTH_MODE=local`
- Create a Google OAuth Desktop app and place credentials at:

```bash
~/.pi/google-workspace/credentials.json
```

Environment overrides:

- `GOOGLE_WORKSPACE_CONFIG_DIR`
- `GOOGLE_WORKSPACE_CREDENTIALS`
- `GOOGLE_WORKSPACE_TOKEN`
- `GOOGLE_WORKSPACE_AUTH_MODE` (`cloud` or `local`)
- `GOOGLE_WORKSPACE_CLIENT_ID` (cloud mode)
- `GOOGLE_WORKSPACE_CLOUD_FUNCTION_URL` (cloud mode)

## Authenticate

```bash
cd /Users/mitsuhiko/Development/agent-stuff/skills/google-workspace
node scripts/auth.js login
```

This opens the browser for OAuth consent automatically.
If you run an API call without a token, `workspace.js` will also trigger the same browser auth flow.

Check auth status:

```bash
node scripts/auth.js status
```

Clear token:

```bash
node scripts/auth.js clear
```

## API usage

### Generic API call

```bash
node scripts/workspace.js call <service> <method.path> '<json params>'
```

Examples:

```bash
node scripts/workspace.js call drive files.list '{"pageSize":5,"fields":"files(id,name)"}'
node scripts/workspace.js call calendar events.list '{"calendarId":"primary","maxResults":10,"singleEvents":true,"orderBy":"startTime"}'
node scripts/workspace.js call docs documents.get '{"documentId":"<DOC_ID>"}'
```

### Convenience commands

```bash
node scripts/workspace.js calendar-today
node scripts/workspace.js drive-search "name contains 'Roadmap' and trashed=false"
node scripts/workspace.js gmail-search "from:alice@example.com newer_than:7d"
```

## Operational guidance for the agent

1. Always run `node scripts/auth.js status` first.
2. If auth is missing/expired, run `node scripts/auth.js login` immediately and wait for user to complete browser consent.
3. Do **not** just explain setup unless a command actually failed and its error output requires user action.
4. Use `workspace.js call` for precise operations and return raw JSON results.
5. For user-friendly output, post-process JSON after the call.
6. Never print token contents back to the user.
