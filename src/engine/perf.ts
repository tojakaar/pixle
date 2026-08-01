/**
 * Development-only timing helpers.
 * Enable with `localStorage.setItem("pixle.perf", "1")` then reload.
 */
export function perfEnabled(): boolean {
  try {
    return (
      import.meta.env.DEV &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem("pixle.perf") === "1"
    );
  } catch {
    return false;
  }
}

export function perfTime(label: string): () => void {
  if (!perfEnabled()) return () => undefined;
  const start = performance.now();
  return () => {
    const ms = performance.now() - start;
    console.log(`[pixle.perf] ${label}: ${ms.toFixed(1)}ms`);
  };
}

export function perfLog(message: string, detail?: unknown): void {
  if (!perfEnabled()) return;
  if (detail !== undefined) {
    console.log(`[pixle.perf] ${message}`, detail);
  } else {
    console.log(`[pixle.perf] ${message}`);
  }
}
