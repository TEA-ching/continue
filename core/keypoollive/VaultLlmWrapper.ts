// Wrapper that intercepts LLM calls to inject vault-managed keys
import { ILLM } from "../index.js";
import {
  getSessionApiConfig,
  rotateSessionKey,
  getCachedSessionKey,
} from "./SessionKeyManager.js";

/**
 * Wraps an ILLM instance to use vault-managed keys
 */
export function wrapLlmWithVaultKey(llm: ILLM, sessionId: string): ILLM {
  // Only wrap KeypoolLive vault models
  if (!(llm as any)._fufuniVault) {
    return llm;
  }

  const providerName: string = (llm as any)._fufuniProviderName ?? "";

  return new Proxy(llm, {
    get(target, prop, receiver) {
      // Intercept apiKey getter
      if (prop === "apiKey") {
        const cachedKey = getCachedSessionKey(sessionId, providerName);
        return cachedKey ?? Reflect.get(target, prop, receiver);
      }

      const original = Reflect.get(target, prop, receiver);

      // Wrap streamChat method
      if (prop === "streamChat" && typeof original === "function") {
        return async function* wrappedStreamChat(
          this: any,
          ...args: Parameters<typeof original>
        ) {
          const resolved = await getSessionApiConfig(
            sessionId,
            providerName,
            (target as any).model,
          );

          if (resolved) {
            const originalApiKey = (target as any).apiKey;
            (target as any).apiKey = resolved.apiKey;

            try {
              yield* original.apply(target, args);
            } catch (error: any) {
              if (isKeyError(error)) {
                console.warn(`[KeypoolLive] Key failure, rotating...`);
                const newConfig = await rotateSessionKey(
                  sessionId,
                  providerName,
                  (target as any).model,
                  "key_failure",
                );
                if (newConfig) {
                  (target as any).apiKey = newConfig.apiKey;
                  yield* original.apply(target, args);
                  return;
                }
              }
              throw error;
            } finally {
              (target as any).apiKey = originalApiKey;
            }
          } else {
            yield* original.apply(target, args);
          }
        };
      }

      return original;
    },
  });
}

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
