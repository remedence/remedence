CREATE TABLE "ssoProvider" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issuer" TEXT NOT NULL,
  "oidcConfig" TEXT,
  "samlConfig" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "providerId" TEXT NOT NULL UNIQUE,
  "organizationId" TEXT REFERENCES organizations (id) ON DELETE CASCADE,
  "domain" TEXT NOT NULL,
  "domainVerified" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "ssoProvider_userId_idx" ON "ssoProvider" ("userId");
CREATE INDEX "ssoProvider_organizationId_idx" ON "ssoProvider" ("organizationId");
CREATE INDEX "ssoProvider_domain_idx" ON "ssoProvider" ("domain");
