# Shell failure reference

## Symptom table

| Symptom | First check | Common cause |
| --- | --- | --- |
| `command not found` | `type -a`, `command -v` | PATH, alias, shim, wrong shell |
| `Permission denied` | `ls -ld`, `id`, `mount` | Mode, owner, `noexec`, sandbox |
| `No such file or directory` for an existing file | `file`, `od -c` on the shebang | CRLF, missing interpreter |
| `syntax error near unexpected token` | `bash -n script.sh` | Shell mismatch, unmatched quote, CRLF |
| Works interactively, fails in cron/CI | `env` names, PATH | Minimal environment, no profile loaded |
| Exit 1 with no message | `bash -x`, `set -x` | Silent `grep`, `test`, or subshell |
| Pipeline returns 0 on failure | `set -o pipefail`, `PIPESTATUS` | Last command succeeded |
| Argument split unexpectedly | `printf '%q'` | Missing quotes |
| Glob expands to nothing | `shopt -s nullglob` or a `[ -e ]` check | Unmatched `*` passed literally |
| `Argument list too long` | `getconf ARG_MAX` | Too many files; use `find -exec` or `xargs -0` |
| `Text file busy` | `lsof`, `ps` | Binary running while replaced |
| Unicode garbled | `locale`, `echo $LANG` | Encoding mismatch |
| CRLF in output | `file`, `od -c` | Windows editor |
| Random failure under load | `ulimit -a`, disk, memory | Resource exhaustion |
| Hangs forever | `timeout`, process tree | Reads stdin, waits on network, deadlock |

## POSIX versus Windows

| Topic | POSIX | Windows / Git Bash |
| --- | --- | --- |
| Path separator | `/` | `/` accepted by MSYS, `\` is an escape |
| Drive paths | Not applicable | `C:/dir`, `/c/dir` |
| Executable bit | Required | Ignored; extension matters |
| Case sensitivity | Usually sensitive | Insensitive on NTFS |
| Line endings | LF | CRLF common |
| Shell shims | Scripts with shebang | `.cmd`, `.exe`, `.ps1` |
| `where` | Not standard | `where` finds executables |
| Process tools | `ps`, `lsof`, `strace` | `tasklist`, `Get-Process`, no strace |
| `sed -i` | GNU compatible | Git Bash uses GNU sed |

In Git Bash, `MSYS_NO_PATHCONV=1` prevents automatic path rewriting:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "/c/data:/data" image
```

## Quoting cheat sheet

```bash
name="two words"
printf '<%s>\n' "$name"      # <two words>
printf '<%s>\n' $name        # <two> <words>

files=(*.txt)
printf '%s\n' "${files[@]}"  # one element per file

rm -- "-leading-dash"
```

Build commands as arrays, not strings:

```bash
args=(--flag "value with spaces" --output "out dir")
command "${args[@]}"
```

Avoid:

```bash
cmd="tool --flag $value"
$cmd
```

The second form splits and globs the value again.

## Pipeline debugging

```bash
set -o pipefail
set -x
producer | consumer
status=("${PIPESTATUS[@]}")
printf '%s\n' "${status[@]}"
```

To find which stage fails, write each stage to a file or use `tee`:

```bash
producer | tee /tmp/stage1.out | consumer
```

Do not use `/tmp` on Git Bash for Windows programs that do not understand MSYS paths. Use a project-local directory.

## Environment isolation

```bash
env -i PATH="$PATH" HOME="$HOME" bash -lc 'command -v node; node --version'
```

If the command passes with a minimal environment, a startup file or inherited variable is the cause.

```bash
bash -n script.sh          # syntax only
bash -x script.sh          # trace
bash -u script.sh          # fail on unset variables
bash -euo pipefail script.sh
```

## Logs and evidence

Keep the failing command and its output in the task record:

```markdown
Command:
Shell:
Directory:
Exit code:
Stdout:
Stderr:
Environment differences:
Hypothesis:
Test:
Result:
```

A screenshot of a terminal is weaker evidence than text. Copy the text.
