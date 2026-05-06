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

// Type definitions for KeypoolLive AI vault (ai.json format)
// These types mirror the structure of the ai.json configuration file

/**
 * A single API key entry in the vault.
 */
export interface VaultKey {
  key: string;
  owner: string;
  type: AiKeyTier;
}

/**
 * A single model definition within a provider.
 */
export interface VaultModel {
  id: string;
  usage: "chat" | "embedding";
  contextWindow: number;
  maxOutputTokens: number;
  tpmLimit: number | null;
  priority: number;
  tags: string[];
  defaultDimensions?: number;
}

/**
 * A provider entry in the vault.
 */
export interface VaultProvider {
  protocol: AiProtocol;
  endpoint: string;
  gatewayEndpoint?: string;
  gatewayModelPrefix?: string;
  keys: VaultKey[];
  models: VaultModel[];
}

/**
 * Root structure of the ai.json vault file.
 */
export interface AiVaultConfig {
  version: number;
  providers: Record<string, VaultProvider>;
}

/**
 * A resolved key+model combination, ready to use.
 */
export interface ResolvedApiConfig {
  providerName: string;
  apiKey: string;
  keyOwner: string;
  endpoint: string;
  protocol: AiProtocol;
  modelId: string;
  model: VaultModel;
}

/** Wire protocol used for API calls to this provider. */
export type AiProtocol = "openai" | "anthropic" | "gemini";

export type AiKeyTier = "expired" | "free" | "paid" | "premium" | "unlimited";

export interface AiKey {
  /** The actual API key value. */
  key: string;
  /** Optional owner/manager of this key (e.g. "ronan", "ci-service"). */
  owner?: string;
  /** Service tier. Useful for quota/rate-limit decisions. */
  type?: AiKeyTier;
}

/** Discriminates chat/completion models from embedding models. */
export type AiModelUsage = "chat" | "embedding";

export interface AiModel {
  /** Provider-specific model identifier, e.g. "llama-3.3-70b-versatile". */
  id: string;
  /** Maximum context window in tokens. */
  contextWindow: number;
  /** Maximum tokens the model can generate in one response. */
  maxOutputTokens: number;
  /**
   * Tokens-per-minute hard cap (e.g. Groq free-tier per-request limit).
   * null = no known limit.
   */
  tpmLimit: number | null;
  /**
   * Selection priority. 1 = most preferred; higher numbers are used as fallback.
   * selectModels() returns results sorted ascending by this value.
   */
  priority: number;
  /** Arbitrary labels for filtering, e.g. ["fast", "code", "cheap"]. */
  tags?: string[];
  /**
   * Model usage category.
   * - "chat"      : text completion / generation (POST /chat/completions)
   * - "embedding" : vector embedding (POST /embeddings)
   * Defaults to "chat" when omitted for backward compatibility.
   */
  usage?: AiModelUsage;
  /**
   * For embedding models only: native output vector dimension.
   * Used as the default value for the "dimensions" / "output_dimensionality" parameter.
   */
  defaultDimensions?: number;
}

export interface AiProvider {
  /** Wire protocol for API requests. */
  protocol: AiProtocol;
  /** Base API endpoint, e.g. "https://api.groq.com/openai/v1". Used as fallback. */
  endpoint: string;
  /**
   * Optional: Cloudflare AI Gateway compatible endpoint.
   * When set and CLOUDFLARE_AIG_TOKEN is available, this endpoint is used instead
   * of `endpoint`. Must end with the compat path, e.g.:
   * "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat"
   */
  gatewayEndpoint?: string;
  /**
   * Optional: prefix to prepend to model IDs when routing through the gateway.
   * E.g. "google-ai-studio" for Gemini, "groq" for Groq, "anthropic" for Anthropic.
   * Required when gatewayEndpoint is set.
   */
  gatewayModelPrefix?: string;
  /**
   * Optional API key for the gateway.
   */
  gatewayKey?: string;
  /** All valid API keys for this provider (round-robin via pickKey()). */
  keys: AiKey[];
  /** Available models with their constraints and priority. */
  models: AiModel[];
}

export interface AiConfig {
  /** Schema version — increment when the shape changes. */
  version: number;
  /** Keyed by a human-readable provider name, e.g. "groq", "anthropic". */
  providers: Record<string, AiProvider>;
}
