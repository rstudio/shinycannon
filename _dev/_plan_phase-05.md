# Phase 5: Packaging & Release — Detailed Plan

## Work Items

### 5.1 Version reporting — Replace hardcoded version strings (No dependencies)
- **Files:** src/session.ts, src/cli.ts, src/main.ts, tsup.config.ts
- **Agent model:** Sonnet
- **Done when:** All `"0.0.1"` hardcoded strings replaced with a single version source from package.json, embedded at build time via tsup `define`

### 5.2 CI/CD — Replace old Kotlin workflow (No dependencies)
- **Files:** .github/workflows/build.yml
- **Agent model:** Sonnet
- **Done when:** Workflow runs lint, typecheck, test, build on PRs and pushes to main. Uses Node 20. Replaces the old Docker/Maven workflow.

### 5.3 README — Updated for TypeScript version (No dependencies)
- **Files:** README.md
- **Agent model:** Sonnet
- **Done when:** Installation via npm/npx, usage examples, migration notes from Kotlin

## Parallelism Plan

```
5.1 version ──┐
5.2 ci/cd  ───┼──> commit
5.3 readme ───┘
```

All three can be done in parallel.

## Done Criteria
- `npm run typecheck` passes
- `npm test` passes
- `npm run build` succeeds
- `node dist/main.js --help` shows correct version
- `node dist/main.js --version` shows correct version
