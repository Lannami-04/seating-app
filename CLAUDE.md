# Seating app: standing rules

## Git and deploys
- Work directly on the `main` branch.
- Every push to `main` auto-deploys to the live app on Vercel, so treat a push as a release.
- Keep `npm run build` and `npm run lint` passing before every commit.

## Database (Supabase)
- Local dev and the live app share the SAME Supabase database. Warn before anything that changes or deletes real data.
- If a change needs a new SQL migration (in `supabase/migrations/`), STOP before committing. Show the SQL so the user can run it in the Supabase SQL Editor themselves, and wait for their confirmation before pushing.
- Never use the Supabase secret key.

## Secrets
- Never commit `.env.local` or any keys.

## Dependencies
- Use TypeScript 6.x. Do not upgrade to 7, because typescript-eslint doesn't support it.
- Never run `npm audit fix --force`.

## Explaining changes
- The user is learning React and TypeScript. Explain changes simply, and compare to Java when it helps.
