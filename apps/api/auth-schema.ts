import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { createAuthenticationOptions } from "./src/authentication.js";

export const auth = betterAuth(
  createAuthenticationOptions(new DatabaseSync(":memory:"), {
    mode: "required",
    baseURL: "http://127.0.0.1:43180",
  }),
);
