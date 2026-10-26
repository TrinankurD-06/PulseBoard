# PulseBoard

Uptime monitoring and public status pages, built on the MERN stack (MongoDB, Express, React, Node).

> Work in progress: the full README (features, architecture, deploy steps, demo script) is
> written in the final phase. Design decisions are logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Local setup

Requirements: Node 20+, Docker Desktop.

```bash
cp .env.example .env        # defaults work for local development
docker compose up -d        # MongoDB as a single-node replica set (rs0)
npm install
npm run dev                 # api :4000, worker (health :4002), client :5173
```

## Scripts

| Command          | What it does                   |
| ---------------- | ------------------------------ |
| `npm run dev`    | Runs all apps with live reload |
| `npm test`       | Runs every workspace's tests   |
| `npm run lint`   | ESLint across the monorepo     |
| `npm run format` | Prettier across the monorepo   |
