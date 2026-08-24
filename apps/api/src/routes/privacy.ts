import { createHash } from "node:crypto";
import { DomainError } from "@remedence/core";
import { Router } from "express";
import {
  authenticatedPrincipalFrom,
  organizationIdFrom,
} from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";

function requireRole(
  response: Parameters<typeof authenticatedPrincipalFrom>[0],
  roles: readonly string[],
) {
  const principal = authenticatedPrincipalFrom(response);
  if (!principal || !roles.includes(principal.role)) {
    throw new DomainError(
      "PRIVACY_ADMIN_REQUIRED",
      403,
      "This privacy operation requires an authorized tenant administrator.",
    );
  }
  return principal;
}

export function createPrivacyRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/privacy/export", async (_request, response, next) => {
    try {
      const principal = requireRole(response, ["Owner", "Administrator"]);
      const organizationId = organizationIdFrom(response);
      const now = dependencies.evidenceProtection.clock.now();
      const snapshot = dependencies.privacy.exportSnapshot(organizationId, now);
      const artifacts = [];
      for (const artifact of snapshot.artifacts) {
        const bytes = await dependencies.evidenceProtection.objectStore.get(
          artifact.objectKey,
        );
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== artifact.contentHash) {
          throw new DomainError(
            "PRIVACY_EXPORT_INTEGRITY_FAILURE",
            409,
            "Tenant export stopped because an evidence artifact failed integrity validation.",
          );
        }
        artifacts.push({
          id: artifact.id,
          filename: artifact.filename,
          content_hash: artifact.contentHash,
          bytes_base64: Buffer.from(bytes).toString("base64"),
        });
      }
      dependencies.repositories.auditEvents.append({
        organizationId,
        actorType: "user",
        actorId: principal.userId,
        action: "privacy.exported",
        entityType: "organization",
        entityId: organizationId,
        details: {
          record_types: Object.keys(snapshot.records),
          artifact_count: artifacts.length,
        },
        occurredAt: now,
      });
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="remedence-${organizationId}-export.json"`,
      );
      response.json({
        organization_id: organizationId,
        exported_at: now,
        records: snapshot.records,
        artifacts,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/privacy/artifacts/:artifactId/legal-hold",
    async (request, response, next) => {
      try {
        const principal = requireRole(response, ["Owner", "Administrator"]);
        const organizationId = organizationIdFrom(response);
        const artifactId = request.params.artifactId ?? "";
        const legalHold = Boolean(
          (request.body as { legal_hold: boolean }).legal_hold,
        );
        const now = dependencies.evidenceProtection.clock.now();
        const apply = async () => {
          if (
            !dependencies.privacy.setArtifactLegalHold(
              organizationId,
              artifactId,
              legalHold,
            )
          ) {
            throw new DomainError(
              "EVIDENCE_ARTIFACT_NOT_FOUND",
              404,
              "Evidence artifact was not found.",
            );
          }
          await dependencies.repositories.auditEvents.append({
            organizationId,
            actorType: "user",
            actorId: principal.userId,
            action: legalHold
              ? "privacy.legal_hold_applied"
              : "privacy.legal_hold_released",
            entityType: "evidence_artifact",
            entityId: artifactId,
            details: {},
            occurredAt: now,
          });
        };
        if (dependencies.runAtomically) await dependencies.runAtomically(apply);
        else await apply();
        response.json({
          id: artifactId,
          legal_hold: legalHold,
          updated_at: now,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/privacy/delete-tenant", async (request, response, next) => {
    try {
      const principal = requireRole(response, ["Owner"]);
      const organizationId = organizationIdFrom(response);
      const confirmation = String(
        (request.body as { confirmation: string }).confirmation ?? "",
      );
      if (confirmation !== `DELETE ${organizationId}`) {
        throw new DomainError(
          "TENANT_DELETION_CONFIRMATION_INVALID",
          400,
          `Confirmation must exactly match DELETE ${organizationId}.`,
        );
      }
      const now = dependencies.evidenceProtection.clock.now();
      let receipt;
      try {
        receipt = dependencies.privacy.deleteTenant({
          organizationId,
          receiptId: dependencies.evidenceProtection.idGenerator.next(),
          requestedBy: principal.userId,
          now,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("legal hold")) {
          throw new DomainError(
            "TENANT_DELETION_LEGAL_HOLD",
            409,
            error.message,
          );
        }
        throw error;
      }
      let cleanupError = "";
      for (const key of receipt.objectKeys) {
        try {
          await dependencies.evidenceProtection.objectStore.remove(key);
        } catch (error) {
          cleanupError =
            error instanceof Error ? error.message : "Object cleanup failed.";
          break;
        }
      }
      dependencies.privacy.completeDeletionReceipt(
        receipt.id,
        dependencies.evidenceProtection.clock.now(),
        cleanupError,
      );
      response.status(cleanupError ? 202 : 200).json({
        receipt_id: receipt.id,
        organization_digest: receipt.organizationDigest,
        status: cleanupError ? "Pending object cleanup" : "Complete",
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
