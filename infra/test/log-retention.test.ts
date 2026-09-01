import assert from "node:assert/strict";
import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "node:test";
import { ComputerStack } from "../lib/computer-stack";
import {
  CHATTICUS_LOG_RETENTION,
  LogGroupRetentionAspect,
} from "../lib/log-retention";
import { SnapshotStack } from "../lib/snapshot-stack";
import { SseSpikeStack } from "../lib/sse-spike-stack";
import { ThinTurnStack } from "../lib/thin-turn-stack";

const RETENTION_DAYS = 30;

const testEnv = {
  account: "111111111111",
  region: "us-east-1",
};

function synthComputerStack(): Template {
  const app = new cdk.App();
  const snapshots = new SnapshotStack(app, "TestSnapshots", { env: testEnv });
  const stack = new ComputerStack(app, "TestComputers", {
    env: testEnv,
    snapshotBucket: snapshots.bucket,
  });
  return Template.fromStack(stack);
}

function synthThinTurnStack(): Template {
  const app = new cdk.App();
  const stack = new ThinTurnStack(app, "TestThinTurn", {
    env: testEnv,
    chatticusEnvironment: "development",
  });
  return Template.fromStack(stack);
}

function synthSseSpikeStack(): Template {
  const app = new cdk.App();
  const stack = new SseSpikeStack(app, "TestSseSpike", { env: testEnv });
  return Template.fromStack(stack);
}

function synthAspectLogGroup(): Template {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "TestAspect", { env: testEnv });
  cdk.Aspects.of(stack).add(new LogGroupRetentionAspect(CHATTICUS_LOG_RETENTION));
  new logs.CfnLogGroup(stack, "DeploymentHandlerLogs", {});
  return Template.fromStack(stack);
}

describe("CHATTICUS_LOG_RETENTION", () => {
  it("is 30 days (ONE_MONTH)", () => {
    assert.equal(CHATTICUS_LOG_RETENTION, RETENTION_DAYS);
  });
});

describe("ComputerStack log retention", () => {
  it("sets RetentionInDays on the computer log group", () => {
    const template = synthComputerStack();
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: RETENTION_DAYS,
    });
  });
});

describe("ThinTurnStack log retention", () => {
  it("sets RetentionInDays on every Lambda log-retention resource", () => {
    const template = synthThinTurnStack();
    template.resourceCountIs("Custom::LogRetention", 4);
    template.allResourcesProperties("Custom::LogRetention", {
      RetentionInDays: RETENTION_DAYS,
    });
  });
});

describe("WebStack log retention aspect", () => {
  it("sets RetentionInDays on CfnLogGroup resources (BucketDeployment handlers)", () => {
    const template = synthAspectLogGroup();
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: RETENTION_DAYS,
    });
  });
});

describe("SseSpikeStack log retention", () => {
  it("sets RetentionInDays on the spike Lambda log-retention resource", () => {
    const template = synthSseSpikeStack();
    template.resourceCountIs("Custom::LogRetention", 1);
    template.hasResourceProperties("Custom::LogRetention", {
      RetentionInDays: RETENTION_DAYS,
    });
  });
});
