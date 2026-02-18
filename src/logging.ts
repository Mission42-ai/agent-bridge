// ---------------------------------------------------------------------------
// Lightweight event logging — human-readable single lines
// Logs: assistant inner dialogue, tool errors, ExitPlanMode, result
// ---------------------------------------------------------------------------

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatEvent(msg: Record<string, any>): string | null {
  // ── Result ──
  if (msg.type === "result") {
    const cost = `$${(msg.total_cost_usd ?? 0).toFixed(4)}`;
    const turns = `${msg.num_turns ?? 0} turns`;
    const inp = formatTokens(msg.usage?.input_tokens ?? 0);
    const out = formatTokens(msg.usage?.output_tokens ?? 0);
    const result = msg.structured_output
      ? JSON.stringify(msg.structured_output).slice(0, 300)
      : typeof msg.result === "string" ? msg.result.slice(0, 300) : "";
    return `[Result] ${msg.subtype ?? "done"} | ${cost} | ${turns} | ${inp} in / ${out} out${result ? `\n         ${result}` : ""}`;
  }

  if (!msg.message) return null;
  const content = msg.message.content;
  if (!Array.isArray(content)) return null;

  // ── Assistant inner dialogue ──
  if (msg.message.role === "assistant") {
    const texts = content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === "text" && b.text)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => (b.text as string).trim())
      .filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exitPlan = content.find((b: any) => b.type === "tool_use" && b.name === "ExitPlanMode");

    const lines: string[] = [];
    if (texts.length > 0) {
      lines.push(`[Agent] ${texts.join(" ").slice(0, 300)}`);
    }
    if (exitPlan) {
      lines.push("[Plan] ExitPlanMode");
    }
    return lines.length > 0 ? lines.join("\n") : null;
  }

  // ── Tool errors ──
  if (msg.message.role === "tool") {
    const errors = content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === "tool_result" && b.is_error)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => {
        const text = typeof b.content === "string"
          ? b.content
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : "";
        return text.slice(0, 200);
      });
    if (errors.length === 0) return null;
    return errors.map((e) => `[Tool Error] ${e}`).join("\n");
  }

  return null;
}
