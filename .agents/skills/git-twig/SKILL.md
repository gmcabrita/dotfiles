---
name: git-twig
description: Create and manage ordinary linked Git worktrees with git twig, using native copy-on-write to reduce disk use. Use when a task needs an isolated checkout or branch.
---

# git twig

Use `git twig new` in place of `git worktree add`. The resulting checkout is a
normal linked worktree: use ordinary Git commands inside it.

Twig is a filesystem optimization, not an agent session or worktree manager. You
remain responsible for selecting the repository, base revision, branch, location,
setup steps, tests, commits and approved cleanup. These instructions apply to any
agent that can execute Git commands; they do not install or intercept client hooks.

## Before creating a workspace

1. Follow the repository's AGENTS.md and the person's worktree conventions. Inspect
   existing registrations with `git twig list --porcelain`; scripts should use `-z`
   and parse NUL records, not whitespace or newline-delimited paths.
2. Check `git twig --version` and `git twig new -h`. The installed binary may lag
   behind these instructions. The canonical command is `new`; older v0.1 binaries
   do not support it. Ask before upgrading an installation; do not silently
   substitute another executable, reset a destination, or keep retrying bad flags.
3. Choose the exact base intentionally. `HEAD` means the selected source checkout's
   current commit, not necessarily the remote default branch. Inspect its branch,
   status and revision; do not carry dirty work over, fetch/rebase, or reset the
   source unless the task and repository policy call for it.
4. Reuse an existing task worktree only after confirming its identity and ownership.
   Otherwise select a new branch and unused destination. A directory name or branch
   prefix alone does not prove that another agent's worktree is disposable.

## CLI reference

```text
git twig new [<git-worktree options>] <path> [<commit>]
git twig adopt [--dry-run] [--yes] [--compact [--offline] | --move-only] [--worktrees-dir=<root>] [<worktree>]
git twig adopt [--prepare | --dedupe] <linked-worktree>
git twig list [--porcelain [-z]]
git twig remove <path>
git twig move <path> <new-path>
git twig lock [--reason <text>] <path>
git twig unlock <path>
git twig prune [--dry-run] [--verbose] [--expire <time>]
git twig repair [<path>...]

git twig skill
git twig -h
git twig --version
```

- `new`: create an ordinary linked worktree. Supported requests use native CoW;
  other requests use Git's normal checkout.
- `adopt`: in releases after v0.5.0, discover registered worktrees, preview a
  sibling layout and ask before relocating. v0.5.0 has only the earlier
  sharing-only command; check help for `--worktrees-dir`. Explicit `--prepare`/`--dedupe` keep
  their sharing-only behavior. This is not an agent session manager.
- `list`: show worktrees in human-readable form. `--porcelain` is Git's stable
  machine-readable format; `-z` uses NUL separators for safe path parsing.
- `remove`: remove a worktree and its registration. Check for changes and ask
  before removing it; do not force removal.
- `move`: move a worktree and update its registration. Ask before moving it.
- `lock`: protect a worktree's registration from pruning, moving or removal,
  for example while an external drive is disconnected. It does not lock files
  or prevent concurrent agent edits.
- `unlock`: remove that protection. Ask before changing a user's lock.
- `prune`: remove stale registrations for worktrees whose directories no longer
  exist, not the working directories themselves. Preview with `--dry-run` and
  ask before pruning.
- `repair`: repair links between the repository and worktrees after directories
  were moved manually. It does not repair file contents or merge conflicts.
  Ask before changing registrations.
- `skill`: print these bundled agent instructions, even outside a repository.
- `-h` and `--version`: print usage or the installed version. Short command help
  such as `git twig new --help` also works outside a repository. Git itself turns
  top-level `git twig --help` into a manual lookup; Homebrew installs that manual,
  while Cargo, Scoop and Windows users can use `git twig -h` or `git-twig --help`.

Standard Git worktree options are passed through. Use `git worktree <command> -h`
for the full options of a delegated command (`new` uses Git's `add` options).
Do not invent additional Twig commands or flags. Check subcommand help before
using newer features: releases before v0.5 have no `adopt`, and no `setup` command
or lifecycle-hook manager is shipped.

## Create a workspace

From the directory containing a source checkout named `main/`:

```sh
git -C main twig new -b feat/x ../feat-x HEAD
cd feat-x
```

`-C main` selects the source checkout; `../feat-x` is resolved relative to it.
Since v0.5.0, Twig can select a nearby donor for another revision and share
verified matching files;
Git writes changed, new or converted paths.

For a detached checkout:

```sh
git twig new --detach ../experiment HEAD
```

Use an explicit `-b` or `--detach` to enable the CoW path; `-B`, `--force`,
`--no-checkout`, `--lock` and other Git options use stock Git. If the requested
revision moves while Twig verifies files, `--detach` keeps the verified commit and
`-b` uses stock Git, so check the resulting `HEAD`. Choose a new destination;
never overwrite an existing directory. Run tests and make commits in the new
worktree as usual. `git twig list` lists worktrees. Add `--porcelain` only when
parsing the output in a script.

Keep using the resulting absolute worktree path for subsequent tools; changing one
shell's directory may not change an agent's session directory or another tool's
working directory. Confirm the checkout and branch before edits, tests or commits.
For a CLI agent, open or launch it in that checkout using its documented mechanism.
Do not assume that creating a worktree moved an existing editor/session there.

## Work with agent-managed worktrees

- Prefer explicit Twig creation when you control creation. A client's built-in
  isolation/worktree feature may call stock Git independently; merely installing
  this skill does not intercept it or guarantee CoW for app-managed worktrees.
- Existing Git worktrees need no conversion to be usable. To move nested
  worktrees into a sibling layout, preview `adopt` and coordinate with their
  owning agents before asking for approval. Never move an active app-managed
  checkout silently. Moving does not compact an APFS checkout.
- When the person asks to route a client's worktree creation through Twig (for
  example a Claude Code `WorktreeCreate` hook), the hook must print only the
  worktree path on stdout: send `git twig new` output to stderr, derive a branch
  for `-b`, and use the path the client expects. Ask before writing settings.
- Respect the client's paths, session records, branches and cleanup lifecycle.
  Do not install lifecycle hooks, rewrite agent settings, take ownership of its
  worktree inventory, or disable its safety checks as part of ordinary Twig use.
- Configure dependencies or local files deliberately after creation. Do not assume
  `.worktreeinclude` or a client setup script ran for a manually Twig-created
  checkout. Never copy secrets or all ignored files, or share writable dependency
  directories, just to make startup look automatic. Ask when setup needs private
  configuration or changes outside the task checkout.
- Report the created/reused path, branch/base and setup still needed. Only claim
  native CoW when trace output confirms it; a successful Git fallback is valid but
  not evidence of sharing. Do not promise fixed speed or exclusive space savings.

## Adopt an existing worktree layout

First check `git twig adopt -h` for `--worktrees-dir`: v0.5.0 has only the
sharing-only modes, not this relocation flow.

```sh
git -C main twig adopt --dry-run --worktrees-dir=/path/to/repo
git -C main twig adopt --worktrees-dir=/path/to/repo
```

Default adoption discovers this repository's registered worktrees and proposes
`/path/to/repo/{main,feat-x,...}`. The original clone uses `main/` regardless of
its checked-out branch; branch slashes become hyphens. Omit `--worktrees-dir` to
choose a root interactively, or reuse the saved per-repository root. Add a target
worktree path to move only that checkout. Do not silently adopt unrelated agents'
worktrees: inspect and explain the complete plan, coordinate active sessions,
and get approval. The CLI confirms by default; use `--yes` only after explicit
approval of the displayed plan, with an explicit or saved root.

Adoption preserves current staged, dirty, untracked and ignored work rather than
reconstructing HEAD. It refuses occupied destinations, directory-name collisions,
locked/prunable registrations, active Git lockfiles, cross-device moves and
submodule relocation. Git repairs registrations after relocation. Sessions,
editors, external absolute paths and client-owned records are not updated; explain
what the owner must restart or reconfigure. Report the retained recovery journal
on failure and never remove parked files automatically.

After adoption, `git twig new -b feat/x` uses the saved root without an explicit
destination. Explicit creation destinations keep their existing Git semantics.
Use the new absolute paths for every subsequent tool call.

Layout and sharing are separate. On Linux, and Windows on ReFS or a Dev Drive,
confirmed layout adoption attempts kernel in-place sharing of identical same-path tracked regular files against the
main checkout. Unsupported/changed ranges are reported separately from a
successful move; earlier deduplicated ranges are not rolled back. Neither logical
matching bytes nor kernel byte counts prove exclusive physical space reclaimed.
On macOS, moving alone leaves sharing unchanged, but interactive adoption offers
an explicit offline compaction step. First preview `adopt --compact --dry-run`.
Before approving compaction, have the owner save work and CLOSE every agent,
editor, build and server using donor/target worktrees. A paused process can still
hold descriptors or writable mappings. Do not infer exclusive ownership from
lsof/process scans or simply pass an offline flag on the owner's behalf.

For explicitly approved automation, use `--compact --offline --yes` with the
reviewed explicit/saved root. `--yes` alone never authorizes APFS replacement;
`--move-only` opts out of sharing on either platform. Compaction uses verified
native CoW clones of matching tracked current bytes, preserving supported target
metadata and index entries, not restoring HEAD. It changes inodes/ctime and may
cause the next status to refresh its stat cache. Verified old copies are retired
to release their references; indefinite backups would keep old extents pinned.

An open original prevents retirement. A failure after swapping stops and retains
installed/recovery copies: report the journal path and do not restart agents,
retry, delete originals or blindly roll back over possible writes. Unsupported
metadata/files remain untouched. Snapshots are never deleted and physical space
reclaimed is not inferred from matching logical bytes. This remains an explicitly
offline operation, not live APFS deduplication. Ordinary Git worktrees do not need
a format conversion.

The explicit v0.5 sharing-only modes remain available from a distinct donor:
`git -C main twig adopt --prepare ../existing` retains private verified clones,
and Linux or Windows ReFS `--dedupe` compares/shares ranges in place without
replacing files. Windows skips files open for writing or mapped.
These --prepare clones can consume extra space and are never installed. Never
substitute clone-and-rename on an active APFS checkout: open writers can retain
the old inode. These modes do not relocate worktrees or need agent hooks.

## Know what is copied

- Only committed tracked files are included. Local edits and untracked/ignored
  files are excluded; tracked secrets are copied like any other tracked file.
  Install dependencies when needed.
- Native CoW needs macOS/APFS, Linux on Btrfs or reflink-enabled XFS, or Windows
  on ReFS or a Dev Drive (NTFS uses stock Git). Source,
  destination and Git metadata must share a clone-capable filesystem; this applies
  to the selected donor, not necessarily the invoking checkout. Unsupported requests use stock Git.
- CoW shares file data, not writes. It is not a sandbox and is not always faster.
- To inspect backend selection, set `TWIG_TRACE=1` on the create command. Native
  sharing ends with `APFS CoW: verified tracked files`, `Linux reflink CoW: ...`
  or `Windows block clone CoW: ...`; a `stock Git:` line gives the fallback reason.
- Since v0.4.0, supported LF policies can use native CoW.
  Private candidates are compared to raw target blobs; Git writes exceptional
  files while other files retain sharing. Trace output includes per-path counts.
  Upgrade older releases to v0.4.0 or newer for the released LF-policy and filter-state fix.
- Since v0.5.0, Twig materializes builtin ident/encoding conversions per file.
  Git creates empty submodule directories without copying or initializing donor
  submodules. After v0.5.0, converted files (`core.autocrlf=true`, the Git for
  Windows default, `eol=crlf`, `ident`, `working-tree-encoding`) are shared when
  they equal Git's checkout bytes, and `core.symlinks=false` no longer delegates.
- External filters on regular files (including Git LFS) and sparse checkout
  delegate. Conditional config includes that set only identity, signing, remote,
  credential or alias settings stay native; other conditional includes, nested
  includes, relative includes and relative attribute-file configuration delegate.
  Blobless partial clones delegate when Git must fetch missing blobs.
  Do not change repository attributes or configuration just to force the native path.

## Cleanup safely

Ask before removing a worktree or discarding changes. Inspect status (including
untracked and relevant ignored output), staged changes, new/unpushed commits,
locks and active sessions first. A clean `git status` alone does not prove the
worktree is disposable. Do not remove an app-managed checkout behind its owner's
back or mistake a registration lock for exclusive file access.
Never force removal, prune registrations, delete branches or delete retained
staging blindly. After approval, use `git twig remove <path>`. It keeps Git's refusals for
changes and locks, and completes deletion when paths exceed the system limit.
Retain branches
and commits unless their deletion was separately authorized.

Staging lives under the common Git directory in `twigs/staging`. A successful
create removes only its own staging, as does SIGINT, SIGTERM or SIGHUP before
registration. Other failed or interrupted attempts retain diagnostic state;
inspect `git twig list` and the reported staging paths, since a partial
worktree may already be registered. Do not retry into it or delete it automatically.
Older releases created `.git-twig-stage-*` folders beside checkouts; new commands
neither create nor sweep them. Adoption keeps a `.twig/` folder beside the main
clone only after a failure that needs manual recovery; report it, do not delete it.
