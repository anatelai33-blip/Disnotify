# Disnotify Pro

Discord bot that sends DM notifications when new members join your server.

## Quick Start

1. Copy `.env.example` to `.env` and fill in your values
2. Run `npm install`
3. Run `npx prisma generate && npx prisma db push`
4. Run `npm run start:all`

## Dashboard

Visit `http://localhost:3000` and login with your dashboard password.

## Deploy to Railway

1. Push this repo to GitHub
2. Create account at railway.app
3. Deploy from GitHub
4. Add environment variables
5. Add a volume mounted at `/app/data`
