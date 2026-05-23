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

// Injects vault-sourced models into Continue configuration
import { ContinueConfig, ILLM, ILLMLogger } from "../index.js";
import { loadAiVault } from "./AiVault.js";
import { buildModelDescriptions } from "./KeyPool.js";
import { KeypoolUsageDb } from "./KeypoolUsageDb.js";
import {
  configureSessionKeyManager,
  getSessionApiConfig,
} from "./SessionKeyManager.js";
import { AiVaultConfig, KeypoolLiveConfig } from "./types.js";

function maskKeyForDisplay(apiKey: string): string {
  if (!apiKey || apiKey.length <= 12) return apiKey;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-6)}`;
}

function extractErrorCode(error: any): number | null {
  for (const v of [error?.status, error?.statusCode, error?.response?.status]) {
    if (typeof v === "number" && v > 0) return v;
  }
  if (typeof error?.message === "string") {
    const m = /\b([45]\d{2})\b/.exec(error.message);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function messagesToText(messages: any[]): string {
  return messages
    .map((m: any) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content))
        return m.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("");
      return "";
    })
    .join("\n");
}

function chunkText(chunk: any): string {
  if (chunk.role !== "assistant") return "";
  if (typeof chunk.content === "string") return chunk.content;
  if (Array.isArray(chunk.content))
    return chunk.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
  return "";
}

let vaultUrl: string | null = null;
let cachedVaultLlms: ILLM[] | null = null;
let currentKplConfig: KeypoolLiveConfig | null = null;
const KEYPOOLLIVE_GLOBAL_SESSION_ID = "global";

/**
 * Constructs the full request URL based on the provider, model, and operation type.
 * Handles protocol-specific paths (Anthropic, Gemini, OpenAI-compatible).
 */
function getVaultRequestUrl(
  apiBase: string | undefined,
  provider: string,
  model: string,
  operation: "chat" | "complete" | "fim",
): string {
  const base = apiBase?.trim() || "(unknown apiBase)";
  if (base === "(unknown apiBase)") {
    return base;
  }

  let path: string;
  if (operation === "fim") {
    path = "fim/completions";
  } else if (operation === "complete") {
    path = "completions";
  } else if (provider === "anthropic") {
    path = "messages";
  } else if (provider === "gemini") {
    path = `models/${encodeURIComponent(model)}:streamGenerateContent`;
  } else {
    // Default to OpenAI-compatible chat completions
    path = "chat/completions";
  }
  try {
    return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return `${base.replace(/\/$/, "")}/${path}`;
  }
}
/**
 * Returns standard headers for LLM API requests, including the bearer token.
 */
function getRequestHeaders(llm: ILLM, apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    ...((llm as any).requestOptions?.headers ?? {}),
  };
}

/**
 * Intercepts LLM calls to inject session-specific keys and metadata.
 * Returns enriched options that can be used for logging or custom routing.
 */
async function prepareVaultRequest(
  llm: ILLM,
  providerName: string,
  modelId: string,
  operation: "chat" | "complete" | "fim",
  options: any,
  input: unknown,
): Promise<any> {
  // Resolve the current key for the global session
  const config = await getSessionApiConfig(
    KEYPOOLLIVE_GLOBAL_SESSION_ID,
    providerName,
    modelId,
  );
  const activeApiKey = config?.apiKey ?? (llm as any).apiKey ?? "";

  if (config) {
    (llm as any).apiKey = config.apiKey;

    // OpenAI-compatible adapters capture apiKey in their constructor, so rebuild
    // after rotation to make the next request use the active vault key.
    if (typeof (llm as any).createOpenAiAdapter === "function") {
      (llm as any).openaiAdapter = (llm as any).createOpenAiAdapter();
    }
  }

  const url = getVaultRequestUrl(
    (llm as any).apiBase,
    (llm as any).providerName,
    (llm as any).model,
    operation,
  );

  // Detect if we are routing through Cloudflare AI Gateway
  const routingMode =
    (llm as any).requestOptions?.headers?.["cf-aig-authorization"] !== undefined
      ? "cloudflare-ai-gateway"
      : "direct";

  const headers = getRequestHeaders(llm, activeApiKey);

  // Prepare metadata about the request for debugging/logging
  const keypoolLiveRequest = {
    method: "POST",
    url,
    routingMode,
    providerName,
    modelId,
    continueProvider: (llm as any).providerName,
    continueModel: (llm as any).model,
    apiKey: activeApiKey,
    keyOwner: config?.keyOwner ?? "unknown",
    headers,
    input,
  };

  console.log("[KeypoolLive] request", keypoolLiveRequest);

  return {
    ...(options ?? {}),
    keypoolLiveRequest,
  };
}

/**
 * Sets the vault URL and optional KeypoolLive gateway config.
 * Invalidates model cache when config changes.
 */
export function setVaultUrl(url: string, kplConfig?: KeypoolLiveConfig): void {
  const prevConfig = JSON.stringify(currentKplConfig);
  currentKplConfig = kplConfig ?? null;
  vaultUrl = url;
  configureSessionKeyManager(url);
  // Reset cache if configuration parameters changed
  if (JSON.stringify(currentKplConfig) !== prevConfig) {
    cachedVaultLlms = null;
  }
}

/**
 * Builds ILLM instances from vault configuration by wrapping standard models.
 * This dynamically creates the model list that appears in the Continue UI.
 */
async function buildLlmsFromVault(
  vault: AiVaultConfig,
  ideSettings: any,
  llmLogger: ILLMLogger,
): Promise<ILLM[]> {
  const descriptions = buildModelDescriptions(
    vault,
    currentKplConfig ?? undefined,
  );
  const llms: ILLM[] = [];

  // Dynamically import llmFromDescription to avoid circular dependencies
  const { llmFromDescription } = await import("../llm/llms/index.js");

  for (const desc of descriptions) {
    try {
      // Instantiate the base LLM (e.g., Anthropic, Gemini) from description
      const llmOrPromise = (llmFromDescription as any)(
        desc as any,
        undefined,
        ideSettings,
        undefined,
        undefined,
        llmLogger,
      );
      const llm = await Promise.resolve(llmOrPromise);
      if (llm) {
        // Tag the LLM instance as being vault-managed
        (llm as any)._keypoolVault = true;
        (llm as any)._keypoolProviderName = desc.vaultProviderName;
        (llm as any)._keypoolModelId = desc.vaultModelId;

        const providerName = desc.vaultProviderName;
        const modelId = desc.vaultModelId;

        // Save original methods for later call
        const originalStreamChat = llm.streamChat.bind(llm);
        const originalStreamComplete = llm.streamComplete.bind(llm);
        const originalComplete = llm.complete.bind(llm);
        const originalStreamFim = llm.streamFim.bind(llm);

        // Override chat method to inject vault metadata before execution
        (llm as any).streamChat = async function* (
          messages: any,
          signal: AbortSignal,
          options?: any,
          messageOptions?: any,
        ) {
          const enrichedOptions = await prepareVaultRequest(
            llm,
            providerName,
            modelId,
            "chat",
            options,
            { messages },
          );
          const kplReq = enrichedOptions.keypoolLiveRequest;
          const completionParts: string[] = [];
          let apiUsage: any = undefined;
          try {
            for await (const chunk of originalStreamChat(
              messages,
              signal,
              enrichedOptions,
              messageOptions,
            )) {
              completionParts.push(chunkText(chunk));
              if ((chunk as any).usage) apiUsage = (chunk as any).usage;
              yield chunk;
            }
            const promptTokens =
              apiUsage?.promptTokens ??
              (llm as any).countTokens?.(messagesToText(messages)) ??
              0;
            const completionTokens =
              apiUsage?.completionTokens ??
              (llm as any).countTokens?.(completionParts.join("")) ??
              0;
            void KeypoolUsageDb.logUsage({
              provider: kplReq.providerName,
              modelId: kplReq.modelId,
              keyOwner: kplReq.keyOwner,
              keyHint: maskKeyForDisplay(kplReq.apiKey),
              promptTokens,
              completionTokens,
            });
          } catch (error: any) {
            void KeypoolUsageDb.logError({
              provider: kplReq.providerName,
              modelId: kplReq.modelId,
              keyOwner: kplReq.keyOwner,
              keyHint: maskKeyForDisplay(kplReq.apiKey),
              errorCode: extractErrorCode(error),
            });
            throw error;
          }
        };

        // Override complete methods similarly
        (llm as any).streamComplete = async function* (
          prompt: string,
          signal: AbortSignal,
          options?: any,
        ) {
          const enrichedOptions = await prepareVaultRequest(
            llm,
            providerName,
            modelId,
            "complete",
            options,
            { prompt },
          );
          const kplReq = enrichedOptions.keypoolLiveRequest;
          const completionParts: string[] = [];
          let apiUsage: any = undefined;
          try {
            for await (const chunk of originalStreamComplete(
              prompt,
              signal,
              enrichedOptions,
            )) {
              if (typeof chunk === "string") completionParts.push(chunk);
              if ((chunk as any).usage) apiUsage = (chunk as any).usage;
              yield chunk;
            }
            const promptTokens =
              apiUsage?.promptTokens ?? (llm as any).countTokens?.(prompt) ?? 0;
            const completionTokens =
              apiUsage?.completionTokens ??
              (llm as any).countTokens?.(completionParts.join("")) ??
              0;
            void KeypoolUsageDb.logUsage({
              provider: kplReq.providerName,
              modelId: kplReq.modelId,
              keyOwner: kplReq.keyOwner,
              keyHint: maskKeyForDisplay(kplReq.apiKey),
              promptTokens,
              completionTokens,
            });
          } catch (error: any) {
            void KeypoolUsageDb.logError({
              provider: kplReq.providerName,
              modelId: kplReq.modelId,
              keyOwner: kplReq.keyOwner,
              keyHint: maskKeyForDisplay(kplReq.apiKey),
              errorCode: extractErrorCode(error),
            });
            throw error;
          }
        };

        (llm as any).complete = async function (
          prompt: string,
          signal: AbortSignal,
          options?: any,
        ) {
          const enrichedOptions = await prepareVaultRequest(
            llm,
            providerName,
            modelId,
            "complete",
            options,
            { prompt },
          );
          return originalComplete(prompt, signal, enrichedOptions);
        };

        // Override FIM (Fill-In-the-Middle) method
        (llm as any).streamFim = async function* (
          prefix: string,
          suffix: string,
          signal: AbortSignal,
          options?: any,
        ) {
          const enrichedOptions = await prepareVaultRequest(
            llm,
            providerName,
            modelId,
            "fim",
            options,
            { prefix, suffix },
          );
          const kplReq = enrichedOptions.keypoolLiveRequest;
          const completionParts: string[] = [];
          try {
            for await (const chunk of originalStreamFim(
              prefix,
              suffix,
              signal,
              enrichedOptions,
            )) {
              if (typeof chunk === "string") completionParts.push(chunk);
              yield chunk;
            }
            void KeypoolUsageDb.logUsage({
              provider: kplReq.providerName,
              modelId: kplReq.modelId,
              keyOwner: kplReq.keyOwner,
              keyHint: maskKeyForDisplay(kplReq.apiKey),
              promptTokens: (llm as any).countTokens?.(prefix + suffix) ?? 0,
              completionTokens:
                (llm as any).countTokens?.(completionParts.join("")) ?? 0,
            });
          } catch (error: any) {
            void KeypoolUsageDb.logError({
              provider: kplReq.providerName,
              modelId: kplReq.modelId,
              keyOwner: kplReq.keyOwner,
              keyHint: maskKeyForDisplay(kplReq.apiKey),
              errorCode: extractErrorCode(error),
            });
            throw error;
          }
        };

        llms.push(llm);
      }
    } catch (error) {
      console.warn(
        `[KeypoolLive] Failed to create LLM for ${desc.title}:`,
        error,
      );
    }
  }

  return llms;
}

/**
 * Injects vault-sourced models into the main ContinueConfig.
 * This is the entry point for the KeypoolLive integration in config.ts.
 */
export async function injectVaultModels(
  config: ContinueConfig,
  ideSettings: any,
  llmLogger: ILLMLogger,
): Promise<ContinueConfig> {
  // Only proceed if a vault URL is configured
  if (!vaultUrl) {
    return config;
  }

  // Decryption secret is required
  if (!process.env.KEYPOOL_LIVE_SECRET) {
    console.warn(
      "[KeypoolLive] KEYPOOL_LIVE_SECRET not set - vault models will not be available",
    );
    return config;
  }

  let vault: AiVaultConfig;
  try {
    // Load and decrypt the remote vault
    vault = await loadAiVault(vaultUrl);
    console.log(
      `[KeypoolLive] Loaded vault config version ${vault.version} with ${Object.keys(vault.providers).length} providers`,
    );
  } catch (error) {
    console.error("[KeypoolLive] Failed to load vault:", error);
    return config;
  }

  // Create ILLM instances for all models defined in the vault
  const vaultLlms = await buildLlmsFromVault(vault, ideSettings, llmLogger);

  if (vaultLlms.length === 0) {
    console.log("[KeypoolLive] No vault models created, skipping injection");
    return config;
  }

  // Create a copy of the config and add vault models to the relevant roles
  const augmentedConfig = { ...config } as any;
  augmentedConfig.modelsByRole = augmentedConfig.modelsByRole || {};
  augmentedConfig.modelsByRole.chat = [
    ...(augmentedConfig.modelsByRole.chat ?? []),
    ...vaultLlms,
  ];
  augmentedConfig.modelsByRole.edit = [
    ...(augmentedConfig.modelsByRole.edit ?? []),
    ...vaultLlms,
  ];
  augmentedConfig.modelsByRole.apply = [
    ...(augmentedConfig.modelsByRole.apply ?? []),
    ...vaultLlms,
  ];

  console.log(
    `[KeypoolLive] Injected ${vaultLlms.length} vault models into augmentedConfig`,
  );
  return augmentedConfig as ContinueConfig;
}
