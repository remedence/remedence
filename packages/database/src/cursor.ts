interface CursorEnvelope {
  version: 1;
  kind: string;
  values: Array<string | number>;
}

export function encodeCursor(
  kind: string,
  values: Array<string | number>,
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, kind, values } satisfies CursorEnvelope),
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(
  cursor: string,
  expectedKind: string,
  valueCount: number,
): Array<string | number> {
  if (!cursor || cursor.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new RangeError("cursor is invalid.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new RangeError("cursor is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RangeError("cursor is invalid.");
  }
  const envelope = parsed as Partial<CursorEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.kind !== expectedKind ||
    !Array.isArray(envelope.values) ||
    envelope.values.length !== valueCount ||
    envelope.values.some(
      (value) => typeof value !== "string" && typeof value !== "number",
    )
  ) {
    throw new RangeError("cursor is invalid for this collection.");
  }
  return envelope.values as Array<string | number>;
}
