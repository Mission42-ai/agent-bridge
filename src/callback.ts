import type { CallbackPayload } from "./types.js";

export async function sendCallback(
  url: string,
  payload: CallbackPayload,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      console.log(`[Callback] POST to ${url} succeeded (${response.status})`);
    } else {
      const body = await response.text().catch(() => "");
      console.error(
        `[Callback] POST to ${url} returned ${response.status}: ${body.slice(0, 500)}`,
      );
    }
  } catch (err) {
    console.error(
      `[Callback] POST to ${url} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
