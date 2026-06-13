# WhatsApp CRM Pro

Self-hosted WhatsApp CRM — shared inbox, contacts, sales pipelines, broadcasts, and no-code automations.

## Stack

- Next.js 16 (App Router)
- PostgreSQL (local) + Prisma ORM
- NextAuth.js (authentication)
- Socket.io (real-time)
- Tailwind v4 + shadcn/ui

## Getting Started

1. Copy `.env.local.example` to `.env.local` and fill in your values.
2. Run `npx prisma migrate dev` to apply database migrations.
3. Run `npm run dev` to start the development server.

## Environment Variables

See `.env.local.example` for all required variables.
