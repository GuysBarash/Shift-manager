# Deploy guide (for agents)

This repo has **multiple agents working in the same working directory concurrently**. Assume uncommitted changes on disk that aren't yours — don't touch, revert, or blindly bundle them.

Windows/PowerShell throughout. Run everything from the repo root:
`C:\Users\Barash\Documents\shift-manager`

## 1. Check what changed

```powershell
git status --porcelain
```

Identify exactly which files are yours. If `src/lib/shift-plan.ts` (the auto-assign algorithm) shows modified and you didn't touch it, **include it anyway** — another agent edits it directly and expects the next deploy to carry it (see `docs/shift-algorithm.md`). Everything else that isn't yours: leave alone.

## 2. Type-check and build

```powershell
npx tsc --noEmit
```
No output = clean.

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
```
Must end with a route table and no errors. Fix before proceeding — never deploy a red build.

## 3. Stage only your files — never `git add -A`

```bash
git add <exact files you changed>
git status --porcelain   # confirm the staged set matches your intent
```

If an unrelated file shows as staged (another agent's `git add` can leave things staged before you run yours), unstage it explicitly:
```bash
git restore --staged <path>
```

## 4. Commit and push

```bash
git commit -m "Short description of the change" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```

If `git push` hangs or fails with an auth error, the cached GitHub credential expired — stop and tell the user; don't retry in a loop.

## 5. Deploy — stash anything not yours first

`vercel deploy` uploads the **whole working directory**, not just committed files. If `git status` still shows other agents' uncommitted work (it usually will), stash it before deploying so you don't ship someone else's half-finished changes:

```bash
git stash push -u -m "concurrent-wip"
```

```powershell
Push-Location "C:\Users\Barash\Documents\shift-manager"
$TOK = Get-Content .vercel-token
npx vercel deploy --prod --token="$TOK" --yes
Pop-Location
```

Then immediately restore what you stashed:
```bash
git stash pop
```

If nothing else is uncommitted, skip the stash/pop — just deploy.

## 6. Verify

Don't take a clean deploy log as proof it works. Check the live site:
```bash
curl -s https://shift-manager-psi-mauve.vercel.app/
```
or open it and exercise the actual feature you changed. For anything auto-assign related, painting/undo/discard test edits on the live grid rather than trusting the algorithm ran — see prior sessions' pattern of live paint → verify → discard.

## Credentials already set up — don't ask for these again

- **GitHub**: cached credential (Git Credential Manager). If it stops working, that's a re-auth issue, not a config issue — flag it, don't try to bypass.
- **Vercel**: token at `.vercel-token` (gitignored). Use exactly as shown in step 5.
- **Supabase**: CLI access token at `.supabase-token` (gitignored), for one-off SQL against the hosted DB:
  ```powershell
  $TOK = Get-Content .supabase-token
  $env:SUPABASE_ACCESS_TOKEN = $TOK
  npx supabase db query --linked "select 1;"
  ```
  Run this via `run_in_background` — it can hang the foreground shell.

## Known gotchas

- **Local Supabase (Docker) is broken and has been all session.** Don't try to fix it or run `npm run dev` against it. Verify against the **hosted** DB and the **live** deployment instead.
- **`.env.local` points at `127.0.0.1:54321`** — a local dev server won't reach the real DB. Not a bug, just don't rely on it.
- **Secrets you don't have** (Google service account key, `SUPABASE_SERVICE_ROLE_KEY`, etc.) can't be fetched by you — ask the user to paste them, then set via:
  ```bash
  printf '%s' "the-value" | npx vercel env add VAR_NAME production --token="$TOK"
  ```
  Use `printf` via the Bash tool, not PowerShell piping — PowerShell tends to add trailing whitespace/newlines that break header-based secrets.
- **Windows Bash tool mangles literal backslashes** in inline command strings — write files containing backslashes with the Write/Edit tool, never construct them via a shell one-liner.
