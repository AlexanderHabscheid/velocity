const admin = process.env.TOXIPROXY_ADMIN_URL ?? 'http://127.0.0.1:8474';

async function api(path, init) {
  const res = await fetch(`${admin}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`toxiproxy API ${path} failed: ${res.status}`);
  }
  if (res.status === 204) {
    return null;
  }
  return await res.json();
}

async function main() {
  const proxyName = 'velocity-smoke';
  try {
    await api(`/proxies/${proxyName}`, { method: 'DELETE' });
  } catch {
    // no-op
  }

  await api('/proxies', {
    method: 'POST',
    body: JSON.stringify({
      name: proxyName,
      listen: '127.0.0.1:8666',
      upstream: '127.0.0.1:8667',
    }),
  });

  await api(`/proxies/${proxyName}/toxics`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'latency_downstream',
      type: 'latency',
      stream: 'downstream',
      attributes: { latency: 120, jitter: 20 },
    }),
  });

  const toxics = await api(`/proxies/${proxyName}`);
  if (!toxics || !Array.isArray(toxics?.toxics) || toxics.toxics.length === 0) {
    throw new Error('expected toxics to be configured');
  }

  console.log('toxiproxy smoke passed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
