import { IAspect } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { IConstruct } from "constructs";

/**
 * CloudWatch log retention for every Chatticus log group.
 *
 * DynamoDB is the system of record; logs are a 30-day debug window long
 * enough for incident lookback and short enough to bound storage cost.
 */
export const CHATTICUS_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

/** Apply retention to CfnLogGroup nodes (e.g. BucketDeployment custom-resource Lambdas). */
export class LogGroupRetentionAspect implements IAspect {
  constructor(private readonly retentionDays: logs.RetentionDays) {}

  visit(node: IConstruct): void {
    if (node instanceof logs.CfnLogGroup) {
      node.addPropertyOverride("RetentionInDays", this.retentionDays);
    }
  }
}
