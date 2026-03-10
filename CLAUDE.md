## Project

TypeScript rewrite of shinycannon (Shiny load-testing tool, originally Kotlin).
Plan: `_dev/_plan.md`. Spec: `_dev/00-spec-shinycannon.md`. Kotlin archive: `_archive/kotlin/`.

## Execution Model

Operate autonomously through all phases of `_dev/_plan.md`. Do not stop between
phases for permission. If you hit a design ambiguity or risk, write it to
`_dev/_review.md` (What / Where / Decision / Why it needs review), make a
reasonable choice, and keep going.

## Rules

1. **Orchestrator only** — delegate ALL code to subagents
2. **Read before delegating** — read relevant files before writing subagent prompts
3. **Maximize parallelism** — batch independent work; sequential for dependent work
4. **Track progress** — update plan files AND task tools as work progresses
5. **Quality gates** — run build/type-check between batches
6. **Commit incrementally** — after each logical group, not all at the end
7. **Don't over-batch** — fewer tasks at a time for complex/high-risk items
8. **Never force push** unless user explicitly requests it
9. **Never amend commits** — always create new commits for fixes
10. **Stage specific files** — never `git add -A` or `git add .`

## Progress Tracking

| Layer | Scope | Persists? |
|---|---|---|
| `_dev/_plan.md` | Overall project progress (single source of truth) | Yes |
| `_dev/_plan_phase-NN.md` | Per-phase breakdown (work items, deps, done criteria) | Yes |
| Task tools | In-flight work within a session | No |

**Start of every conversation:** read `_dev/_plan.md` to orient.
**After meaningful work:** update `_dev/_plan.md` to reflect reality.
**Before starting a phase:** create `_dev/_plan_phase-NN.md` with actionable
items, dependencies, files, done criteria, and model assignments.
**Task tools are mandatory:** `TaskCreate` before work, `TaskUpdate` on
start/complete, `TaskList` frequently, `TaskGet`/`TaskOutput` before marking done.

## Subagent Models

- **Sonnet** (default): Modules, tests, fixes, config, refactors.
- **Haiku**: Trivial/mechanical. Renames, imports, single-field additions, boilerplate.
- **Opus**: Complex reasoning. Edge cases, concurrency, parsers, subtle bugs.

When in doubt, use Sonnet. Escalate to Opus after two failed Sonnet attempts.

## Delegation Tips

- Provide full context: spec section, types/interfaces, file paths, expected output
- Reference Kotlin original when helpful: `_archive/kotlin/src/main/kotlin/com/rstudio/shinycannon/<File>.kt`
- Use `run_in_background: true` for independent tasks
- Batch independent work; sequence dependent work

## End-of-Phase Review

1. Run `/roborev:fix` — fix and commit
2. Run `/critical-code-reviewer` via Opus subagent on all phase files
3. Fix Blocking/Required findings (skip if intentional design or spec conflict)
4. Fix quality Suggestions (skip over-engineering or style conflicts)
5. Commit review fixes (e.g., "fix: address phase N code review findings")
6. Update `_dev/_plan.md` to mark phase complete

**Before starting next phase:** run `/roborev:fix` again, read `_dev/_plan.md`,
create new phase plan file.
