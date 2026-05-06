import React, { useState, useCallback, useContext } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

interface VaultKeyRotateButtonProps {
  sessionId: string;
  providerName?: string;
  modelId?: string;
}

export function VaultKeyRotateButton({
  sessionId,
  providerName,
  modelId,
}: VaultKeyRotateButtonProps): React.ReactElement | null {
  const ideMessenger = useContext(IdeMessengerContext);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const handleRotateKey = useCallback(async () => {
    if (!providerName) return;

    setStatus("loading");
    setStatusMessage("Rotating key...");

    try {
      const response = await ideMessenger.request("keypoollive/rotateKey", {
        sessionId,
        providerName,
        modelId,
      });

      if (response.success && response.newKeyInfo) {
        setStatus("success");
        setStatusMessage(
          `Now using key ${response.newKeyInfo.keyHint} (${response.newKeyInfo.keyOwner})`,
        );
        setTimeout(() => {
          setStatus("idle");
          setStatusMessage("");
        }, 3000);
      } else {
        setStatus("error");
        setStatusMessage(response.error ?? "Failed to rotate key");
        setTimeout(() => {
          setStatus("idle");
          setStatusMessage("");
        }, 5000);
      }
    } catch (error: any) {
      setStatus("error");
      setStatusMessage(error.message ?? "Unknown error");
      setTimeout(() => {
        setStatus("idle");
        setStatusMessage("");
      }, 5000);
    }
  }, [ideMessenger, sessionId, providerName, modelId]);

  if (!providerName) {
    return null;
  }

  const statusColor =
    status === "success"
      ? "var(--vscode-terminal-ansiGreen, #4ec9b0)"
      : status === "error"
        ? "var(--vscode-terminal-ansiRed, #f48771)"
        : "var(--vscode-foreground)";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "11px",
        opacity: status === "loading" ? 0.7 : 1,
        cursor: status === "loading" ? "not-allowed" : "pointer",
      }}
      title={
        status === "idle"
          ? `KeypoolLive: Change API key for ${providerName}`
          : statusMessage
      }
    >
      <button
        onClick={handleRotateKey}
        disabled={status === "loading"}
        style={{
          background: "none",
          border: "1px solid var(--vscode-button-border, #555)",
          borderRadius: "3px",
          padding: "2px 6px",
          cursor: status === "loading" ? "not-allowed" : "pointer",
          color: statusColor,
          fontSize: "11px",
          display: "flex",
          alignItems: "center",
          gap: "3px",
        }}
        aria-label="Change KeypoolLive vault API key"
      >
        {status === "loading" && <span>⟳</span>}
        {status === "idle" && <span>🔑</span>}
        {status === "success" && <span>✓</span>}
        {status === "error" && <span>✗</span>}
        <span>
          {status === "idle" && "Chg. Key"}
          {status === "loading" && "..."}
          {status === "success" && "Done"}
          {status === "error" && "Error"}
        </span>
      </button>

      {statusMessage && status !== "idle" && (
        <span
          style={{
            fontSize: "10px",
            color: statusColor,
            maxWidth: "150px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {statusMessage}
        </span>
      )}
    </div>
  );
}
