// Message protocol for KeypoolLive vault functionality

/**
 * Message to request key rotation
 */
export interface FufuniRotateKeyRequest {
  sessionId: string;
  providerName?: string;
  modelId?: string;
}

/**
 * Response after key rotation
 */
export interface FufuniRotateKeyResponse {
  success: boolean;
  newKeyInfo?: {
    providerName: string;
    keyOwner: string;
    keyHint: string;
    modelId: string;
  };
  error?: string;
}

/**
 * Message to get current key info
 */
export interface FufuniGetKeyInfoRequest {
  sessionId: string;
}

/**
 * Response with key info
 */
export interface FufuniGetKeyInfoResponse {
  keyInfo: {
    providerName: string;
    keyOwner: string;
    keyHint: string;
    modelId: string;
  } | null;
}
