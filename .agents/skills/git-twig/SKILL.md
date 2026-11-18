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
git twig adopt [--dry-run | --prepare | --dedupe] <linked-worktree>
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
- `adopt` (experimental since v0.5.0): inspect
  existing linked worktrees for matching current bytes. See the adoption section;
  it is not automatic cleanup or a session manager.
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
  while Cargo users can use `git twig -h` or `git-twig --help`.

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

Use an explicit `-b` or `--detach` to enable the CoW path. Choose a new destination;
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
- Existing Git worktrees need no conversion to be usable. Inspect and work in them
  normally. Do not replace their files or move them to try to gain sharing, and do
  not promise that Twig can compact an active existing APFS checkout.
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

## Inspect or adopt an existing worktree

First check `git twig adopt -h`; older installed releases do not have this command.
Run from a distinct donor checkout of the same repository:

```sh
git -C main twig adopt --dry-run ../existing
```

Inspection does not replace files or refresh the index. It compares same-path
regular files tracked in both checkouts by their current raw bytes, not HEAD or clean status.
Dirty and staged work must survive unchanged. Missing, different, empty,
symlinked, multiply-linked and cross-device candidates are skipped. Report these
limits rather than promising all worktree bytes can be shared.

On supported Linux filesystems, explicit `--dedupe` uses kernel in-place
comparison/sharing without replacing inodes. Start with the dry-run and explain
that a changed or unsupported range can stop the operation after earlier ranges
were shared; no contents are rolled back. Do not infer exclusive space reclaimed
from reported logical/kernel byte counts. Do not loop over every agent's
worktrees or assume permission to perform unrelated maintenance.

On macOS, `--prepare` only retains private verified clones for inspection and can
consume extra space. It does NOT compact the original; `--dedupe` is unavailable.
Never substitute clone-and-rename on an active APFS checkout: editors and writable
mappings can keep writing the old inode. Leave existing agent ownership, paths,
branches, index, permissions and registration intact. No agent hook is required.

## Know what is copied

- Only committed tracked files are included. Local edits and untracked/ignored
  files are excluded; tracked secrets are copied like any other tracked file.
  Install dependencies when needed.
- Native CoW needs macOS/APFS or Linux on Btrfs or reflink-enabled XFS. Source,
  destination and Git metadata must share a clone-capable filesystem; this applies
  to the selected donor, not necessarily the invoking checkout. Unsupported requests use stock Git.
- CoW shares file data, not writes. It is not a sandbox and is not always faster.
- To inspect backend selection, set `TWIG_TRACE=1` on the create command.
- Since v0.4.0, supported LF policies can use native CoW.
  Private candidates are compared to raw target blobs; Git writes exceptional
  files while other files retain sharing. Trace output includes per-path counts.
  Upgrade older releases to v0.4.0 or newer for the released LF-policy and filter-state fix.
- Since v0.5.0, Twig materializes builtin ident/encoding conversions per file.
  Git creates empty submodule directories without copying or initializing donor
  submodules. External filters on regular files and sparse checkout still delegate.
  Conditional config includes and relative attribute-file configuration also
  delegate. Relative includes in copied worktree configuration also delegate.
  Do not change repository attributes just to
  force the native path.

## Cleanup safely

Ask before removing a worktree or discarding changes. Inspect status (including
untracked and relevant ignored output), staged changes, new/unpushed commits,
locks and active sessions first. A clean `git status` alone does not prove the
worktree is disposable. Do not remove an app-managed checkout behind its owner's
back or mistake a registration lock for exclusive file access.
Never force removal, prune registrations, delete branches or delete retained
staging blindly. After approval, use `git twig remove <path>`; retain branches
and commits unless their deletion was separately authorized.

Staging lives under the common Git directory in `twigs/staging`. A successful
create removes only its own staging. Failed/interrupted attempts retain diagnostic
state; inspect `git twig list` and the reported staging paths, since a partial
worktree may already be registered. Do not retry into it or delete it automatically.
Older sibling staging folders are not swept or deleted by new commands.
