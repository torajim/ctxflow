<p align="center">
  <img src="docs/assets/ctxflow-hero.svg" alt="ctxflow - context flows, teams converge" width="720" />
</p>

<p align="center">
  <strong>Real-time LLM context synchronization for collaborative vibe coding</strong>
</p>

<p align="center">
  <a href="README.ko.md">한국어</a>
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
- **Background daemon.** 5-second sync loop with heartbeat, invisible to the user.

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
[ctxflow] Collaboration status:
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

### Project Structure

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
├── .sync/                         # git repo for orphan branch sync
├── daemon.pid                     # background daemon PID
└── debug.log                      # daemon debug log
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `ctxflow` | Interactive flow: show active tasks, join or create |
| `ctxflow start <description>` | Create a new task and begin working |
| `ctxflow join <task-id>` | Join an existing active task |
| `ctxflow list` | List all active tasks and participants |
| `ctxflow stop` | Stop your current task |
| `ctxflow stop --session <id>` | Stop a specific session |

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

## How Sync Works

ctxflow uses a **git orphan branch** named `ctxflow` as its sync channel:

1. The branch contains only `.ctxflow/` state files (no source code)
2. Each worker writes only to their own files (`workers/{session-id}.json`, `context/{session-id}.md`)
3. A background daemon pushes/pulls every 5 seconds
4. Since files never overlap, `git rebase` always succeeds cleanly

This means **N workers can sync simultaneously with zero merge conflicts**.

## Offline & Recovery

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| Brief disconnect | Daemon retries next cycle | Automatic |
| Long offline | Local work continues, others see you as "disconnected" | Catch-up sync on reconnect |
| Daemon crash | `ctxflow start` auto-restarts it | Automatic |
| Worker crash | Heartbeat timeout (60s) → marked disconnected | Automatic |

## Development

```bash
npm install          # install dependencies
npm run build        # compile TypeScript
npm test             # run tests (vitest)
npm run dev          # watch mode
```

## License

MIT
