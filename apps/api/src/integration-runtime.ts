import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type {
  IntegrationConnection,
  IntegrationDelivery,
  IntegrationStore,
  ProtectedIntegrationCredential,
} from "@remedence/database";

export interface IntegrationKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export function parseIntegrationKeyring(value: string): IntegrationKeyring {
  const keys = new Map<number, Buffer>();
  for (const entry of value.split(",")) {
    const [rawVersion, encoded, extra] = entry.split(":");
    const version = Number(rawVersion);
    const key = Buffer.from(encoded ?? "", "base64");
    if (
      extra !== undefined ||
      !Number.isInteger(version) ||
      version < 1 ||
      key.length !== 32
    ) {
      throw new Error(
        "Integration keys must be versioned 32-byte base64 values.",
      );
    }
    if (keys.has(version))
      throw new Error("Integration key versions must be unique.");
    keys.set(version, key);
  }
  const activeVersion = Math.max(...keys.keys());
  if (!Number.isFinite(activeVersion))
    throw new Error("An integration key is required.");
  return { activeVersion, keys };
}

export class IntegrationCredentialProtector {
  constructor(private readonly keyring: IntegrationKeyring) {}

  protect(value: Record<string, string>): ProtectedIntegrationCredential {
    const iv = randomBytes(12);
    const key = this.keyring.keys.get(this.keyring.activeVersion);
    if (!key)
      throw new Error("Active integration encryption key is unavailable.");
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return {
      keyVersion: this.keyring.activeVersion,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  reveal(value: ProtectedIntegrationCredential): Record<string, string> {
    const key = this.keyring.keys.get(value.keyVersion);
    if (!key)
      throw new Error("Integration credential key version is unavailable.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const parsed = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Integration credential plaintext is invalid.");
    }
    return parsed as Record<string, string>;
  }
}

export function verifyInboundSignature(
  body: Buffer,
  supplied: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const normalized = supplied.replace(/^sha256=/, "");
  return (
    /^[0-9a-f]{64}$/.test(normalized) &&
    timingSafeEqual(
      Buffer.from(normalized, "hex"),
      Buffer.from(expected, "hex"),
    )
  );
}

export interface IntegrationDispatchResult {
  succeeded: boolean;
  status: number | null;
  responseDigest: string | null;
  error: string;
}

export class IntegrationDispatcher {
  constructor(
    private readonly credentials: IntegrationCredentialProtector,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async dispatch(
    connection: IntegrationConnection,
    delivery: IntegrationDelivery,
    signal: AbortSignal,
  ): Promise<IntegrationDispatchResult> {
    const credential = this.credentials.reveal(connection.credential);
    const body = JSON.stringify(delivery.payload);
    let url: string;
    let headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "Remedence-Integration-Worker/1",
      "x-remedence-delivery": delivery.id,
      "x-remedence-event": delivery.eventType,
    };
    if (connection.provider === "generic-webhook") {
      url = String(connection.configuration.url ?? "");
      headers["x-remedence-signature"] = `sha256=${createHmac(
        "sha256",
        credential.signing_secret ?? "",
      )
        .update(body)
        .digest("hex")}`;
      if (credential.bearer_token) {
        headers.authorization = `Bearer ${credential.bearer_token}`;
      }
    } else if (connection.provider === "github-issues") {
      const repository = String(connection.configuration.repository ?? "");
      const apiBase = String(
        connection.configuration.api_base ?? "https://api.github.com",
      ).replace(/\/$/, "");
      url = `${apiBase}/repos/${repository}/issues`;
      headers = {
        ...headers,
        accept: "application/vnd.github+json",
        authorization: `Bearer ${credential.token ?? ""}`,
        "x-github-api-version": "2022-11-28",
      };
    } else {
      return {
        succeeded: false,
        status: null,
        responseDigest: null,
        error: "Inbound scanner connections cannot deliver outbound events.",
      };
    }
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers,
        body,
        signal,
        redirect: "error",
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      const responseDigest = createHash("sha256")
        .update(responseBody)
        .digest("hex");
      return {
        succeeded: response.ok,
        status: response.status,
        responseDigest,
        error: response.ok ? "" : `Provider returned HTTP ${response.status}.`,
      };
    } catch (error) {
      return {
        succeeded: false,
        status: null,
        responseDigest: null,
        error:
          error instanceof Error ? error.message : "Provider request failed.",
      };
    }
  }
}

export class IntegrationDeliveryWorker {
  constructor(
    private readonly store: IntegrationStore,
    private readonly dispatcher: IntegrationDispatcher,
    private readonly workerId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async runOnce(): Promise<boolean> {
    const now = this.now();
    const delivery = await this.store.claim(
      this.workerId,
      now,
      new Date(new Date(now).getTime() + 30_000).toISOString(),
    );
    if (!delivery) return false;
    const connection = await this.store.getConnection(
      delivery.organizationId,
      delivery.connectionId,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const result =
      connection?.status === "Active"
        ? await this.dispatcher.dispatch(
            connection,
            delivery,
            controller.signal,
          )
        : {
            succeeded: false,
            status: null,
            responseDigest: null,
            error: "Integration connection is unavailable or disabled.",
          };
    clearTimeout(timer);
    const finishedAt = this.now();
    const retryDelay = Math.min(
      900,
      2 ** Math.max(0, delivery.attempt - 1) * 10,
    );
    await this.store.settle({
      organizationId: delivery.organizationId,
      id: delivery.id,
      workerId: this.workerId,
      succeeded: result.succeeded,
      responseStatus: result.status,
      responseDigest: result.responseDigest,
      error: result.error,
      retryAt: new Date(
        new Date(finishedAt).getTime() + retryDelay * 1000,
      ).toISOString(),
      now: finishedAt,
    });
    return true;
  }
}
