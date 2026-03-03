# Velocity Kubernetes Deploy

These manifests are image-based and do not require hostPath source mounts.

## 1. Use published image (recommended)

The repo publishes `ghcr.io/ahabscheid/velocity:0.1.0` and `latest` via GitHub Actions.

If that image is acceptable for your environment, skip directly to apply.

## 2. Optional: build and push your own pinned image

```bash
docker build -t <registry>/velocity:0.1.0 .
docker push <registry>/velocity:0.1.0
```

## 3. Set the image tag in manifests

Update `image:` in:
- `deploy/k8s/control-plane.yaml`
- `deploy/k8s/velocity-proxy.yaml`

Use the same pinned tag in both manifests. Prefer immutable digests for production.

## 4. Apply resources

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/network-policy.yaml
kubectl apply -f deploy/k8s/nats.yaml
kubectl apply -f deploy/k8s/valkey.yaml
kubectl apply -f deploy/k8s/opa.yaml
kubectl apply -f deploy/k8s/otel-collector.yaml
kubectl apply -f deploy/k8s/control-plane.yaml
kubectl apply -f deploy/k8s/velocity-proxy.yaml
kubectl apply -f deploy/k8s/pdb.yaml
```

## 5. Verify

```bash
kubectl -n velocity get pods
kubectl -n velocity get svc
```

## Deployment tiers

- `single-node`: run CLI binaries only (`velocity proxy` + `velocity control-plane`).
- `ha-cluster`: use all manifests in this folder with HPA-enabled proxy plus Valkey/NATS-backed distributed state/events.
- `enterprise-edge`: front this deployment with Envoy (`deploy/envoy/envoy.yaml`) and enforce JWT/OPA/OpenFGA controls.

## CLI path

```bash
velocity doctor
# apply manifests directly after choosing your image tag
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/network-policy.yaml
kubectl apply -f deploy/k8s/nats.yaml
kubectl apply -f deploy/k8s/valkey.yaml
kubectl apply -f deploy/k8s/opa.yaml
kubectl apply -f deploy/k8s/otel-collector.yaml
kubectl apply -f deploy/k8s/control-plane.yaml
kubectl apply -f deploy/k8s/velocity-proxy.yaml
kubectl apply -f deploy/k8s/pdb.yaml
```
