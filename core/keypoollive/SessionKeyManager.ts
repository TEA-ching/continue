// Manages association between chat sessions and API keys
import { AiVaultConfig, ResolvedApiConfig } from "./types.js";
import { loadAiVault } from "./AiVault.js";
import { markKeyAsFailed, resolveNextApiConfig } from "./KeyPool.js";

const sessionKeyMap: Map<string, ResolvedApiConfig> = new Map();
const sessionKeyCache: Map<string, string> = new Map();

let vaultUrl: string | null = null;

/**
 * Configures the vault URL
 */
export function configureSessionKeyManager(url: string): void {
  vaultUrl = url;
}

/**
 * Gets or creates API config for session
 */
export async function getSessionApiConfig(
  sessionId: string,
  providerName: string,
  modelId?: string,
): Promise<ResolvedApiConfig | null> {
  const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;

  const existing = sessionKeyMap.get(sessionKey);
  if (existing) {
    return existing;
  }

  if (!vaultUrl) {
    return null;
  }

  let vault: AiVaultConfig;
  try {
    vault = await loadAiVault(vaultUrl);
  } catch {
    return null;
  }

  const resolved = resolveNextApiConfig(vault, providerName, modelId);
  if (resolved) {
    sessionKeyMap.set(sessionKey, resolved);
    sessionKeyCache.set(`${sessionId}:${providerName}`, resolved.apiKey);
    console.info(
      `[KeypoolLive] Session ${sessionId.slice(-8)}... assigned key ...${resolved.apiKey.slice(-6)}`,
    );
  }

  return resolved ?? null;
}

/**
 * Forces key rotation for session
 */
export async function rotateSessionKey(
  sessionId: string,
  providerName: string,
  modelId?: string,
  reason: "user_request" | "key_failure" = "user_request",
): Promise<ResolvedApiConfig | null> {
  const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;

  if (reason === "key_failure") {
    const current = sessionKeyMap.get(sessionKey);
    if (current) {
      markKeyAsFailed(current.providerName, current.apiKey);
    }
  }

  sessionKeyMap.delete(sessionKey);
  sessionKeyCache.delete(`${sessionId}:${providerName}`);

  return getSessionApiConfig(sessionId, providerName, modelId);
}

/**
 * Cleans up session data
 */
export function cleanupSession(sessionId: string): void {
  for (const key of sessionKeyMap.keys()) {
    if (key.startsWith(sessionId)) {
      sessionKeyMap.delete(key);
    }
  }
  for (const key of sessionKeyCache.keys()) {
    if (key.startsWith(sessionId)) {
      sessionKeyCache.delete(key);
    }
  }
}

/**
 * Gets session key info
 */
export function getSessionKeyInfo(sessionId: string): {
  providerName: string;
  keyOwner: string;
  keyHint: string;
  modelId: string;
} | null {
  for (const [compoundKey, config] of sessionKeyMap.entries()) {
    if (compoundKey.startsWith(sessionId)) {
      return {
        providerName: config.providerName,
        keyOwner: config.keyOwner,
        keyHint: `...${config.apiKey.slice(-6)}`,
        modelId: config.modelId,
      };
    }
  }
  return null;
}

/**
 * Gets cached key (synchronous)
 */
export function getCachedSessionKey(
  sessionId: string,
  providerName: string,
): string | null {
  return sessionKeyCache.get(`${sessionId}:${providerName}`) ?? null;
}
