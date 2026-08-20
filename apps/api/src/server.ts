import { createApp } from "./app.js";
import { getApiConfig } from "./config.js";

const config = getApiConfig();
const server = createApp().listen(config.port, config.host, () => {
  console.log(
    `Remedence API listening on http://${config.host}:${config.port}`,
  );
});

function shutdown(): void {
  server.close((error) => {
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
