# M0 Closeout — Decision Sheet
### Everything needed to start engineering, on one page

**Purpose:** clear the four blockers from the v1.0 Implementation Blueprint. Nothing below requires an engineer.
**Time required:** one meeting for Part B, ten minutes for Part A, one email for Part C.

---

## PART A — Do this today (10 minutes, no meeting)

### A1 · Run the export
The Moment Library exists only in per-user browser storage. It is not backed up and no server-side process can reach it. **This has been the state throughout the design phase.**

Open the artifact → **Export library** → read the report → **Download JSON**.

- ☐ Export downloaded
- ☐ Counts match what the app shows: moments ____ playlists ____
- ☐ `source.readFrom` reads `window.storage` *(if it reads `in-memory-state`, re-export in a fresh session)*
- ☐ Checksum recorded here: `________________________________`
- ☐ Stored in three locations, at least one outside Google Drive
- ☐ Every other person who has used the tool has done the same

Runbook: `docs/migration/EXPORT-RUNBOOK.md`

---

## PART B — One meeting, seven decisions

Recommendations are from the approved planning documents. Each needs a yes or an alternative, not a discussion from first principles.

### G-01 · Playlist versioning in Phase 1
Release currently mints no snapshot, which breaks INV-22 and leaves Phase 2 inheriting released playlists with no recoverable history.
**Recommended:** pull `playlist_version` into Phase 1. ~4 hours.
☐ Approved ☐ Rejected — alternative: ______________ · Decider: ______________

### G-02 · `playlist_item` join table in Phase 1
A join table now costs less than a JSONB array plus a Phase 2 unpack migration.
**Recommended:** approve.
☐ Approved ☐ Rejected — alternative: ______________ · Decider: ______________

### G-03 · "Remove" becomes archive
Hard delete breaks INV-10 and INV-11. Same label and position; a moment inside a released snapshot cannot be archived at all. **User-visible change — needs a release note.**
☐ Approved ☐ Rejected — alternative: ______________ · Decider: ______________

### G-04 · Canonical legacy library
Storage is per user. Whose library is authoritative? If more than one, what resolves a conflict?
**No technical answer exists.** Choosing wrongly silently discards someone's work.
Canonical library owner: ______________ · Merge rule if multiple: ______________
*Shortcut: if two exports share a checksum, they are identical and there is no merge problem.*

### G-05 · Export custodian and storage locations
Custodian: ______________ · Locations: (1) ____________ (2) ____________ (3) ____________

### G-06 · Approve PostgreSQL / Supabase
Blocks every migration. The repository port keeps it reversible, but the schema needs a target.
☐ Approved ☐ Alternative: ______________ · Decider (needs budget holder): ______________

### G-07 · Allowed domains and first administrator
`ALLOWED_EMAIL_DOMAINS`: ______________________
`SEED_ADMIN_EMAIL`: ______________________
Second administrator (G-08, recommended not optional): ______________________

---

## PART C — One email to whoever owns the recording tool

The audio pivot turned this from a deferred schema question into a feasibility question for an entire subsystem. **Four questions:**

1. Can raw call audio be fetched programmatically via API, or only downloaded by hand?
2. Is audio recorded dual-channel (rep and customer on separate tracks), or mixed to mono?
3. Do transcripts include **word-level timestamps** and **speaker diarization**?
4. **What is the retention window before recordings are purged?**

Question 4 sets the deadline for signal capture and is the only deadline in the program that cannot be extended — a measurement not taken before a recording expires is permanently lost.

Provider: ______________ · Asked on: ________ · Answered on: ________

---

## PART D — Two names and one assignment

**Engineer (B4):** ______________________
**Second reviewer** *(migrations are never applied without one)*: ______________________

**Capability framework author:** ______________________
Needed by W2. Does not require an engineer and should start now — the schema will be finished before there is anything to put in it. Roughly 8–15 durable competencies with descriptions, each mappable to rubric criteria.

---

## Not blocking W1 — record when known

☐ **G-09 Rubric Owner** — a person, not a committee. *Blocks W2.*
☐ **G-10 Executive access** — aggregate-only, or individual drill-down. *Blocks W3 permissions.*
☐ PolicyReference — entity, external reference, or prose
☐ "Knowledge Packages" — what this term means
☐ `RubricChangeRequest` → `GuidanceChangeRequest` generalisation
☐ Production Assistant: can it emit query telemetry and accept a pull contract? *Blocks v1.1.*
☐ Retention windows per artifact type — *feeds Part C question 4*
☐ Notification channel for evaluation release

---

## Provisioning checklist — after G-06

☐ Supabase project ☐ Render service ☐ Sentry project ☐ GitHub repo with branch protection
☐ Google Cloud OAuth client ☐ Secret store with access list
☐ **Visual baseline screenshots** — `docs/baseline/README.md`, capture from the PRE-M0 file

---

## Sign-off

M0 is complete, and W1 engineering may begin, when Parts A, B, and D are filled in and provisioning is done. Part C may run in parallel but must return before W2.

Completed by: ______________________ Date: ____________
