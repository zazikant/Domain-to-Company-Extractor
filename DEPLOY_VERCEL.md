# Vercel Deployment Guide

This project is optimized for a simple, secure deployment to Vercel. All sensitive API keys are handled on the server-side to keep your credentials private.

## Quick Start
1. **GitHub**: Push your code to a GitHub repository.
2. **Vercel**: Import the repository into [Vercel](https://vercel.com/new).
3. **Environment Variables**: Add the following variables in the **Environment Variables** section before clicking **Deploy**.

## Required Environment Variables

| Service | Variable Name | Description |
| :--- | :--- | :--- |
| **Base Database** | `DATABASE_URL` | Set to `file:/tmp/cache.db` (Required for Prisma). |
| **Serper** | `X_SERPER_API_KEY` | Your Serper.dev API Key. |
| **Browserless** | `X_BROWSERLESS_TOKEN` | Your Browserless.io Token. |
| **Nvidia** | `X_NVIDIA_API_KEY` | Your Nvidia API Key. |
| **OpenRouter** | `X_OPENROUTER_API_KEY` | Your OpenRouter API Key. |
| **Upstash Redis** | `X_UPSTASH_REDIS_URL` | Your Upstash Redis URL. |
| **Upstash Redis** | `X_UPSTASH_REDIS_TOKEN` | Your Upstash Redis Token. |
| **Convex** | `X_CONVEX_URL` | Your Convex Deployment URL. |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL. |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anon Key. |

---

### Tips for a Clean UI
By using the names above (starting with `X_`), your API keys remain **hidden** on the server. The input fields in your application will remain empty by default for a professional look, but the extraction logic will automatically use these secure keys in the background.

If you ever want a key to show up as the "default" in the input box on your website, simply add another variable with the `NEXT_PUBLIC_` prefix (e.g., `NEXT_PUBLIC_SERPER_KEY`).

### Note on SQLite
Since Vercel uses an ephemeral filesystem, the local SQLite cache will reset on every redeploy. This is normal and safe; the app will automatically fall back to **Convex** and **Supabase** for permanent caching.
