# Envoy Front Proxy

`envoy.yaml` provides a reference WebSocket-capable Envoy edge with JWT authentication.

Key goals:
- Terminate external traffic at Envoy
- Enforce JWT before traffic reaches Velocity
- Preserve WebSocket upgrades

Customize cluster addresses, issuer/audience, and JWKS URL for your environment.
