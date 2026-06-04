# Contributing

Thanks for helping improve `repoview`.

## Setup

```bash
npm install
```

## Run

```bash
npm start -- --repo /path/to/repo --port 7376
```

## Lint & test

```bash
npm run lint   # tsc --noEmit (strict type-check)
npm test       # build + node:test HTTP integration suite
```

## What to work on

High-impact contributions:
- GitHub-parity improvements for Markdown rendering
- Performance on large repos (pagination, caching, faster scanning)
- UI polish (especially mobile)
- Security hardening (path handling, sanitization rules)

Implementation notes: `DEVELOPMENT.md`.

