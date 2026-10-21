---
name: git-recovery
description: Use when Git work appears lost: commits after a hard reset, a deleted branch, a bad rebase or merge, a dropped stash, detached HEAD commits, a force-pushed remote, or overwritten files. Provides reflog and fsck recovery steps with backups and safety gates. Does not rewrite shared history without coordination.
license: MIT
compatibility: Git 2.30 or newer. Commands are POSIX-shell examples; on Windows use Git Bash. Some server-side recovery depends on the hosting provider.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [git, recovery, reflog, data-loss]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Git Recovery

Git rarely loses committed work immediately. It loses the references that make the work easy to find. Reflog entries and dangling objects usually survive until garbage collection.

The first rule is to stop making changes. Every new command can move a reference or trigger cleanup.

## When to use

Use this skill when:

<!-- skillrig-ignore-block: dangerous-git -- failure-mode list; commands are described, not recommended -->
- `git reset --hard` removed commits you still need.
- A branch was deleted locally or on the remote.
- A rebase or merge went wrong.
- A stash was dropped or a conflict resolution was lost.
- You are in detached HEAD and made commits.
- A teammate force-pushed over your branch.
- Files were overwritten and never committed.

## Golden rules

1. **Stop.** Do not run `git gc`, `git prune`, `git reflog expire`, or another reset.
2. **Back up the repository**, including `.git`, before any recovery command.
3. **Record the current state**: `git status`, `git rev-parse HEAD`, `git reflog -20`.
4. **Recover into a new branch**, not onto the branch you are trying to repair.
5. **Do not force-push shared history** until the affected people agree.
6. **Prefer read-only commands** until you have a candidate commit hash.

```bash
cp -a /path/to/repo /path/to/repo-recovery-$(date +%Y%m%d-%H%M%S)
cd /path/to/repo
git status
git rev-parse HEAD
git reflog -20
```

On Windows, use File Explorer or `robocopy` to copy the folder while no Git command is running.

## Workflow 1: recover commits after a hard reset

```bash
git reflog
```

Look for the line before the reset. It looks like:

```text
9f2c1ab HEAD@{3}: commit: add retry policy
```

Create a safety branch at that commit:

```bash
git branch rescue/retry-policy 9f2c1ab
git switch rescue/retry-policy
git log --oneline -5
```

Then merge or cherry-pick what you need. Do not reset the original branch until the rescue branch is verified.

## Workflow 2: recover a deleted branch

```bash
git reflog --all --date=iso | head -50
git branch --contains <candidate-sha>
```

When you find the tip:

```bash
git branch rescue/deleted-branch <sha>
```

If the branch was deleted on the remote but still exists locally:

```bash
git push origin rescue/deleted-branch:refs/heads/restored-branch
```

If the branch was deleted on the remote and never existed locally, ask the hosting provider whether reflog or audit logs are available. GitHub, GitLab, and Bitbucket expose different retention and APIs.

## Workflow 3: recover from a bad rebase

During a rebase:

```bash
git rebase --abort
```

After a completed rebase:

```bash
git reflog
# find "rebase (finish)" and the entry before it
git branch rescue/pre-rebase <sha-before-rebase>
```

Verify the branch content before moving the original:

```bash
git diff <sha-before-rebase>..rescue/pre-rebase --stat
```

## Workflow 4: recover a merge

During a conflicted merge:

```bash
git merge --abort
```

After a merge commit you want to undo:

```bash
git reflog
git branch rescue/pre-merge <sha-before-merge>
```

To redo the merge cleanly, reset the branch to the pre-merge commit only after the rescue branch exists and you have confirmed the working tree is clean.

## Workflow 5: recover detached HEAD commits

```bash
git reflog
git branch rescue/detached <sha>
```

A commit made in detached HEAD is reachable through reflog until it expires. Create the branch before switching away or running cleanup.

## Workflow 6: recover a dropped stash

```bash
git stash list
git reflog show refs/stash
git fsck --unreachable --no-reflogs | grep commit
```

For each candidate:

```bash
git show <sha> --stat
git stash apply <sha>
```

`git stash apply` keeps the stash entry; `pop` removes it. Apply onto a clean tree.

## Workflow 7: recover unreachable commits

```bash
git fsck --full --unreachable --no-reflogs
```

This lists dangling commits, trees, and blobs. For a commit:

```bash
git show --stat <sha>
git branch rescue/fsck <sha>
```

`git fsck --lost-found` writes dangling objects into `.git/lost-found/` for inspection. It does not restore references by itself.

Blobs without a commit are harder. Use `git cat-file -p <blob>` and inspect the content. Editor local history or IDE backups are often faster for uncommitted files.

## Workflow 8: recover after a force-push

If you still have the old commits locally:

```bash
git reflog
git branch rescue/force-pushed <old-sha>
git push origin rescue/force-pushed
```

Then coordinate with the person who force-pushed. Restoring the branch may discard their new work; merge both histories instead of overwriting one side.

For your own future force-pushes, use:

<!-- skillrig-ignore-block: dangerous-git -- force-with-lease is the safe form recommended here -->
```bash
git push --force-with-lease
```

It refuses to overwrite a remote branch that moved since your last fetch.

## Workflow 9: recover overwritten files

Committed before overwrite:

```bash
git log --all --oneline -- path/to/file
git restore --source=<sha> -- path/to/file
```

Staged but not committed:

```bash
git fsck --unreachable --no-reflogs | grep blob
git cat-file -p <blob>
```

Never committed:

- VS Code: Timeline or Local History.
- JetBrains: Local History.
- Vim: swap and undo files.
- macOS: Time Machine.
- Windows: File History or a previous version.
- Your editor's backup directory.

After the editor and OS options are exhausted, look for build caches, test snapshots, and deployment artifacts.

## Prevention

- Commit before any rebase, reset, or checkout that can discard work.
- Create a `wip/` branch before risky experiments.
- Configure a longer reflog window:
  ```bash
  git config --global gc.reflogExpire 180.days
  git config --global gc.reflogExpireUnreachable 60.days
  ```
- Use `--force-with-lease`, never bare `--force`.
- Keep a remote backup branch for long-lived work.
- Do not run `git clean -fdx` without checking what it will delete. Preview with `git clean -ndx`.
- Stash with a message: `git stash push -m "why"`.

## Examples

Good first response to "I lost my commits":

```bash
git reflog -30
git branch rescue/lost-work <sha>
git show --stat rescue/lost-work
```

Bad first response:

<!-- skillrig-ignore-block: dangerous-git -- example of the wrong response, labelled Bad first response -->
```bash
git reset --hard HEAD~3
```

The second destroys more references before you know what exists.

## Guardrails

- Do not run garbage collection or prune during recovery.
- Do not reset a branch until the rescue branch is verified.
- Do not force-push a shared branch without explicit coordination.
- Do not assume a remote host keeps reflog forever. Export the recovery branch promptly.
- Do not paste repository contents or secrets into an external recovery service.
- Do not use `git checkout -- .` to "clean up" when files are missing. It overwrites the working tree.

## Verification checklist

- [ ] Repository copied, including `.git`.
- [ ] Current HEAD and reflog recorded.
- [ ] Recovery target identified by hash and inspected with `git show`.
- [ ] Rescue branch created and checked out.
- [ ] Diff against the expected state reviewed.
- [ ] Tests run on the recovered branch.
- [ ] Original branch only moved after the rescue branch is safe.
- [ ] Remote restoration coordinated with affected people.
- [ ] Prevention step applied.

## References

- `references/recovery-playbook.md` contains a command-first incident sheet and provider notes.
