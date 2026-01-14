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
   - Set the `VITE_GEMINI_API_KEY` in `.env.local` to your Gemini API key.
   - The app uses the `GEMINI_API_KEY` value from `localStorage` first (set in-app), then falls back to `VITE_GEMINI_API_KEY`.
3. Run the app:
   `npm run dev`

## Authentication (Supabase)

This app uses Supabase Auth to associate data with the authenticated user.

- **Enable Email/Password auth** in your Supabase project (Authentication → Providers).
- **Configure your site URL** and allowed redirect URLs in Supabase so email confirmations and password flows work in your environment.
- Ensure your `.env.local` includes `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### Signup / Signin flow

1. Launch the app and you will see a sign-in screen.
2. Use **Create an account** to sign up with email + password (complete email confirmation if required).
3. Sign in with the same credentials to access your data.
4. Use the Preferences screen to sign out and switch accounts.
