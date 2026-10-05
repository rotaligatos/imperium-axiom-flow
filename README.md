# IAF Leave app (Phase 1 of Imperium Axiom Flow)

Installable web app (PWA) — one codebase for Windows, Mac, iPhone/iPad and Android.
No build step. Plain HTML/CSS/JS that talks directly to your Supabase project; all security is enforced by the database (RLS + the checked `iaf_leave_*` functions from migration 0006).

## What it does
- Sign in (Supabase Auth, email + password)
- Home: live VL / SL balances, recent requests, "waiting for you" notice
- File leave (calls `iaf_leave_submit`), cancel, accept/decline a counter-proposal
- Approvals inbox for Supervisors/Managers/HR: Approve, Reject, Propose other dates (`iaf_leave_act`)
- "Who's out" team calendar

## Setup (≈15 minutes)
1. **Database**: you already ran 0000–0006. Now run `0007_link_real_logins.sql` (see step 3).
2. **Public key**: Supabase Dashboard → Project Settings → API → copy the **anon / publishable** key. Paste it in `config.js` (`SUPABASE_ANON_KEY`). NEVER paste the `service_role` / secret key.
3. **Real login accounts**: Dashboard → Authentication → Users → *Add user → Create new user* (tick **Auto Confirm User**) — make one for a test Staff and one for a test Manager. Edit the two emails at the top of `0007_link_real_logins.sql`, run it in the SQL Editor.
4. **Host it** (any static host, HTTPS required for install/offline): 
   - Vercel: New Project → upload/import this folder, Framework "Other", no build command, output directory `.`
   - or Netlify / Cloudflare Pages drag-and-drop the folder.
5. **Install on devices**
   - iPhone/iPad: open the link in **Safari** → Share → *Add to Home Screen*
   - Android: Chrome → ⋮ → *Install app* / *Add to Home screen*
   - Windows/Mac: Chrome or Edge → install icon in the address bar (or ⋮ → Install)

## Notes
- Local test: `node tests/mock-server.js` then `node tests/e2e.js` (uses a stand-in database; tests the UI only).
- Offline: the app shell opens offline, but leave data always comes live from the database (never cached).
