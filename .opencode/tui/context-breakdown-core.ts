function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tokenCountFromText(value: unknown): number {
  return Math.round(String(value ?? "").length / 4);
}

function estimatedTokensFromUnknown(value: unknown): number {
  if (typeof value === "string") {
    return tokenCountFromText(value);
  }
  if (value === undefined || value === null) {
    return 0;
  }
  return tokenCountFromText(JSON.stringify(value));
}

function sumNumbers(values: readonly unknown[]): number {
  return values.reduce<number>((sum, value) => sum + (finiteNumber(value) ?? 0), 0);
}

function messageInfo(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== "object") {
    return {};
  }
  const candidate = "info" in message ? message.info : message;
  return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
}

function messageParts(message: unknown): readonly unknown[] {
  if (!message || typeof message !== "object" || !("parts" in message)) {
    return [];
  }
  return Array.isArray(message.parts) ? message.parts.filter(Boolean) : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function tokenFields(info: Record<string, unknown>) {
  const tokens = objectRecord(info.tokens ?? info.usage ?? info.token);
  if (Object.keys(tokens).length === 0) {
    return null;
  }

  const cache = objectRecord(tokens.cache);
  const input = finiteNumber(tokens.input ?? tokens.inputTokens ?? tokens.prompt);
  const output = finiteNumber(tokens.output ?? tokens.outputTokens ?? tokens.completion);
  const reasoning = finiteNumber(tokens.reasoning ?? tokens.reasoningTokens);
  const cacheRead = finiteNumber(tokens.cacheRead ?? tokens.cachedInput ?? cache.read);
  const cacheWrite = finiteNumber(tokens.cacheWrite ?? cache.write);
  const total =
    finiteNumber(tokens.total ?? tokens.totalTokens) ??
    sumNumbers([input, output, reasoning, cacheRead, cacheWrite]);

  if (
    [input, output, reasoning, cacheRead, cacheWrite, total].every(
      (value) => value === undefined || value === 0,
    )
  ) {
    return null;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning: reasoning ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    total,
  };
}

function partEstimate(part: unknown): {
  bucket: "text" | "reasoning" | "tool" | "file" | "message";
  tokens: number;
} {
  if (!part || typeof part !== "object") {
    return { bucket: "message", tokens: 0 };
  }

  const record = part as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "reasoning") {
    return { bucket: "reasoning", tokens: tokenCountFromText(record.text) };
  }

  if (type === "text" || typeof record.text === "string") {
    return { bucket: "text", tokens: tokenCountFromText(record.text) };
  }

  if (type === "tool" || type.startsWith("tool-")) {
    const state = objectRecord(record.state);
    return {
      bucket: "tool",
      tokens: sumNumbers([
        tokenCountFromText(record.tool ?? type ?? "tool"),
        estimatedTokensFromUnknown(state.raw),
        estimatedTokensFromUnknown(state.input ?? record.input),
        estimatedTokensFromUnknown(
          state.output ?? record.output ?? state.error ?? record.errorText,
        ),
      ]),
    };
  }

  if (type === "file") {
    const sourceText = objectRecord(record.source).text;
    const source = typeof sourceText === "string" ? sourceText : objectRecord(sourceText).value;
    return {
      bucket: "file",
      tokens: sumNumbers([
        tokenCountFromText(record.filename ?? record.url ?? "file"),
        tokenCountFromText(source),
      ]),
    };
  }

  return {
    bucket: "message",
    tokens: estimatedTokensFromUnknown(part),
  };
}

export function buildContextBreakdown(messages: unknown) {
  const list = Array.isArray(messages) ? messages : [];
  const exact = {
    assistantMessages: 0,
    withTokenFields: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  const estimates = {
    text: 0,
    reasoning: 0,
    tool: 0,
    file: 0,
    message: 0,
  };

  for (const message of list) {
    const info = messageInfo(message);
    if (info.role === "assistant") {
      exact.assistantMessages += 1;
      const tokens = tokenFields(info);
      if (tokens) {
        exact.withTokenFields += 1;
        exact.input = tokens.input;
        exact.output = tokens.output;
        exact.reasoning = tokens.reasoning;
        exact.cacheRead = tokens.cacheRead;
        exact.cacheWrite = tokens.cacheWrite;
        exact.total = tokens.total;
      }
    }

    for (const part of messageParts(message)) {
      const estimate = partEstimate(part);
      estimates[estimate.bucket] += estimate.tokens;
    }
  }

  const estimatedVisibleTotal = sumNumbers([
    estimates.text,
    estimates.reasoning,
    estimates.tool,
    estimates.file,
    estimates.message,
  ]);
  const unknown = Math.max(0, exact.total - estimatedVisibleTotal);

  return {
    messageCount: list.length,
    exact,
    estimates,
    estimatedVisibleTotal,
    unknown,
    hasExactTokens: exact.withTokenFields > 0,
  };
}

export function normalizeMessages(response: unknown): readonly unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  const record = objectRecord(response);
  if (Array.isArray(record.items)) {
    return record.items;
  }
  if (Array.isArray(record.data)) {
    return record.data;
  }
  return [];
}
