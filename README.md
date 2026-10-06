# nyxilum-mcp

*[Українською](README.uk.md)*

An MCP server that lets an AI assistant (Claude, Cursor, etc.) directly
compile/run/lint/format NyxilumLang (`.nx`) code via
[NyxilumNode](https://github.com/Faneraiy14/NyxilumNode) — without manual
`dotnet run`/copy-paste into a terminal.

## Why a separate repo instead of part of NyxilumLang

This project's `node_modules` shouldn't end up in NyxilumLang's dotnet build or
`publish/`. It lives alongside it, as a sibling project.

## Installation

```bash
git clone https://github.com/Faneraiy14/NyxilumMcp.git
cd NyxilumMcp
npm install
```

Needs a built NyxilumNode nearby (`../NyxilumLang` by default,
`dotnet build src/NyxilumLang` there) — or set the path explicitly:

```bash
# Linux/Mac
export NX_NODE_PATH=/path/to/NyxilumLang   # .exe on Windows, .dll — then runs via `dotnet`
# or
export NX_ECOSYSTEM_ROOT=/path/to/NyxilumLang
```

```powershell
# Windows
$env:NX_NODE_PATH = "C:\path\to\NyxilumLang.exe"
# or
$env:NX_ECOSYSTEM_ROOT = "C:\path\to\NyxilumLang"
```

## Connecting (Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "nyxilum": {
      "command": "node",
      "args": ["/path/to/NyxilumMcp/src/server.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `nyxilum_run` | Compiles and runs code in a sandbox (separate process, timeout, GC-allocation limit) |
| `nyxilum_check` | Lexer+parser only — checks syntax WITHOUT running the code (cheaper and safer than `nyxilum_run` for unfinished code) |
| `nyxilum_lint` | Style warnings (line length, empty blocks) — **not** a syntax check, always exitCode=0 |
| `nyxilum_format` | Formats code |
| `nyxilum_version` | Version of the NyxilumNode found — doubles as a health check |
| `nyxilum_docs` | GUIDE.md in full, or a specific section (by `### ` heading name) |
| `nyxilum_dev_build` | `dotnet build` of the NyxilumLang repo itself (language development, NOT sandboxed — trusted source, not arbitrary `.nx` code) |
| `nyxilum_dev_test` | NyxilumLang's `tests/run_all.sh` against the freshly built binary |
| `nyxilum_repl_start` | Starts a long-lived sandboxed REPL session — `var`/`func` stay visible across calls, unlike `nyxilum_run` |
| `nyxilum_repl_eval` | Runs code in an existing REPL session |
| `nyxilum_repl_stop` | Ends a REPL session and cleans up its temp folder |

## Execution security (`nyxilum_run`)

- Code NEVER ends up in the shell/argv as text — it's always written to
  its own temp file, whose path is passed as a normal process argument
  (`execFile`, without `shell: true`).
- A process `timeout` (10s by default, 60s max) is the only real
  protection against `while (true) {}` with no allocations:
  `NX_GC_MAX_OBJECTS` only counts NyxilumLang allocations (arrays/structs/maps),
  not loop iterations by themselves.
- `env` is an allowlist (`PATH`, `SystemRoot`, `TEMP`, `DOTNET_ROOT`, etc.),
  not the whole `process.env` of this server process.
- `NX_SANDBOX=1` (fixed, doesn't depend on the tool's input arguments) —
  file I/O is restricted to the run's temp folder, and network
  (`httpGet`/`httpServer`/`wsConnect`, etc.) and reading environment
  variables (`osEnv`) are completely forbidden. Requires a NyxilumNode
  build with `NX_SANDBOX` support (see the
  [NyxilumLang README](https://github.com/Faneraiy14/NyxilumLang#sandbox-for-untrusted-code));
  with an older binary the flag is simply ignored.
- Output (`stdout`/`stderr`) is truncated to 32 KB per stream — a loop that
  prints millions of lines won't fill up the response context.
- The temp folder is always removed in a `finally`, even on timeout.

`RunFile` in Nx.cs writes `Runtime Error:`/`Parse Error:` to **stdout**
(not stderr) and exits with `exitCode=1` — that's NyxilumNode's own
behavior, not this server's; every tool explicitly notes this in its
description.

### `nyxilum_repl_*` — persistent state, same sandbox

`nyxilum_run` starts a brand-new process every call — no memory between
calls. The `nyxilum_repl_*` tools instead keep one `nx` REPL process alive
across multiple `nyxilum_repl_eval` calls, so a `var`/`func` declared in
one call is still visible in the next — useful for stepping through an
exploration ("try this, look at the result, adjust") instead of
re-writing the whole accumulated script every time. Same sandbox as
`nyxilum_run` (`NX_SANDBOX=1`, env allowlist, own temp working directory
per session, output truncated to 32 KB).

Two things that follow directly from the REPL being a real, long-lived
process reading stdin line by line, not a one-shot file:

- **Newlines in `code` are flattened to spaces before being sent.** The
  REPL reads one `Console.ReadLine()` per statement — a `func` body split
  across lines breaks it (`Error: expected '}' on line 1`, verified live)
  the moment a `\n` is written to its stdin mid-declaration. Braces don't
  care about line breaks, so multi-line `func {...}`/`struct {...}` still
  work fine once flattened — but `//` line comments do NOT survive
  flattening (the comment would silently eat everything after it on the
  now-single line), so avoid `//` inside multi-line `code` passed here.
- **A timed-out `nyxilum_repl_eval` kills the session.** There's no safe
  way to keep waiting on a process that might be stuck in an infinite
  loop indefinitely, so a call that doesn't respond within `timeout_ms`
  terminates the session immediately (`sessionKilled: true` in the
  response) — start a new one with `nyxilum_repl_start`.

Reading the response reliably (not just "wait a bit and read stdout")
needed its own protocol: right after the caller's code, the session
writes a second line — `print()` of a random one-time marker — and reads
stdout until that marker shows up in the buffer. Everything before it,
minus the REPL's own `"> "` prompt (stripped positionally, as a fixed
2-byte suffix right before the marker — not a blind find-and-replace, so
legitimate output containing `"> "` itself, e.g. `print("a > b")`, comes
through untouched) is the real output of the caller's code.

Sessions are capped at 5 concurrent and auto-close after 10 minutes idle
— always call `nyxilum_repl_stop` when done with one rather than relying
on the idle timeout.

### `nyxilum_dev_build`/`nyxilum_dev_test` — a different trust model

These two are NOT sandboxed (no `NX_SANDBOX`, no env allowlist, no
temp file with code): they run `dotnet build`/`tests/run_all.sh`
on the NyxilumLang repo itself, not on arbitrary `.nx` code from the
call. The caller passes no text that could end up in the command —
only optional `configuration`/`timeout_ms`. Meant for developing
the language itself (changing the VM's/compiler's C# code), not for
checking untrusted code — that's what `nyxilum_run`/`nyxilum_check` are for.

## Tests

```bash
npm test
```

32 checks: `smoke.mjs` calls the handlers directly (successful run,
unhandled `throw`, infinite-loop timeout, `gc_max_objects`,
large-output truncation, resilience to shell metacharacters in the code,
`nyxilum_check` (passes/catches a syntax error/does NOT run the code),
no temp-directory leaks), `repl.mjs` (state persists across calls within
one session, multi-line `func` flattening, legitimate `"> "` output
surviving intact, an error not killing the session, two sessions not
seeing each other's variables, an infinite loop's timeout killing the
session cleanly, no temp-directory leaks), `transport.mjs` — the same
things but through the REAL MCP protocol (`StdioClientTransport` +
`Client`), not just direct function calls.

## Updating

No separate build/publish step for the MCP server itself — `claude mcp add`
points straight at this checkout's `src/server.js`, so updating it is just
`git pull && npm install`, taking effect on the next new Claude Code
session. Separately, if NyxilumLang itself has moved on, rebuild the
NyxilumNode binary this server talks to (`dotnet build src/NyxilumLang` in
the NyxilumLang checkout) — the two update independently.

## Docker

```bash
docker build -t nyxilum-mcp .
docker run -i --rm nyxilum-mcp
```

The server speaks MCP over stdio, so keep `-i`. Needs: nothing - `nx` (NyxilumNode v1.8.3) is already inside the image.
In an MCP client config use `"command": "docker"` with the same arguments.

## License

MIT — Faneraiy14.
