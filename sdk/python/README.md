# Velocity Control Plane SDK (Python)

```bash
pip install velocity-control-sdk
```

```python
from velocity_control_sdk import VelocityControlClient

client = VelocityControlClient("http://127.0.0.1:4200")
print(client.healthz())
```
