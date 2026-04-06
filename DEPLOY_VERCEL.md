# Vercel Deployment Guide

This project is now configured for a seamless deployment to Vercel. We have preserved the custom VPS deployment structure while adding native compatibility for Vercel's serverless environment.

## What changed to support Vercel?
We added a `"vercel-build": "prisma generate && next build"` script to your `package.json`. Vercel automatically detects and runs this script instead of the default `"build"` script. This ensures Prisma generates its client correctly up-front while deliberately bypassing the `standalone` copy commands that are exclusively meant for your VPS deployment (and would otherwise crash the Vercel build).

Your Supabase and Convex functionalities remain completely intact and will operate perfectly on Vercel.

## Deployment Steps

1. **Push to GitHub**:
   Ensure you've committed your latest changes (including the `package.json` update) and push the repository to GitHub.

2. **Import to Vercel**:
   Go to your [Vercel Dashboard](https://vercel.com/new), select **Add New > Project**, and import this repository from GitHub.

3. **Configure Environment Variables**:
   In the "Environment Variables" section before clicking Deploy, add the following variables:
   
   | Variable | Value (Example) | Description |
   | :--- | :--- | :--- |
   | `DATABASE_URL` | `file:/tmp/cache.db` | Required for Prisma initialization in serverless. |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://...` | Your Supabase Project URL. |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `your_anon_key_...` | Your Supabase Anon/Publishable Key. |
   | `NEXT_PUBLIC_SERPER_KEY` | `2fd9...` | Default Serper.dev API Key for the search input. |
   | `NEXT_PUBLIC_BROWSERLESS_TOKEN` | `2UGx...` | Default Browserless.io Token for the scraping input. |
   | `NEXT_PUBLIC_CONVEX_URL` | `https://...` | Default Convex Deployment URL. |
   | `NEXT_PUBLIC_CONVEX_KEY` | `dev:...` | Default Convex API Key. |
   | `NEXT_PUBLIC_OPENROUTER_KEY` | `sk-or...` | Default OpenRouter API Key. |
   | `NEXT_PUBLIC_NVIDIA_KEY` | `nvapi-...` | Default Nvidia API Key. |
   | `NEXT_PUBLIC_UPSTASH_URL` | `https://...` | Default Upstash Redis URL. |
   | `NEXT_PUBLIC_UPSTASH_TOKEN` | `gQAA...` | Default Upstash Redis Token. |
   | `X_SERPER_API_KEY` | `2fd9...` | (Backend) Search API Key. |
   | `X_BROWSERLESS_TOKEN` | `2UGx...` | (Backend) Scraping Token. |
   | `X_OPENROUTER_API_KEY` | `sk-or...` | (Backend) OpenRouter Key. |

4. **Click Deploy!**

### Note on "Z AI" Independence:
The project is now fully environment-independent. All hardcoded references to the previous `/home/z/` filesystem have been removed. The application now dynamically determines its logging and database paths based on whether it is running on Vercel, a VPS, or your local machine.

### Note on SQLite (Local Cache) Behavior in Vercel:
Vercel is a serverless environment with a read-only filesystem, meaning persistent SQLite files cannot be written to in the same way they are on a VPS. By setting the `DATABASE_URL` to `/tmp/cache.db`, Prisma will initialize cleanly. Because the Vercel filesystem is ephemeral, the SQLite cache will safely "fail open"—if SQLite misses or cannot write, your code gracefully handles the exception and falls back to your primary **Convex** and **Supabase** caching layers without crashing your application.
