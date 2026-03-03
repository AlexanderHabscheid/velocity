# Velocity Control Plane SDK (TypeScript)

```bash
npm install @velocity-ai/control-plane-sdk
```

```ts
import { VelocityControlClient } from "@velocity-ai/control-plane-sdk";

const client = new VelocityControlClient("http://127.0.0.1:4200");
const health = await client.healthz();
console.log(health.ok);
```
