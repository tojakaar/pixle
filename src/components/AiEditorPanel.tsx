import { useState, type FormEvent } from "react";
import { editFromPrompt } from "../aiEditor";
import type { EditParameters, ImageAnalysis } from "../engine";

interface AiEditorPanelProps {
  params: EditParameters;
  imageAnalysis: ImageAnalysis | null;
  disabled: boolean;
  onApply: (params: EditParameters) => void;
}

/**
 * Conversational edit controls. Talks to `editFromPrompt` only — LLM access
 * stays in the Tauri backend so the API key never reaches the webview.
 */
export function AiEditorPanel({
  params,
  imageAnalysis,
  disabled,
  onApply,
}: AiEditorPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "error">("ok");

  const chatReady = Boolean(imageAnalysis) && !disabled;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || !chatReady || busy || !imageAnalysis) return;

    setBusy(true);
    setStatus(null);

    try {
      const result = await editFromPrompt(trimmed, params, imageAnalysis);
      onApply(result.parameters);
      setPrompt("");
      setStatusTone("ok");
      setStatus(result.editSummary?.trim() || "Applied to sliders");
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Could not apply that edit";
      setStatusTone("error");
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-panel" aria-label="AI editing">
      <header className="ai-panel__header">
        <h2 className="ai-panel__title">Ask pixle</h2>
        {status ? (
          <span
            className={
              statusTone === "error"
                ? "ai-panel__status ai-panel__status--error"
                : "ai-panel__status"
            }
            title={status}
          >
            {status}
          </span>
        ) : null}
      </header>

      <form className="ai-panel__form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="ai-panel__input"
          value={prompt}
          disabled={!chatReady || busy}
          placeholder={
            disabled
              ? "Open an image to edit with AI"
              : !imageAnalysis
                ? "Preparing image analysis…"
                : 'Try “cinematic”, “warm sunset”, or “recover the highlights”'
          }
          onChange={(e) => setPrompt(e.currentTarget.value)}
          aria-label="Edit instruction"
        />
        <button
          type="submit"
          className="ai-panel__send"
          disabled={!chatReady || busy || !prompt.trim()}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
