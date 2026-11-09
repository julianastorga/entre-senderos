import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Azure deployment is gated to main pushes and provisioning refuses local/PR execution", async () => {
  const workflow = await readFile(new URL("../.github/workflows/azure.yml", import.meta.url), "utf8");
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request_target/u);
  for (const extra of [{ GITHUB_ACTIONS: "", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" }, { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/4/merge" }, { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature" }]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/provision-demo.mjs", import.meta.url))], { env: { ...process.env, ...extra }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /only in GitHub Actions for a push to main/u);
  }
});
