---
name: terminal-debugger
description: Use when a shell command fails or behaves differently across machines: command not found, permission denied, quoting and argument errors, path and encoding problems, pipe failures, environment differences, CRLF scripts, or Windows Git Bash versus Linux behavior. Provides a systematic diagnosis instead of retry loops.
license: MIT
compatibility: POSIX shells including bash and zsh, plus Git Bash on Windows. Some tools (strace, lsof) are platform-specific and are marked.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [shell, terminal, debugging, windows, bash]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Terminal Debugger

Shell failures are usually one of six things: the command is not the one you think, the argument is not the string you think, the path is not the file you think, the user lacks permission, the environment differs, or the failure is earlier in the pipeline than it appears.

Diagnose in that order. Do not rerun the same command and hope.

## When to use

Use this skill when:

- `command not found` appears for a tool that is installed.
- A command works in one terminal and fails in another or in CI.
- Arguments with spaces, quotes, `*`, `$`, or non-ASCII characters misbehave.
- A script fails with `bad interpreter`, `syntax error near unexpected token`, or `\r`.
- A pipeline exits 0 while producing wrong output.
- Permissions, ownership, or file mode cause failures.
- Windows Git Bash, WSL, PowerShell, and Linux disagree.

## Workflow

### 1. Capture the exact failure

```bash
set -x
<command>
set +x
```

Record:

- The exact command as typed.
- The full error, including the first line.
- Exit code: `echo $?`.
- Shell: `echo "$SHELL"`, `bash --version`.
- Working directory: `pwd`.
- User: `id` or `whoami`.

Do not summarize the error. The first line names the failure.

### 2. Confirm which command runs

```bash
type -a <command>
command -v <command>
which -a <command>
```

`type -a` shows aliases, functions, builtins, and all PATH matches. A stale alias or a shim earlier in `PATH` is a common cause.

```bash
alias
echo "$PATH" | tr ':' '\n'
```

On Windows, also check:

```bash
where <command>
```

A Windows `where` may find a `.cmd` shim that Git Bash cannot execute the way you expect.

### 3. Check the arguments byte by byte

```bash
printf '<%s>\n' "$@"
printf '%q\n' "$@"
```

Quoting rules:

- `"$var"` preserves spaces and empty values.
- `$var` splits on whitespace and globs.
- `'single'` prevents expansion.
- Backslashes behave differently inside double quotes.
- A filename beginning with `-` needs `--` before it.

```bash
rm -- "-weird-name"
```

Windows paths in Git Bash:

- `C:\dir\file` is interpreted as escapes. Use `C:/dir/file` or quote it.
- MSYS rewrites some arguments that look like paths. `MSYS_NO_PATHCONV=1` disables that for one command.
- A Windows program receives Windows paths; a POSIX program receives POSIX paths.

### 4. Check the path and permissions

```bash
ls -la -- "<path>"
stat -- "<path>"        # GNU; macOS: stat -f '%Sp %Su %Sg %N'
realpath -- "<path>"    # macOS: realpath or python3 -c
```

Common causes:

- Case mismatch on a case-sensitive filesystem.
- Symlink pointing at a missing target.
- File exists but the directory lacks execute permission.
- The script lacks the execute bit: `chmod +x script.sh`.
- The mount is read-only.
- The file is owned by another user.

### 5. Check the interpreter and line endings

```bash
head -1 script.sh | od -c | head -3
file script.sh
```

`bad interpreter: /usr/bin/env bash^M` means CRLF line endings. Fix:

```bash
sed -i 's/\r$//' script.sh
```

Or configure Git:

```bash
git config --global core.autocrlf input
```

Use `#!/usr/bin/env bash` rather than a hard-coded interpreter path when the script must run on multiple systems.

### 6. Check the environment

```bash
env | cut -d= -f1 | sort
```

Compare the failing environment with a working one. Common differences:

- `PATH` and tool versions.
- `HOME`, `TMPDIR`, `XDG_*`.
- `LANG` and `LC_*`, which affect sorting and encoding.
- Proxy variables.
- Shell startup files: `.bashrc`, `.bash_profile`, `.zshrc`, PowerShell `$PROFILE`.
- CI secrets that are present in one environment only.

Print names only. Do not dump values that may be secrets.

### 7. Check pipeline semantics

```bash
set -o pipefail
```

Without `pipefail`, the exit status is the last command's status. `grep` finding nothing can make a pipeline look successful while an earlier command failed.

```bash
<producer> | <consumer>
echo "${PIPESTATUS[@]}"    # bash
```

Check whether the consumer exits early and the producer receives SIGPIPE. That can look like a random failure on large inputs.

### 8. Isolate

- Run the command outside the script.
- Run the script with `bash -x script.sh`.
- Run with a minimal environment: `env -i PATH="$PATH" HOME="$HOME" bash script.sh`.
- Run as a different user or in a container.
- Replace the network call with a local file.
- Replace the variable with a literal.

Bisect the script by commenting out halves until the failure moves.

## Examples

Error:

```text
./deploy.sh: /usr/bin/env: bad interpreter: No such file or directory
```

Diagnosis:

```bash
head -1 deploy.sh | od -c | head -2
# 0000000   #   !   /   u   s   r   /   b   i   n   /   e   n   v       b   a   s   h  \r  \n
```

Fix:

```bash
sed -i 's/\r$//' deploy.sh
```

Error:

```text
find: 'C:\Users\me': No such file or directory
```

Diagnosis: backslashes were consumed by the shell. Fix:

```bash
find "C:/Users/me" -maxdepth 1
```

Error:

```text
Permission denied
```

Diagnosis:

```bash
ls -ld . script.sh
id
mount | grep "$(df --output=target . | tail -1)"
```

The directory may lack execute permission, the mount may be `noexec`, or the file may be owned by root.

## Guardrails

- Do not run a failing destructive command repeatedly to "see if it works".
- Do not add `sudo` to bypass a permission error before understanding it.
- Do not disable `set -e` or error checks to silence a failure.
- Do not paste environment dumps that may contain tokens.
- Do not rewrite a script with `sed -i` on a file you have not backed up.
- Do not assume Linux behavior in Git Bash. Check the platform explicitly.
- Do not use `eval` to "fix" quoting. Fix the quoting.

## Verification checklist

- [ ] Exact command, error, exit code, shell, and directory recorded.
- [ ] Resolved command path checked with `type -a`.
- [ ] Arguments inspected with `printf '%q'`.
- [ ] Path, permissions, and mount options checked.
- [ ] Interpreter and line endings checked.
- [ ] Environment differences compared by name.
- [ ] `pipefail` and `PIPESTATUS` checked for pipelines.
- [ ] Failure reproduced in isolation.
- [ ] Fix verified on the original command, not only a simplified one.
- [ ] Prevention added: script check, CI step, or documented requirement.

## References

- `references/shell-failures.md` contains a symptom-to-cause table and platform notes.
