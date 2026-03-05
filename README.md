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

- **3 commands.** That's it. `ctxflow`, `ctxflow start`, `ctxflow stop`.
- **Zero config.** Detects git remote automatically, creates sync channel, installs Claude Code hooks — all on first `start`.
- **Local-first.** Works offline, syncs when network is available.
- **No merge conflicts by design.** Each worker writes only to their own files — structural conflict elimination.
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
npm install -g ctxflow
```

Or install from source:

```bash
git clone https://github.com/your-org/ctxflow.git
cd ctxflow
npm install
npm run build
npm link
```

### Quick Start

#### 1. Start your task

Open a terminal in your project directory and start a task:

```bash
cd my-project
ctxflow start "Implement JWT auth middleware"
```

On first run, ctxflow will:
- Ask for your name (used as your worker identifier)
- Create the `.ctxflow/` directory (automatically gitignored)
- Install Claude Code hooks in `.claude/settings.local.json`
- Start the background sync daemon

#### 2. Code with your LLM

Launch Claude Code as you normally would:

```bash
claude
```

That's it. From now on, every time Claude uses a tool, it automatically receives context about what your teammates are doing:

```
[ctxflow] Collaboration status:
- jimin: "User profile API" | Using Drizzle ORM, building REST endpoints
  Recent: src/api/users.ts (+CRUD endpoints), src/db/schema.ts (+users table)

[ctxflow] When making key architectural decisions or changing your approach,
please update .ctxflow/context/stefano.md with a brief summary.
```

#### 3. Your teammate joins

On another machine (or terminal), your teammate does the same:

```bash
cd my-project          # same repo, same remote
ctxflow                # see what's happening
```

```
ctxflow - Collaboration Status

Tasks:
  Implement JWT auth middleware (abc123)
    stefano (working, just now)

  User profile API (def456)
    jimin (working, 3s ago)
```

```bash
ctxflow start "Add admin dashboard"
claude
```

Their Claude instance now automatically sees your work context, and yours sees theirs.

#### 4. Conflict detection

When two workers touch the same file, ctxflow automatically switches to detailed mode:

```
[ctxflow] Collaboration status:
- jimin: "User profile API" | Drizzle ORM, REST pattern
  Recent: src/api/users.ts (+CRUD endpoints)

  ⚠ Conflict: src/types/index.ts (stefano, jimin)

[ctxflow] ...
```

#### 5. Stop when done

```bash
ctxflow stop
```

### Project Structure

```
.ctxflow/                        # auto-created, gitignored
├── tasks/
│   └── {task-id}.json           # task metadata
├── workers/
│   ├── stefano.json             # each worker owns their file only
│   └── jimin.json               # → no merge conflicts possible
├── context/
│   ├── stefano.md               # approach notes (written by LLM)
│   └── jimin.md
└── me.json                      # local identity (not synced)
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `ctxflow` | Show active tasks and participants |
| `ctxflow start <description>` | Create a new task and begin working |
| `ctxflow stop` | Stop your current task |

### Internal commands (used by hooks)

| Command | Description |
|---------|-------------|
| `ctxflow context --format <hook\|text>` | Generate context output |
| `ctxflow on-edit --file <path>` | Record a file change |
| `ctxflow on-session-end` | Mark worker as idle |

## How Sync Works

ctxflow uses a **git orphan branch** named `ctxflow` as its sync channel:

1. The branch contains only `.ctxflow/` state files (no source code)
2. Each worker writes only to their own files (`workers/{name}.json`, `context/{name}.md`)
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
