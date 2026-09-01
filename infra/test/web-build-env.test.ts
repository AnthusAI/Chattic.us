import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  webBuildEnvExports,
  webDockerBundleCommand,
  webLocalBundleCommand,
} from "../lib/web-build-env";

describe("webBuildEnvExports", () => {
  it("fails closed when SSM values are missing", () => {
    const script = webBuildEnvExports("development");
    assert.match(script, /cognito-user-pool-id/);
    assert.match(script, /cognito-app-client-id/);
    assert.match(script, /cognito-auth-domain/);
    assert.match(script, /\[ -n "\$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \]/);
    assert.match(script, /NEXT_PUBLIC_COGNITO_REDIRECT_URI='https:\/\/dev\.chattic\.us\/auth\/callback'/);
  });
});

describe("web bundle commands", () => {
  it("uses aws cli during docker bundling", () => {
    const command = webDockerBundleCommand("development");
    assert.match(command, /awscli/);
    assert.match(command, /aws ssm get-parameter/);
    assert.match(command, /npm run build/);
  });

  it("uses aws cli during local tryBundle", () => {
    const command = webLocalBundleCommand("staging");
    assert.match(command, /\/chatticus\/staging\/web\/cognito-user-pool-id/);
    assert.match(command, /npm run build/);
  });
});
