/**
 * MIT License
 *
 * Copyright (c) 2026 Ronan LE MEILLAT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Manages association between chat sessions and API keys
import { loadAiVault } from "./AiVault.js";
import { markKeyAsFailed, resolveNextApiConfig } from "./KeyPool.js";
import { AiVaultConfig, ResolvedApiConfig } from "./types.js";

// Maps session-provider-model combinations to specific API configurations
const sessionKeyMap: Map<string, ResolvedApiConfig> = new Map();
// Simple cache to store the actual API key string for quick access
const sessionKeyCache: Map<string, string> = new Map();

let vaultUrl: string | null = null;

/**
 * Configures the vault URL used for fetching and decrypting configurations.
 */
export function configureSessionKeyManager(url: string): void {
  vaultUrl = url;
}

/**
 * Gets the current API configuration for a session or creates a new one (sticky rotation).
 * Once a key is assigned to a session/provider/model, it remains assigned until forced to rotate.
 */
export async function getSessionApiConfig(
  sessionId: string,
  providerName: string,
  modelId?: string,
): Promise<ResolvedApiConfig | null> {
  const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;

  // Return existing sticky configuration if available
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
  } catch (error) {
    console.error("[KeypoolLive] Failed to load vault:", error);
    return null;
  }

  // Pick the next available key and model from the pool
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
 * Forces a key rotation for the specified session and provider.
 * If the reason is 'key_failure', the current key will be marked as unhealthy.
 */
export async function rotateSessionKey(
  sessionId: string,
  providerName: string,
  modelId?: string,
  reason: "user_request" | "key_failure" = "user_request",
): Promise<ResolvedApiConfig | null> {
  const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;

  // If rotation was triggered by an error, tell the KeyPool to stop using this key
  if (reason === "key_failure") {
    const current = sessionKeyMap.get(sessionKey);
    if (current) {
      markKeyAsFailed(current.providerName, current.apiKey);
    }
  }

  // Clear current mapping to force getSessionApiConfig to pick a new one
  sessionKeyMap.delete(sessionKey);
  sessionKeyCache.delete(`${sessionId}:${providerName}`);

  return getSessionApiConfig(sessionId, providerName, modelId);
}

/**
 * Cleans up all data associated with a specific session.
 * Call this when a chat is deleted or a tab is closed.
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
 * Returns metadata about the key currently assigned to a session.
 */
export function getSessionKeyInfo(sessionId: string): {
  providerName: string;
  keyOwner: string;
  keyHint: string;
  modelId: string;
} | null {
  for (const [compoundKey, config] of sessionKeyMap.entries()) {
    // Return the first matching config for this session
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
 * Retrieves the raw API key for a session synchronously from the cache.
 */
export function getCachedSessionKey(
  sessionId: string,
  providerName: string,
): string | null {
  return sessionKeyCache.get(`${sessionId}:${providerName}`) ?? null;
}
