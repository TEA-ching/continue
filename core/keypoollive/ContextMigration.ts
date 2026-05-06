// Utilities for migrating conversation context during key rotation
import { ChatMessage } from "../index.js";

/**
 * Creates a system-level notification for key rotation
 */
export function createKeyRotationNotice(
  previousKeyHint: string,
  newKeyHint: string,
  providerName: string,
  reason: "user_request" | "key_failure",
): ChatMessage {
  const reasonText =
    reason === "user_request"
      ? "at your request"
      : "due to a key error (automatic fallback)";

  return {
    role: "system",
    content:
      `[KeypoolLive] API key rotated ${reasonText}. ` +
      `Provider: ${providerName}. ` +
      `Previous: ...${previousKeyHint} → New: ...${newKeyHint}. ` +
      `Context preserved.`,
  } as any;
}

/**
 * Sanitizes messages for provider compatibility
 */
export function sanitizeMessagesForProvider(
  messages: ChatMessage[],
  targetProtocol: "anthropic" | "gemini" | "openai",
): ChatMessage[] {
  let filtered = messages.filter((msg) => {
    if (msg.role === "system") {
      const content = Array.isArray(msg.content)
        ? msg.content.map((c: any) => c.text ?? "").join("")
        : msg.content;
      return !String(content).startsWith("[KeypoolLive");
    }
    return true;
  });

  if (targetProtocol === "gemini") {
    filtered = mergeConsecutiveMessages(filtered);
  }

  return filtered;
}

/**
 * Merges consecutive messages of same role
 */
function mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      const lastText = Array.isArray(last.content)
        ? last.content.map((c: any) => c.text ?? "").join("\n")
        : String(last.content);
      const newText = Array.isArray(message.content)
        ? message.content.map((c: any) => c.text ?? "").join("\n")
        : String(message.content);
      merged[merged.length - 1] = {
        ...last,
        content: `${lastText}\n\n${newText}`,
      };
    } else {
      merged.push(message);
    }
  }

  return merged;
}
