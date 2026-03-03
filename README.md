# VELOCITY

`velocity` is a TypeScript CLI proxy that sits between an agent and a WebSocket server to reduce frame count and byte overhead while guarding against latency regression.
It is package-first and terminal-first: there is no built-in web dashboard UI.

## Quickstart (Package-first)

```bash
npx velocity proxy --target ws://localhost:4000
npx velocity doctor
npx velocity bootstrap
```

Or install globally:

```bash
npm install -g velocity
velocity proxy --target ws://localhost:4000
velocity doctor
