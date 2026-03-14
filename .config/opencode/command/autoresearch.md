---
description: Start or resume an autoresearch loop in the current repo
---

Set up or resume autoresearch in the current repo.

First, invoke the skill tool to load the `autoresearch` skill:

```text
skill({ name: "autoresearch" })
```

If an autoresearch session already exists under `autoresearch/`, resume it instead of creating a new one unless the target changed.

For new sessions, use `scaffold_autoresearch` to create the canonical files under `autoresearch/` before `init_experiment`.

<user-request>
$ARGUMENTS
</user-request>
