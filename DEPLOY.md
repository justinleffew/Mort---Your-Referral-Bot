# Supabase Edge Function Deployment (PowerShell)

Run these commands from the repo root in Windows PowerShell to deploy all functions using the Supabase CLI. The CLI deploys functions by folder name, so the resulting endpoints will be:

- `/functions/v1/mort-openai`
- `/functions/v1/mort-openai-tts`
- `/functions/v1/mort-run-now`
- `/functions/v1/mort-news-search`

## One-time setup

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
```

Project ref used: `<PROJECT_REF>` (replace with your Supabase project ref).

## Ensure OpenAI secrets are unified

```powershell
supabase secrets set OPENAI_SECRET_KEY="<OPENAI_API_KEY>" OPENAI_API_KEY="<OPENAI_API_KEY>"
```

## Configure production CORS origins

```powershell
supabase secrets set MORT_PRODUCTION_ORIGINS="https://mort-your-referral-bot.vercel.app"
```

The demo URL above is already included in the default allowlist inside `supabase/functions/_shared/cors.ts`, and `MORT_PRODUCTION_ORIGINS` augments that list at runtime, so setting the secret to the demo URL keeps CORS aligned with the deployed frontend.

## Deploy functions

```powershell
supabase functions deploy mort-openai
supabase functions deploy mort-openai-tts
supabase functions deploy mort-run-now
supabase functions deploy mort-news-search
```

Note: `supabase/functions/mort-openai/config.toml` sets `verify_jwt = false`. Redeploy `mort-openai` after any config changes so the gateway picks up the new setting.

## Optional cleanup (remove legacy slugs)

If older function slugs were deployed (`open-ai`, `quick-action`), remove them to avoid confusion. The app must call `/functions/v1/mort-openai`, `/functions/v1/mort-openai-tts`, `/functions/v1/mort-run-now`, and `/functions/v1/mort-news-search`.

```powershell
supabase functions delete open-ai
supabase functions delete quick-action
```

## Demo auth readiness checklist

- Set `VITE_AUTH_REDIRECT_URL` in Vercel/Supabase frontend env to `https://mort-your-referral-bot.vercel.app/#/auth/callback` to keep hash-based auth callbacks working.
- If Supabase email confirmation is enabled, pre-create a demo user in Supabase Auth and verify they can sign in without waiting on a confirmation email.
- Confirm the demo user has a row in `realtor_profiles` or that the app fallback defaults are acceptable for the demo experience.
