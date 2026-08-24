import { DomainError, type EvidenceQuery } from "@remedence/core";
import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { mutationActorFrom, organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { toEvidence } from "./http-shapes.js";

function queryRecord(request: Request): Record<string, unknown> {
  return request.query as unknown as Record<string, unknown>;
}

function optionalString(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name];
  return value === undefined ? undefined : String(value);
}

function optionalBoolean(
  query: Record<string, unknown>,
  name: string,
): boolean | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  return value === true || value === "true";
}

function integerValue(
  query: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = query[name];
  if (value === undefined) return fallback;
  return typeof value === "number" ? value : Number(value);
}

function evidenceQueryFrom(
  request: Request,
  organizationId: string,
): EvidenceQuery {
  const query = queryRecord(request);
  const findingId = optionalString(query, "finding_id");
  const verificationId = optionalString(query, "verification_id");
  const locked = optionalBoolean(query, "locked");
  const cursor = optionalString(query, "cursor");

  return {
    organizationId,
    ...(findingId !== undefined ? { findingId } : {}),
    ...(verificationId !== undefined ? { verificationId } : {}),
    ...(locked !== undefined ? { locked } : {}),
    ...(cursor ? { cursor } : {}),
    pageSize: integerValue(query, "page_size", 25),
  };
}

export function createEvidenceRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.post("/evidence/artifacts", async (request, response, next) => {
    const organizationId = organizationIdFrom(response);
    let storedKey: string | undefined;
    try {
      const bytes = request.body;
      const filename = request.header("x-evidence-filename")?.trim() ?? "";
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        throw new DomainError(
          "EVIDENCE_ARTIFACT_EMPTY",
          400,
          "Evidence artifact bytes are required.",
        );
      }
      if (
        !filename ||
        filename.length > 255 ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        throw new DomainError(
          "EVIDENCE_FILENAME_INVALID",
          400,
          "A safe evidence filename is required.",
        );
      }
      const protection = dependencies.evidenceProtection;
      const createdAt = protection.clock.now();
      const receipt = await protection.scanner.scan(bytes, createdAt);
      if (receipt.status !== "Clean") {
        throw new DomainError(
          "EVIDENCE_MALWARE_DETECTED",
          422,
          "The evidence artifact failed malware scanning.",
        );
      }
      const stored = await protection.objectStore.put(organizationId, bytes);
      storedKey = stored.key;
      const retention = new Date(createdAt);
      retention.setUTCDate(retention.getUTCDate() + protection.retentionDays);
      const artifact = {
        organizationId,
        id: protection.idGenerator.next(),
        objectKey: stored.key,
        contentHash: stored.contentHash,
        size: stored.size,
        mediaType: "application/octet-stream",
        originalFilename: filename,
        scanStatus: receipt.status,
        scanner: receipt.scanner,
        scanReceipt: { ...receipt },
        uploadedBy: mutationActorFrom(response).actorId,
        createdAt,
        retentionUntil: retention.toISOString(),
        legalHold: false,
        adoptedAt: null,
      } as const;
      dependencies.repositories.evidence.insertArtifact?.(artifact);
      response
        .location(
          `/api/v1/evidence/artifacts/${encodeURIComponent(artifact.id)}`,
        )
        .status(201)
        .json({
          id: artifact.id,
          content_hash: artifact.contentHash,
          size_bytes: artifact.size,
          original_filename: artifact.originalFilename,
          scan_status: artifact.scanStatus,
          scanner: artifact.scanner,
          created_at: artifact.createdAt,
          retention_until: artifact.retentionUntil,
        });
    } catch (error) {
      if (storedKey) {
        await dependencies.evidenceProtection.objectStore
          .remove(storedKey)
          .catch(() => undefined);
      }
      next(error);
    }
  });

  router.get("/evidence", (request, response, next) => {
    try {
      const evidence = dependencies.repositories.evidence.list(
        evidenceQueryFrom(request, organizationIdFrom(response)),
      );
      response.json({
        items: evidence.items.map(toEvidence),
        page_size: evidence.pageSize,
        total: evidence.total,
        next_cursor: evidence.nextCursor,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/evidence/:evidenceId", (request, response, next) => {
    try {
      const evidence = dependencies.repositories.evidence.getById(
        organizationIdFrom(response),
        request.params.evidenceId ?? "",
      );
      if (!evidence) {
        throw new DomainError(
          "EVIDENCE_NOT_FOUND",
          404,
          "Evidence was not found.",
        );
      }
      response.json(toEvidence(evidence));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/evidence/:evidenceId/content",
    async (request, response, next) => {
      try {
        const organizationId = organizationIdFrom(response);
        const evidence = dependencies.repositories.evidence.getById(
          organizationId,
          request.params.evidenceId ?? "",
        );
        const artifact = evidence?.artifactId
          ? dependencies.repositories.evidence.getArtifact?.(
              organizationId,
              evidence.artifactId,
            )
          : undefined;
        if (!evidence || !artifact || artifact.scanStatus !== "Clean") {
          throw new DomainError(
            "EVIDENCE_ARTIFACT_NOT_FOUND",
            404,
            "Protected evidence artifact was not found.",
          );
        }
        const bytes = await dependencies.evidenceProtection.objectStore.get(
          artifact.objectKey,
        );
        const actualHash = createHash("sha256").update(bytes).digest("hex");
        if (actualHash !== artifact.contentHash) {
          throw new DomainError(
            "EVIDENCE_ARTIFACT_INTEGRITY_FAILURE",
            503,
            "Protected evidence failed integrity validation.",
          );
        }
        response.setHeader("content-type", artifact.mediaType);
        response.setHeader(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(artifact.originalFilename)}`,
        );
        response.send(Buffer.from(bytes));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
