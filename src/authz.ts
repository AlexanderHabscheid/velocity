import { Logger } from "./logger";

export interface OpenFgaAuthzOptions {
  endpoint: string;
  storeId: string;
  modelId?: string;
  relation: string;
  objectPrefix: string;
  userClaim: string;
  failOpen: boolean;
  token?: string;
  timeoutMs: number;
}

interface EvaluateAuthzParams {
  options: OpenFgaAuthzOptions;
  tenantId: string;
  claims: Record<string, unknown>;
  logger: Logger;
}

export async function evaluateOpenFgaAccess(params: EvaluateAuthzParams): Promise<boolean> {
  const { options, tenantId, claims, logger } = params;
  const userClaimValue = claims[options.userClaim];
  const userValue = typeof userClaimValue === "string" && userClaimValue ? userClaimValue : "";
  if (!userValue) {
    return options.failOpen;
  }

  const user = userValue.startsWith("user:") ? userValue : `user:${userValue}`;
  const object = `${options.objectPrefix}${tenantId}`;
  const url = `${options.endpoint.replace(/\/+$/, "")}/stores/${encodeURIComponent(options.storeId)}/check`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(50, options.timeoutMs));
  timeout.unref();

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
