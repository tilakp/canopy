---
description: Commit, update README, push, build, and install Canopy to /Applications
---

Run the full "ship it" checklist for Canopy, end to end, without pausing to
ask for per-step confirmation — the user invoking `/ship` is the
confirmation for all of it, including the push and the `/Applications`
overwrite. Still report honestly at each step; don't skip a step silently
just because it's inconvenient.

1. **Gate on correctness.** Run `bun run test` and `bunx tsc --noEmit`. If
   either fails, stop right here and report the failure clearly — do not
   commit, push, or build on top of broken code or a broken type-check.

2. **Check for anything to ship.** Run `git status`. If the working tree
   is clean, say so and stop — there's nothing to do.

3. **Commit.** Review the actual diff (`git diff`, `git status`) to
   understand what changed — don't guess from memory of the conversation.
   Stage it and write a clear, specific commit message matching this
   repo's existing style (check `git log` for tone: a concise imperative
   summary line, then a body when the change is non-trivial). Never use a
   generic message like "update files". If changes are large but only
   loosely related, splitting into a couple of logical commits is fine;
   don't force one commit when the repo's own history didn't.

4. **Update README if user-facing.** If the change adds/changes a
   feature, keyboard shortcut, or user-visible behavior, update
   `README.md`'s Features list and/or file table to match — same spirit
   as `CLAUDE.md`'s file table, but in README's simpler, user-facing tone
   (no internal design rationale, no "why" commentary). Skip this step
   only for changes with nothing user-facing to describe (internal
   refactors, test-only changes, docs-only changes). Commit this as its
   own commit if step 3 already committed.

5. **Push.** Push the current branch to its configured remote (plain
   `git push` if upstream is already set, matching how this repo is
   normally pushed). If there's no upstream configured, say so and ask
   rather than guessing which remote/branch to push to.

6. **Build.** Run `bun run tauri build` (compiles the Rust shell in
   release mode — can take a minute or more).

7. **Install.** Replace whatever is at `/Applications/Canopy.app` with
   the freshly built
   `src-tauri/target/release/bundle/macos/Canopy.app`. If Canopy is
   currently running, note that in the report (a running instance can
   hold files open) but proceed with the replace regardless.

8. **Report.** A short, concrete summary: what was committed (and any
   README change), the push result, and confirmation the new build is
   installed — not a restatement of these instructions.
