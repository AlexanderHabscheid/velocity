# Velocity Control Plane SDK (TypeScript)

```bash
npm install @velocityai/velocity
```

```ts
import { VelocityControlClient } from "@velocityai/velocity/control-plane-sdk";

const client = new VelocityControlClient("http://127.0.0.1:4200");
const health = await client.healthz();
console.log(health.ok);
```
