# Velocity Control Plane SDK (TypeScript)

```bash
npm install @velocityai/control-plane-sdk
```

```ts
import { VelocityControlClient } from "@velocityai/control-plane-sdk";

const client = new VelocityControlClient("http://127.0.0.1:4200");
const health = await client.healthz();
console.log(health.ok);
```
