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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || disabled || busy || !imageAnalysis) return;

    setBusy(true);
    setStatus(null);

    try {
      const next = await editFromPrompt(trimmed, params, imageAnalysis);
      onApply(next);
      setPrompt("");
      setStatus("Applied to sliders");
    } catch {
      setStatus("Could not apply that edit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-panel" aria-label="AI editing">
      <header className="ai-panel__header">
        <h2 className="ai-panel__title">Ask pixle</h2>
        {status ? <span className="ai-panel__status">{status}</span> : null}
      </header>

      <form className="ai-panel__form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="ai-panel__input"
          value={prompt}
          disabled={disabled || busy}
          placeholder={
            disabled
              ? "Open an image to edit with AI"
              : 'Try “make it brighter” or “recover the highlights”'
          }
          onChange={(e) => setPrompt(e.currentTarget.value)}
          aria-label="Edit instruction"
        />
        <button
          type="submit"
          className="ai-panel__send"
          disabled={disabled || busy || !prompt.trim() || !imageAnalysis}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
