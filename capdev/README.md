# Capability & Development Platform — Minimum Deployable Version

QA evaluation for production reps: upload a call, evaluate it against the
rubric, clip the moments that mattered, publish what's worth keeping.

**Status: Milestone 1 of 7 — Authentication + Project Setup.**

## Setup

See `SETUP.md`. About 30 minutes.

## Layout

```
supabase/migrations/   database schema, run in numerical order
web/                   React + Vite + TypeScript + Tailwind
docs/approved/         the architecture this implements
```

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Authentication + project setup | **Complete** |
| 2 | Upload audio + storage | Next |
| 3 | Transcription + audio player | Blocked — no transcription provider chosen |
| 4 | QA workspace + rubric | |
| 5 | Moments + evidence | |
| 6 | Save evaluation | |
| 7 | Publish to Notion | |

## Two rules that are not negotiable

**Audit rows are written by database triggers, not by application code.** They
fire inside the same transaction as the change, so an audit record cannot be
skipped, forgotten, or bypassed — by the app, by a service key, or by someone
in the SQL editor.

**The database denies by default.** Every table has row-level security on with
no permissive policy unless one was written deliberately. A signed-out request
sees nothing; a signed-in request sees only their own organization.

Both are verified by the tests in `supabase/tests/`.
