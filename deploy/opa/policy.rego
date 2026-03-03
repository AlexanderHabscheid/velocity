package velocity

# Result contract expected by Velocity OPA hook:
# {
#   "allow": bool,
#   "rateLimitRps": number
# }

default allow = {"allow": false, "rateLimitRps": 1}

allow = {"allow": can_access, "rateLimitRps": tenant_limit} {
  tenant := object.get(data.tenants, input.tenantId, {"enabled": false, "rateLimitRps": 10, "apiKeys": []})
  api_key := object.get(input.headers, "x-velocity-api-key", "")
  not object.get(input.headers, "x-velocity-block", "") == "true"
  can_access := tenant.enabled
  has_valid_key(tenant.apiKeys, api_key)
  tenant_limit := object.get(tenant, "rateLimitRps", 10)
}

has_valid_key(keys, key) {
  some i
  keys[i] == key
}
