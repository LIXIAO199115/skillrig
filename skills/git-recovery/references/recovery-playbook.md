# Git recovery playbook

## Incident sheet

Copy this into the task before touching anything:

```markdown
Repository:
Backup path:
Current branch:
Current HEAD:
Last known good commit:
What happened:
Commands already run:
Working tree state (clean/dirty):
Remote affected: yes/no
People affected:
```

## Read-only diagnostics

```bash
git status
git rev-parse HEAD
git branch -vv
git reflog -40
git reflog --all --date=iso | head -80
git stash list
git log --all --oneline --decorate -30
git fsck --full --unreachable --no-reflogs
```

`git fsck` can take minutes on a large repository. It is read-only.

## Commit lookup

```bash
# show a candidate without changing anything
git show --stat <sha>
git show <sha>:path/to/file

# find commits touching a file, including unreachable ones is not possible
git log --all --oneline -- path/to/file

# find a commit by message fragment
git log --all --grep="retry policy" --oneline
```

Unreachable commits do not appear in `git log --all`. Use `git fsck` and inspect each hash.

## Restore a file from a commit

```bash
git restore --source=<sha> -- path/to/file
```

This modifies the working tree only. It does not change history.

## Recover a branch from a remote-tracking ref

```bash
git branch --all --verbose
git branch rescue/remote origin/<branch>
```

If `origin/<branch>` still exists in `refs/remotes`, it may point at the old commit even after the remote branch was rewritten. Fetch before relying on it, because a fetch updates the remote-tracking ref.

## Reflog expiration

Reflog entries expire. The defaults are typically 90 days for reachable entries and 30 days for unreachable ones, but configuration and hosting can differ.

```bash
git config --get gc.reflogExpire
git config --get gc.reflogExpireUnreachable
```

Once garbage collection runs and the grace period passes, unreachable objects are deleted. Recovery then depends on backups, other clones, CI artifacts, or the hosting provider.

## Provider notes

**GitHub**

- A force-push updates the branch ref. Old commits may remain reachable through pull requests, forks, and the API until GitHub garbage-collects them.
- If a PR contained the old head, the PR's commits may still be fetchable by SHA: `git fetch origin <sha>`.
- GitHub Support can sometimes recover a deleted repository within a limited window. Do not rely on it for branches.

**GitLab**

- Protected branches can prevent force-push.
- Project audit events and merge request diffs may retain old SHAs.

**Bitbucket**

- Branch permissions and audit logs vary by plan.

For all providers: act before retention windows close, and export a bundle:

```bash
git bundle create rescue.bundle --all
```

A bundle is a single-file backup that can be cloned later.

## Recovery branch naming

Use a predictable prefix so nobody mistakes a rescue branch for active work:

```text
rescue/<date>-<reason>
```

Example: `rescue/20261021-hard-reset`.

## Verify a recovered branch

```bash
git switch rescue/<name>
git log --oneline -10
git diff --stat <expected-base>..HEAD
npm test
```

Only after tests pass should you merge, cherry-pick, or reset the original branch.

## Destructive commands and their safe alternatives

| Instead of | Use | Why |
| --- | --- | --- |
<!-- skillrig-ignore-block: dangerous-git -- comparison table: left column is the risky command being replaced -->
| `git reset --hard` | `git stash push -u` or a rescue branch | Keeps the work reachable |
| `git push --force` | `git push --force-with-lease` | Refuses to overwrite unseen work |
| `git clean -fdx` | `git clean -ndx` first | Preview deletions |
| `git push --force` | `git push --force-with-lease` | Refuses to overwrite unseen work |
| `git checkout -- .` | `git restore -p` | Interactive, reviewable |
| `git reflog expire --expire=now --all` | Do not run it | Destroys recovery data |
| `git gc --prune=now` | Do not run it during recovery | Deletes unreachable objects immediately |

## When to stop

- The repository is corrupt and `git fsck` reports errors. Copy it and use `git fsck --full` output before any repair.
- The work was never committed and no editor history exists. Recovery may be impossible; document that honestly.
- The remote is a shared production branch. Coordinate before any force-push.
- Credentials or secrets were committed. Rotate them first, then clean history with a dedicated tool and coordinate the rewrite.
