import assert from "node:assert/strict";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "node:test";
import { ComputerStack } from "../lib/computer-stack";
import {
  CHATTICUS_CLOUD_ENVIRONMENTS,
  ChatticusCloudEnvironment,
  WEB_STACK_IDS,
} from "../lib/environments";
import { CHATTICUS_LOG_RETENTION } from "../lib/log-retention";
import { SnapshotStack } from "../lib/snapshot-stack";
import { SseSpikeStack } from "../lib/sse-spike-stack";
import { ThinTurnStack } from "../lib/thin-turn-stack";
import { WebStack } from "../lib/web-stack";

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

function synthWebStack(environmentName: ChatticusCloudEnvironment): Template {
  const app = new cdk.App();
  const deps = new cdk.Stack(app, "Deps", { env: testEnv });
  const hostedZone = route53.HostedZone.fromHostedZoneAttributes(deps, "Zone", {
    hostedZoneId: "Z1234567890ABC",
    zoneName: "chattic.us",
  });
  const siteCertificate = acm.Certificate.fromCertificateArn(
    deps,
    "Cert",
    "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000",
  );
  const frontDoor = new lambda.Function(deps, "FrontDoor", {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 200 });"),
  });
  const frontDoorFunctionUrl = frontDoor.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
  });
  const invokeSecret = new secretsmanager.Secret(deps, "InvokeSecret");

  const stack = new WebStack(app, WEB_STACK_IDS[environmentName], {
    env: testEnv,
    chatticusEnvironment: environmentName,
    hostedZone,
    siteCertificate,
    frontDoorFunctionUrl,
    invokeSecret,
  });

  return Template.fromStack(stack);
}

function logRetentionResources(template: Template): Record<string, unknown>[] {
  const resources = template.toJSON().Resources ?? {};
  return Object.values(resources).filter(
    (resource) => (resource as { Type?: string }).Type === "Custom::LogRetention",
  );
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

describe("WebStack log retention", () => {
  it("sets RetentionInDays on every Custom::LogRetention in development", () => {
    const template = synthWebStack("development");
    const retentions = logRetentionResources(template);
    assert.equal(retentions.length, 2);
    template.allResourcesProperties("Custom::LogRetention", {
      RetentionInDays: RETENTION_DAYS,
    });
  });

  for (const environmentName of ["staging", "production"] as const) {
    it(`sets RetentionInDays on BucketDeployment handler in ${environmentName}`, () => {
      const template = synthWebStack(environmentName);
      const retentions = logRetentionResources(template);
      assert.equal(retentions.length, 1);
      template.allResourcesProperties("Custom::LogRetention", {
        RetentionInDays: RETENTION_DAYS,
      });
    });
  }

  it("does not emit auto-delete custom resources outside development", () => {
    for (const environmentName of ["staging", "production"] as const) {
      const template = synthWebStack(environmentName);
      template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
    }
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

describe("WebStack log retention inversion", () => {
  it("covers every environment stack", () => {
    for (const environmentName of CHATTICUS_CLOUD_ENVIRONMENTS) {
      const template = synthWebStack(environmentName);
      const retentions = logRetentionResources(template);
      assert.ok(retentions.length >= 1);
      for (const resource of retentions) {
        assert.equal(
          (resource as { Properties?: { RetentionInDays?: number } }).Properties
            ?.RetentionInDays,
          RETENTION_DAYS,
        );
      }
    }
  });
});
