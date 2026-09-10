# Edge Functions

This directory is new as of 0075 Phase 2. Before it, **no Edge Function source
lived in this repository** — and that is worth knowing, because two functions
are already deployed and invoked from the client:

- `transcribe`   — `web/src/lib/calls.ts`
- `invite-user`  — `web/src/lib/admin.ts`

Neither has source here. Whatever conventions they use (CORS headers, response
shape, import style) could not be read while `quick-listen` was written, so
`quick-listen` follows the Supabase defaults rather than matching them. If they
differ, aligning all three is worth doing once, and committing the other two
would stop the next person having the same problem.

There is also no `supabase/config.toml` in this repo, so the CLI has nothing to
link against by default and every command below passes `--project-ref`
explicitly.

## Deploying

There is no automated deployment for Edge Functions here. Vercel builds
`capdev/web` only; it does not touch Supabase. Deployment is a manual CLI step,
run by John, from the repository root:

```sh
# Sandbox
supabase functions deploy quick-listen --project-ref <SANDBOX_PROJECT_REF>

# Production — only when a Production gate has been explicitly approved
supabase functions deploy quick-listen --project-ref <PRODUCTION_PROJECT_REF>
```

The project ref is the subdomain in `VITE_SUPABASE_URL`
(`https://<ref>.supabase.co`), and is also shown in the Supabase dashboard under
Project Settings → General → Reference ID.

The CLI uploads `index.ts` and everything it imports, so `fingerprint.ts` goes
with it. No flags are needed beyond the project ref.

**Do not pass `--no-verify-jwt`.** JWT verification at the platform edge is the
first of the two authentication layers `quick-listen` relies on.

## Secrets

`quick-listen` needs none. It reads only the three variables Supabase injects
into every function automatically:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No provider key (OpenAI, ElevenLabs or otherwise) exists in this phase, and none
belongs in the browser at any phase.

## Checking a deployment

```sh
supabase functions list --project-ref <PROJECT_REF>
supabase functions logs quick-listen --project-ref <PROJECT_REF>
```

Log lines are single JSON objects tagged `"fn":"quick-listen"`, carrying
identifiers and an outcome only — never transcript text, speaker names or email
addresses.

## quick-listen

Queues a Quick Listen digest for a call. Takes `{ "call_id": "<uuid>" }` and
nothing else; a body carrying any other key is refused with 400, because
`org_id`, `transcript_id`, `rubric_version_id`, `prompt_version` and `status`
are all derived server-side and a client that supplies one is either confused or
probing.

It calls no AI provider, writes no script and uploads no audio. It moves a call
from "nothing requested" to exactly one `queued` row in `public.call_digest`,
and stops. Phase 3 is what turns a queued row into a real Quick Listen.
