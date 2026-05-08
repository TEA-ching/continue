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

// Wrapper that intercepts LLM calls to inject vault-managed keys
import { ILLM } from "../index.js";
import {
  getCachedSessionKey,
  getSessionApiConfig,
  rotateSessionKey,
} from "./SessionKeyManager.js";

/**
 * Wraps an ILLM instance to use vault-managed keys.
 * Uses a Proxy to intercept calls and inject the correct API key for the current session.
 * Also handles automatic key rotation upon detecting provider errors (auth/rate limits).
 */
export function wrapLlmWithVaultKey(llm: ILLM, sessionId: string): ILLM {
  // Only wrap models that have been flagged as KeypoolLive vault models
  if (!(llm as any)._keypoolVault) {
    return llm;
  }

  const providerName: string = (llm as any)._keypoolProviderName ?? "";
  const vaultModelId: string | undefined = (llm as any)._keypoolModelId;

  return new Proxy(llm, {
    get(target, prop, receiver) {
      // Intercept apiKey access to return the session-specific key if cached
      if (prop === "apiKey") {
        const cachedKey = getCachedSessionKey(sessionId, providerName);
        return cachedKey ?? Reflect.get(target, prop, receiver);
      }

      const original = Reflect.get(target, prop, receiver);

      // Intercept the main chat streaming method to inject keys and handle retries
      if (prop === "streamChat" && typeof original === "function") {
        return async function* wrappedStreamChat(
          this: any,
          ...args: Parameters<typeof original>
        ) {
          const resolvedModelId = vaultModelId ?? (target as any).model;
          // Ensure we have a valid key for this session before starting
          const resolved = await getSessionApiConfig(
            sessionId,
            providerName,
            resolvedModelId,
          );

          if (resolved) {
            const originalApiKey = (target as any).apiKey;
            // Temporarily swap the key for this specific call
            (target as any).apiKey = resolved.apiKey;

            try {
              yield* original.apply(target, args);
            } catch (error: any) {
              // If the call failed due to a key-related error, try rotating and retrying once
              if (isKeyError(error)) {
                console.warn(`[KeypoolLive] Key failure detected, rotating...`);
                const newConfig = await rotateSessionKey(
                  sessionId,
                  providerName,
                  resolvedModelId,
                  "key_failure",
                );
                if (newConfig) {
                  (target as any).apiKey = newConfig.apiKey;
                  // Retry the original call with the new key
                  yield* original.apply(target, args);
                  return;
                }
              }
              // If rotation failed or it's not a key error, rethrow
              throw error;
            } finally {
              // Restore original key state
              (target as any).apiKey = originalApiKey;
            }
          } else {
            // Fallback to original behavior if vault configuration couldn't be resolved
            yield* original.apply(target, args);
          }
        };
      }

      return original;
    },
  });
}

/**
 * Determines if an error is likely caused by a problematic API key.
 * Triggers rotation for 401 (Auth), 403 (Forbidden), 429 (Rate Limit) or quota errors.
 */
function isKeyError(error: any): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  const status = error?.status ?? error?.statusCode ?? 0;

  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    message.includes("api key") ||
    message.includes("invalid_api_key") ||
    message.includes("rate_limit") ||
    message.includes("quota exceeded")
  );
}
