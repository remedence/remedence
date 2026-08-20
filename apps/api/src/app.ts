import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => {
    response.json({
      status: "ok",
      database: "not-configured",
      schema_version: 0,
    });
  });
  return app;
}
