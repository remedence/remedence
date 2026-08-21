import { createApp } from "./app.js";
import { getApiConfig } from "./config.js";
import { closeDependencies, createDependencies } from "./dependencies.js";

const config = getApiConfig();
const dependencies = createDependencies(config);
const app = createApp(
  dependencies,
  config.serveWeb ? { webDirectory: config.webDirectory } : {},
);
const server = app.listen(config.port, config.host, () => {
  console.log(
    `Remedence ${config.serveWeb ? "local app" : "API"} listening on http://${config.host}:${config.port}`,
  );
});

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;

  server.close((error) => {
    closeDependencies(dependencies);
    if (error) {
      console.error("Remedence API shutdown failed.", error);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
