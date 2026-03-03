import { IncomingHttpHeaders } from "node:http";

export interface JwtAuthnOptions {
  required: boolean;
  jwksUrl: string;
  issuer?: string;
  audience?: string;
}

export interface JwtIdentity {
  token: string;
  claims: Record<string, unknown>;
}

const jwksCache = new Map<string, unknown>();

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const auth = headers.authorization;
  if (!auth) {
    return undefined;
  }
  const raw = Array.isArray(auth) ? auth[0] : auth;
  const match = /^Bearer\s+(.+)$/i.exec(raw ?? "");
  return match?.[1];
}

export async function authenticateJwt(
  headers: IncomingHttpHeaders,
  options: JwtAuthnOptions,
): Promise<JwtIdentity | null> {
  const token = bearerToken(headers);
  if (!token) {
    return options.required ? null : { token: "", claims: {} };
  }

  const jose = await import("jose");
  const jwks = jwksCache.get(options.jwksUrl) ?? jose.createRemoteJWKSet(new URL(options.jwksUrl));
  jwksCache.set(options.jwksUrl, jwks);

  const verified = await jose.jwtVerify(token, jwks as Parameters<typeof jose.jwtVerify>[1], {
