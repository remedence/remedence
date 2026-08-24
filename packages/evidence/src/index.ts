import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

export interface EvidenceHashInput {
  kind: string;
  label: string;
  sourceReference: string;
  metadata: Record<string, unknown>;
}

export interface ArtifactScanReceipt {
  status: "Clean" | "Infected";
  scanner: string;
  scannedAt: string;
  detail: string;
}

export interface MalwareScanner {
  scan(bytes: Uint8Array, now: string): Promise<ArtifactScanReceipt>;
}

export interface StoredEvidenceObject {
  key: string;
  contentHash: string;
  size: number;
}

export interface EvidenceObjectStore {
  put(organizationId: string, bytes: Uint8Array): Promise<StoredEvidenceObject>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value === null || typeof value !== "object") return value;
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashEvidenceMetadata(input: EvidenceHashInput): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        kind: input.kind,
        label: input.label,
        source_reference: input.sourceReference,
        metadata: input.metadata,
      }),
      "utf8",
    )
    .digest("hex");
}

export function signEvidenceManifest(
  manifest: Record<string, unknown>,
  signingKey: string,
): { manifestHash: string; signature: string } {
  const body = canonicalJson(manifest);
  return {
    manifestHash: createHash("sha256").update(body, "utf8").digest("hex"),
    signature: createHmac("sha256", signingKey)
      .update(body, "utf8")
      .digest("hex"),
  };
}

export function verifyEvidenceManifest(
  manifest: Record<string, unknown>,
  signingKey: string,
  expectedHash: string,
  expectedSignature: string,
): boolean {
  const signed = signEvidenceManifest(manifest, signingKey);
  const hash = Buffer.from(signed.manifestHash, "hex");
  const expectedHashBytes = Buffer.from(expectedHash, "hex");
  const signature = Buffer.from(signed.signature, "hex");
  const expectedSignatureBytes = Buffer.from(expectedSignature, "hex");
  return (
    hash.length === expectedHashBytes.length &&
    signature.length === expectedSignatureBytes.length &&
    timingSafeEqual(hash, expectedHashBytes) &&
    timingSafeEqual(signature, expectedSignatureBytes)
  );
}

export class LocalEvidenceObjectStore implements EvidenceObjectStore {
  constructor(private readonly rootDirectory: string) {
    mkdirSync(rootDirectory, { recursive: true });
  }

  async put(
    organizationId: string,
    bytes: Uint8Array,
  ): Promise<StoredEvidenceObject> {
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const tenant = createHash("sha256")
      .update(organizationId)
      .digest("hex")
      .slice(0, 32);
    const key = `${tenant}/${contentHash.slice(0, 2)}/${randomUUID()}`;
    const destination = this.pathFor(key);
    mkdirSync(join(this.rootDirectory, tenant, contentHash.slice(0, 2)), {
      recursive: true,
    });
    const temporary = `${destination}.tmp`;
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { key, contentHash, size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    return readFileSync(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    rmSync(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    if (!/^[a-f0-9]{32}\/[a-f0-9]{2}\/[a-f0-9-]{36}$/.test(key)) {
      throw new Error("Evidence object key is invalid.");
    }
    return join(this.rootDirectory, ...key.split("/"));
  }
}

const EICAR_MARKER = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

export class LocalDevelopmentMalwareScanner implements MalwareScanner {
  async scan(bytes: Uint8Array, now: string): Promise<ArtifactScanReceipt> {
    const infected = Buffer.from(bytes).includes(Buffer.from(EICAR_MARKER));
    return {
      status: infected ? "Infected" : "Clean",
      scanner: "remedence-local-eicar-boundary",
      scannedAt: now,
      detail: infected
        ? "EICAR test signature detected."
        : "No local test signature detected.",
    };
  }
}

export class ClamAvMalwareScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMilliseconds = 15_000,
  ) {}

  async scan(bytes: Uint8Array, now: string): Promise<ArtifactScanReceipt> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const responses: Buffer[] = [];
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(this.timeoutMilliseconds, () =>
        fail(new Error("Malware scanner timed out.")),
      );
      socket.once("error", fail);
      socket.on("data", (chunk: Buffer) => responses.push(chunk));
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.byteLength);
        socket.write(length);
        socket.write(bytes);
        socket.end(Buffer.alloc(4));
      });
      socket.once("close", () => {
        const response = Buffer.concat(responses)
          .toString("utf8")
          .replace(/\0/g, "")
          .trim();
        if (response.endsWith(" OK")) {
          resolve({
            status: "Clean",
            scanner: "clamav-instream",
            scannedAt: now,
            detail: response,
          });
        } else if (response.endsWith(" FOUND")) {
          resolve({
            status: "Infected",
            scanner: "clamav-instream",
            scannedAt: now,
            detail: response,
          });
        } else {
          reject(new Error("Malware scanner returned an invalid receipt."));
        }
      });
    });
  }
}
