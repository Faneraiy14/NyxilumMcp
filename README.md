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

18 checks: `smoke.mjs` calls the handlers directly (successful run,
unhandled `throw`, infinite-loop timeout, `gc_max_objects`,
large-output truncation, resilience to shell metacharacters in the code,
`nyxilum_check` (passes/catches a syntax error/does NOT run the code),
no temp-directory leaks), `transport.mjs` — the same thing but
through the REAL MCP protocol (`StdioClientTransport` + `Client`), not
just direct function calls.

## Updating

No separate build/publish step for the MCP server itself — `claude mcp add`
points straight at this checkout's `src/server.js`, so updating it is just
`git pull && npm install`, taking effect on the next new Claude Code
session. Separately, if NyxilumLang itself has moved on, rebuild the
NyxilumNode binary this server talks to (`dotnet build src/NyxilumLang` in
the NyxilumLang checkout) — the two update independently.

## License

MIT — Faneraiy14.
