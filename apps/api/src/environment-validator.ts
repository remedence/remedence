import { accessSync, constants } from "node:fs";
import { getApiConfig } from "./config.js";

const config = getApiConfig();
if (config.authentication.mode !== "required") {
  throw new Error(
    "Deployment preflight requires REMEDENCE_AUTH_MODE=required.",
  );
}
if (config.host !== "0.0.0.0") {
  throw new Error("Deployment preflight requires REMEDENCE_API_HOST=0.0.0.0.");
}
if (config.evidence.scanner !== "clamav") {
  throw new Error(
    "Deployment preflight requires the ClamAV evidence boundary.",
  );
}
accessSync(config.dataDirectory, constants.R_OK | constants.W_OK);
console.log(
  JSON.stringify({
    status: "ok",
    database_backend: config.databaseUrl ? "postgresql" : "sqlite",
    application_origin: config.authentication.baseURL,
    verification_profiles: config.verificationProfiles.length,
    integration_key_version: config.integrationKeyring?.activeVersion,
  }),
);
