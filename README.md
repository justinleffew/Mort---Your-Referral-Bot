<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1_XLE-ICPkgAeN1oo_OrMej866Vea5kqY

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create a `.env.local` file using `.env.example` as a template.
   - Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for your Supabase project.
   - The app will not use Supabase unless both variables are set.
   - Set `VITE_AUTH_REDIRECT_URL` to the production callback URL (e.g. `https://mort-your-referral-bot.vercel.app/`) so Supabase email signups return to the correct site.
   - Set the `OPENAI_SECRET_KEY` in `.env.local` to your OpenAI API key.
   - The app uses the `OPENAI_SECRET_KEY` value from `localStorage` first (set in-app), then falls back to `OPENAI_SECRET_KEY`.
3. Run the app:
   `npm run dev`
