/**
 * Race-tracing logs for the image-open pipeline.
 * Enable with `localStorage.setItem("pixle.openLog", "1")` then reload.
 * Also enabled when `pixle.perf` is on.
 */
export function openLogEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return (
      localStorage.getItem("pixle.openLog") === "1" ||
      localStorage.getItem("pixle.perf") === "1"
    );
  } catch {
    return false;
  }
}

export function openLog(
  requestId: number,
  message: string,
  detail?: unknown,
): void {
  if (!openLogEnabled()) return;
  const prefix = `[pixle.open #${requestId}]`;
  if (detail !== undefined) {
    console.log(prefix, message, detail);
  } else {
    console.log(prefix, message);
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "AbortError") return true;
  const message = String((error as { message?: string }).message ?? "");
  return /aborted|abort/i.test(message);
}
