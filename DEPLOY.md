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

## Ensure OpenAI secrets are unified

```powershell
supabase secrets set OPENAI_SECRET_KEY="<OPENAI_API_KEY>" OPENAI_API_KEY="<OPENAI_API_KEY>"
```

## Deploy functions

```powershell
supabase functions deploy mort-openai
supabase functions deploy mort-openai-tts
supabase functions deploy mort-run-now
supabase functions deploy mort-news-search
```

## Optional cleanup (remove legacy slugs)

If older function slugs were deployed (`open-ai`, `quick-action`), remove them to avoid confusion:

```powershell
supabase functions delete open-ai
supabase functions delete quick-action
```
