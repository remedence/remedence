import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "api", "openapi.yaml");
const committedPath = join(
  root,
  "apps",
  "web",
  "src",
  "lib",
  "api",
  "schema.d.ts",
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "remedence-openapi-"));
const generatedPath = join(temporaryDirectory, "schema.d.ts");

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is required to verify generated API types.");
  }

  const result = spawnSync(
    process.execPath,
    [
      npmCli,
      "exec",
      "--workspace=@remedence/openapi-codegen",
      "--",
      "openapi-typescript",
      specPath,
      "-o",
      generatedPath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    process.stderr.write(
      result.stderr || result.stdout || "API generation failed.\n",
    );
    process.exitCode = result.status ?? 1;
  } else {
    const [committed, generated] = await Promise.all([
      readFile(committedPath),
      readFile(generatedPath),
    ]);

    if (!committed.equals(generated)) {
      console.error(
        "Generated API types are out of date. Run npm run generate:api.",
      );
      process.exitCode = 1;
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
