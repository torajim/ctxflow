<p align="center">
  <img src="docs/assets/ctxflow-hero.svg" alt="ctxflow - context flows, teams converge" width="720" />
</p>

<p align="center">
  <strong>협업 바이브 코딩을 위한 실시간 LLM 컨텍스트 동기화</strong>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

여러 개발자가 LLM 어시스턴트와 함께 같은 프로젝트를 바이브 코딩하면, 각 어시스턴트의 컨텍스트가 필연적으로 **발산**합니다 — 서로 다른 접근 방식, 중복 작업, 머지 불가능한 코드로 이어지죠.

**ctxflow**는 git orphan branch를 통해 모든 작업자의 컨텍스트를 실시간 동기화하여 이 문제를 해결합니다. 모든 LLM 어시스턴트가 자동으로 다른 사람이 무엇을 하고 있는지, 어떤 결정을 내렸는지, 어디서 충돌 가능성이 있는지를 파악합니다.

## 특징

- **인터랙티브 CLI.** `ctxflow`로 활성 작업 확인, 참여 또는 새로 생성 — 한 번에 처리.
- **설정 불필요.** git remote 자동 감지, 동기화 채널 생성, Claude Code 훅 설치 — 첫 실행에 전부 자동 처리.
- **세션 기반.** 각 터미널 세션이 고유 세션 ID를 부여받아, 같은 사용자도 여러 작업을 동시에 수행 가능.
- **로컬 우선.** 오프라인에서도 작동, 네트워크 가능 시 동기화.
- **설계상 머지 충돌 없음.** 각 워커가 자기 파일만 수정 (세션 ID 기반) — 구조적으로 충돌 불가능.
- **적응적 컨텍스트 주입.** 평소엔 요약, 파일 겹침 감지 시 상세 경고.
- **백그라운드 데몬.** 5초 간격 동기화, 사용자에게 투명하게 동작.

## 동작 원리

```
┌─────────────┐                          ┌─────────────┐
│  Worker A    │    git orphan branch     │  Worker B    │
│  (Claude)    │◄────── "ctxflow" ──────►│  (Claude)    │
│              │      자동 push/pull       │              │
│ PreToolUse   │       5초 간격            │ PreToolUse   │
│ 훅이 B의     │                          │ 훅이 A의     │
│ 컨텍스트 주입│                          │ 컨텍스트 주입│
└─────────────┘                          └─────────────┘
```

각 워커의 LLM은 매 도구 사용 전 `<system-reminder>`를 주입받아, 다른 워커의 상태, 최근 파일 변경, 접근 방식 메모를 확인합니다.

## 시작하기

### 사전 요구사항

- **Node.js** 18+
- **Git** (원격 리포지토리 설정 필요 — GitHub, GitLab 등)
- **Claude Code** (자동 훅 연동)

### 설치

```bash
git clone https://github.com/torajim/ctxflow.git
cd ctxflow
npm install
npm run build
npm link
```

설치 확인:

```bash
ctxflow --version   # 0.1.0
```

### 삭제

```bash
npm unlink -g ctxflow
```

### 빠른 시작

#### 1. 작업 시작

프로젝트 디렉토리에서 터미널을 열고 실행합니다:

```bash
cd my-project
ctxflow
```

첫 실행 시 ctxflow가 자동으로:
- `git config user.name`을 워커 식별자로 사용합니다 (미설정 시 입력 요청)
- 활성 작업 목록을 표시하거나 새 작업 생성을 안내합니다
- `.ctxflow/` 디렉토리를 생성합니다 (자동으로 gitignore에 추가)
- Claude Code 훅을 `.claude/settings.local.json`에 설치합니다
- 백그라운드 동기화 데몬을 시작합니다

직접 새 작업을 시작할 수도 있습니다:

```bash
ctxflow start "JWT 인증 미들웨어 구현"
```

#### 2. 세션 트래킹 활성화 후 LLM과 코딩

작업 시작 후 ctxflow가 세션 ID를 표시합니다. 환경변수로 설정한 뒤 Claude Code를 시작합니다:

```bash
export CTXFLOW_SESSION=<session-id>
claude
```

이제부터 Claude가 도구를 사용할 때마다, 팀원들이 무엇을 하고 있는지 자동으로 컨텍스트를 받습니다:

```
[ctxflow] collaboration status:
- jimin: "사용자 프로필 API" | Drizzle ORM 사용, REST 엔드포인트 구축 중
  recent: src/api/users.ts (+CRUD endpoints), src/db/schema.ts (+users 테이블)

[ctxflow] When making key architectural decisions or changing your approach,
please update .ctxflow/context/<session-id>.md with a brief summary.
```

#### 3. 팀원이 참여

다른 머신(또는 터미널)에서 팀원이 기존 작업에 참여하거나 새 작업을 만듭니다:

```bash
cd my-project          # 같은 리포, 같은 remote
ctxflow                # 활성 작업 확인 및 참여
```

```
ctxflow - collaboration status

Active tasks:
  [1] JWT 인증 미들웨어 구현 (abc123)
      stefano (working, 방금 전)
  [N] Create a new task

Select a task to join, or N to create new:
```

또는 작업 ID로 직접 참여:

```bash
ctxflow join abc123
```

팀원의 Claude는 이제 자동으로 나의 작업 컨텍스트를 보고, 나의 Claude도 팀원의 컨텍스트를 봅니다.

#### 4. 충돌 감지

두 워커가 같은 파일을 수정하면, ctxflow가 자동으로 상세 모드로 전환합니다:

```
[ctxflow] collaboration status:
- jimin: "사용자 프로필 API" | Drizzle ORM, REST 패턴
  recent: src/api/users.ts (+CRUD endpoints)

  ⚠ conflict: src/types/index.ts (stefano, jimin)

[ctxflow] ...
```

#### 5. 작업 종료

```bash
ctxflow stop
```

여러 세션이 활성화되어 있으면 특정 세션을 지정합니다:

```bash
ctxflow stop --session <session-id>
```

### 프로젝트 구조

```
.ctxflow/                          # 자동 생성, gitignore됨
├── tasks/
│   └── {task-id}.json             # 태스크 메타데이터
├── workers/
│   └── {session-id}.json          # 각 세션이 자기 파일만 수정
├── sessions/
│   └── {session-id}.json          # 세션-태스크 매핑
├── context/
│   └── {session-id}.md            # 접근 방식 메모 (LLM이 작성)
├── .sync/                         # orphan branch 동기화용 git 저장소
├── daemon.pid                     # 백그라운드 데몬 PID
└── debug.log                      # 데몬 디버그 로그
```

## CLI 레퍼런스

| 명령어 | 설명 |
|--------|------|
| `ctxflow` | 인터랙티브 플로우: 활성 작업 표시, 참여 또는 생성 |
| `ctxflow start <설명>` | 새 작업 생성 및 시작 |
| `ctxflow join <task-id>` | 기존 활성 작업에 참여 |
| `ctxflow list` | 모든 활성 작업 및 참여자 목록 |
| `ctxflow stop` | 현재 작업 중단 |
| `ctxflow stop --session <id>` | 특정 세션 중단 |

### 내부 명령어 (훅에서 사용)

| 명령어 | 설명 |
|--------|------|
| `ctxflow context --format <hook\|text>` | 컨텍스트 출력 생성 |
| `ctxflow on-edit --file <경로>` | 파일 변경 기록 |
| `ctxflow on-session-end` | 워커를 idle 상태로 전환 |

### 환경변수

| 변수 | 설명 |
|------|------|
| `CTXFLOW_SESSION` | 현재 세션 ID. Claude Code 실행 전에 설정하여 훅이 세션을 식별할 수 있도록 합니다. |

## 동기화 방식

ctxflow는 `ctxflow`라는 이름의 **git orphan branch**를 동기화 채널로 사용합니다:

1. 이 브랜치에는 `.ctxflow/` 상태 파일만 존재합니다 (소스 코드 없음)
2. 각 워커는 자기 파일만 수정합니다 (`workers/{session-id}.json`, `context/{session-id}.md`)
3. 백그라운드 데몬이 5초마다 push/pull합니다
4. 파일이 겹치지 않으므로 `git rebase`는 항상 깨끗하게 성공합니다

즉, **N명이 동시에 동기화해도 머지 충돌이 발생하지 않습니다**.

## 오프라인 및 복구

| 상황 | 동작 | 복구 |
|------|------|------|
| 순간 끊김 | 데몬이 다음 주기에 재시도 | 자동 |
| 장기 오프라인 | 로컬 작업 계속, 상대방에겐 "disconnected" 표시 | 재연결 시 catch-up 동기화 |
| 데몬 크래시 | `ctxflow start`가 자동 재시작 | 자동 |
| 워커 크래시 | 하트비트 타임아웃 (60초) → disconnected 표시 | 자동 |

## 개발

```bash
npm install          # 의존성 설치
npm run build        # TypeScript 컴파일
npm test             # 테스트 실행 (vitest)
npm run dev          # 감시 모드
```

## 라이선스

MIT
