<p align="center">
  <img src="docs/assets/ctxflow-hero.svg" alt="ctxflow - context flows, teams converge" width="720" />
</p>

<p align="center">
  <strong>Real-time LLM context synchronization for collaborative vibe coding</strong>
</p>

<p align="center">
  <a href="README.ko.md">한국어</a> · <a href="LICENSE">MIT License</a>
</p>

---

When multiple developers vibe-code on the same project with LLM assistants, each assistant's context inevitably **diverges** — leading to conflicting approaches, duplicated work, and unmergeable code.

**ctxflow** solves this by synchronizing context across all workers in real time through a git orphan branch. Every LLM assistant automatically sees what others are working on, what decisions they've made, and where potential conflicts lie.

## Features

- **Interactive CLI.** `ctxflow` shows active tasks, lets you join or create — all in one flow.
- **Zero config.** Detects git remote automatically, creates sync channel, installs Claude Code hooks — all on first run.
- **Session-based.** Each terminal session gets its own session ID — even the same user can run multiple tasks simultaneously.
- **Local-first.** Works offline, syncs when network is available.
- **No merge conflicts by design.** Each worker writes only to their own files (keyed by session ID) — structural conflict elimination.
- **Adaptive context injection.** Summaries when things are calm, detailed warnings when file overlaps are detected.
- **Background daemon.** Configurable sync loop (default 5s) with heartbeat, invisible to the user.
- **Security hardened.** Path traversal protection, input size limits, atomic file operations, and lock staleness detection.

## How It Works

```
┌─────────────┐                          ┌─────────────┐
│  Worker A    │    git orphan branch     │  Worker B    │
│  (Claude)    │◄────── "ctxflow" ──────►│  (Claude)    │
│              │     auto push/pull       │              │
│ PreToolUse   │      every 5 sec         │ PreToolUse   │
│ hook injects │                          │ hook injects │
│ B's context  │                          │ A's context  │
└─────────────┘                          └─────────────┘
```

Each worker's LLM gets a `<system-reminder>` injected before every tool use, containing the other workers' status, recent file changes, and approach notes.

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Git** with a configured remote (GitHub, GitLab, etc.)
- **Claude Code** (for automatic hook integration)

### Installation

```bash
git clone https://github.com/torajim/ctxflow.git
cd ctxflow
npm install
npm run build
npm link
```

Verify installation:

```bash
ctxflow --version   # 0.1.0
```

### Uninstallation

```bash
npm unlink -g ctxflow
```

### Quick Start

#### 1. Start your task

Open a terminal in your project directory and run:

```bash
cd my-project
ctxflow
```

On first run, ctxflow will:
- Use your `git config user.name` as your worker identifier (prompts if not set)
- Show active tasks or prompt you to create a new one
- Create the `.ctxflow/` directory (automatically gitignored)
- Install Claude Code hooks in `.claude/settings.local.json`
- Start the background sync daemon

You can also directly start a new task:

```bash
ctxflow start "Implement JWT auth middleware"
```

#### 2. Enable session tracking and code with your LLM

After starting a task, ctxflow will display the session ID. Set it as an environment variable and launch Claude Code:

```bash
export CTXFLOW_SESSION=<session-id>
claude
```

From now on, every time Claude uses a tool, it automatically receives context about what your teammates are doing:

```
[ctxflow] collaboration status:
- jimin: "User profile API" | Using Drizzle ORM, building REST endpoints
  recent: src/api/users.ts (+CRUD endpoints), src/db/schema.ts (+users table)

[ctxflow] When making key architectural decisions or changing your approach,
please update .ctxflow/context/<session-id>.md with a brief summary.
```

#### 3. Your teammate joins

On another machine (or terminal), your teammate joins an existing task or creates a new one:

```bash
cd my-project          # same repo, same remote
ctxflow                # see active tasks and join one
```

```
ctxflow - collaboration status

Active tasks:
  [1] Implement JWT auth middleware (abc123)
      stefano (working, just now)
  [N] Create a new task

Select a task to join, or N to create new:
```

Or join directly by task ID:

```bash
ctxflow join abc123
```

Their Claude instance now automatically sees your work context, and yours sees theirs.

#### 4. Conflict detection

When two workers touch the same file, ctxflow automatically switches to detailed mode:

```
[ctxflow] collaboration status:
- jimin: "User profile API" | Drizzle ORM, REST pattern
  recent: src/api/users.ts (+CRUD endpoints)

  ⚠ conflict: src/types/index.ts (stefano, jimin)

[ctxflow] ...
```

#### 5. Stop when done

```bash
ctxflow stop
```

If you have multiple active sessions, specify which one:

```bash
ctxflow stop --session <session-id>
```

## Demo Walkthrough

Below is a step-by-step example of running ctxflow locally with two terminals to simulate a collaborative session.

### Setup

```bash
# Terminal shared: create a test project
mkdir /tmp/demo-project && cd /tmp/demo-project
git init && git remote add origin git@github.com:youruser/demo-project.git
```

### Terminal 1 — Worker A (Stefano)

```bash
cd /tmp/demo-project
ctxflow start "Build user authentication"
```

```
Task started: Build user authentication
Task ID: a1b2c3d4e5
Session: xK9mQ2pL
Worker: stefano

To enable session tracking in Claude Code, run:
  export CTXFLOW_SESSION=xK9mQ2pL
Then start Claude Code:
  claude
```

```bash
export CTXFLOW_SESSION=xK9mQ2pL
claude
# Claude is now working... edits src/auth/login.ts, src/auth/middleware.ts
```

### Terminal 2 — Worker B (Jimin)

```bash
cd /tmp/demo-project
ctxflow
```

```
ctxflow - collaboration status

Active tasks:
  [1] Build user authentication (a1b2c3d4e5)
      stefano (working, just now)
  [N] Create a new task

Select a task to join, or N to create new: 1
```

```
Joined task: Build user authentication
Task ID: a1b2c3d4e5
Session: pR7nW4kJ
Worker: jimin

To enable session tracking in Claude Code, run:
  export CTXFLOW_SESSION=pR7nW4kJ
Then start Claude Code:
  claude
```

```bash
export CTXFLOW_SESSION=pR7nW4kJ
claude
# Jimin's Claude now automatically sees Stefano's context:
```

```
[ctxflow] collaboration status:
- stefano: "Build user authentication" | JWT-based auth with bcrypt
  recent: src/auth/login.ts (+login endpoint), src/auth/middleware.ts (+JWT verify)

[ctxflow] When making key architectural decisions or changing your approach,
please update .ctxflow/context/pR7nW4kJ.md with a brief summary.
```

### Conflict detected

When Jimin's Claude edits a file Stefano already touched:

```
[ctxflow] collaboration status:
- stefano: "Build user authentication" | JWT-based auth
  recent: src/auth/login.ts (+login endpoint), src/types/index.ts (+AuthUser type)

  ⚠ conflict: src/types/index.ts (stefano, jimin)

[ctxflow] When making key architectural decisions or changing your approach,
please update .ctxflow/context/pR7nW4kJ.md with a brief summary.
```

### Check status

```bash
ctxflow status
```

```
ctxflow status

  Daemon: running
  Sessions: 2
    xK9mQ2pL - working - "Build user authentication"
    pR7nW4kJ - working - "Build user authentication"
```

### Finish up

```bash
# Terminal 1
ctxflow stop --session xK9mQ2pL
# Session xK9mQ2pL stopped.

# Terminal 2
ctxflow stop --session pR7nW4kJ
# Session pR7nW4kJ stopped.

# Clean up stale data
ctxflow cleanup
# Cleaned up 2 stale entries.
```

## Project Structure

```
.ctxflow/                          # auto-created, gitignored
├── tasks/
│   └── {task-id}.json             # task metadata
├── workers/
│   └── {session-id}.json          # each session owns its file only
├── sessions/
│   └── {session-id}.json          # session-to-task mapping
├── context/
│   └── {session-id}.md            # approach notes (written by LLM)
├── locks/
│   └── {name}.lock/               # atomic directory-based locks
├── .sync/                         # git repo for orphan branch sync
├── daemon.pid                     # background daemon PID
├── daemon.lock/                   # daemon singleton lock
└── debug.log                      # daemon debug log
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `ctxflow` | Interactive flow: show active tasks, join or create |
| `ctxflow start <description>` | Create a new task and begin working |
| `ctxflow join <task-id>` | Join an existing active task |
| `ctxflow list` | List all active tasks and participants |
| `ctxflow status` | Show daemon and session status |
| `ctxflow stop` | Stop your current task |
| `ctxflow stop --session <id>` | Stop a specific session |
| `ctxflow cleanup` | Remove disconnected workers and done tasks |

### Internal commands (used by hooks)

| Command | Description |
|---------|-------------|
| `ctxflow context --format <hook\|text>` | Generate context output |
| `ctxflow on-edit --file <path>` | Record a file change |
| `ctxflow on-session-end` | Mark worker as idle |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CTXFLOW_SESSION` | Current session ID. Set this before launching Claude Code so hooks can identify your session. |

### Configuration

Create an optional `ctxflow.config.json` in your project root to override defaults:

```json
{
  "syncIntervalMs": 5000,
  "inactiveThresholdMs": 60000,
  "maxFilesTouched": 50,
  "pushMaxRetries": 3,
  "pushRetryBaseMs": 500
}
```

Changes are picked up automatically without restarting the daemon.

## How Sync Works

ctxflow uses a **git orphan branch** named `ctxflow` as its sync channel:

1. The branch contains only `.ctxflow/` state files (no source code)
2. Each worker writes only to their own files (`workers/{session-id}.json`, `context/{session-id}.md`)
3. A background daemon pushes/pulls at a configurable interval (default 5s)
4. Since files never overlap, `git rebase` always succeeds cleanly

This means **N workers can sync simultaneously with zero merge conflicts**.

## Offline & Recovery

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| Brief disconnect | Daemon retries next cycle | Automatic |
| Long offline | Local work continues, others see you as "disconnected" | Catch-up sync on reconnect |
| Daemon crash | `ctxflow start` auto-restarts it | Automatic |
| Worker crash | Heartbeat timeout (60s) → marked disconnected | Automatic |
| No sessions left | Daemon auto-shuts down | Automatic |
| Stale locks | Detected by PID + timestamp (120s threshold) | Automatic |

## Security

ctxflow includes several hardening measures:

- **Path traversal protection.** File paths are validated with `path.relative()` to prevent escaping the project root.
- **Input size limits.** Stdin input is capped at 1 MB with incremental checking to prevent memory exhaustion.
- **Atomic file operations.** All state files are written via tmp + rename to prevent corruption.
- **Lock staleness detection.** Locks store PID + timestamp; stale locks from dead or recycled processes are automatically reclaimed.
- **ID sanitization.** All task/session IDs are validated against `[\w-]+` with a 128-character limit.
- **Error boundaries.** All CLI commands are wrapped in try-catch to prevent unhandled crashes.

## Development

```bash
npm install          # install dependencies
npm run build        # compile TypeScript
npm test             # run tests (vitest)
npm run dev          # watch mode
```

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2025 Stefano Jang
