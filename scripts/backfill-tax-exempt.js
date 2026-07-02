#!/usr/bin/env node
//
// OPTIONAL. You do NOT need to run this for tax-exempt items to work — any
// existing item without a `taxExempt` attribute is already treated as taxed
// (the default) by the app. This script only exists if you'd like the field
// to be explicitly present (taxExempt: false) on every old item record, e.g.
// for data hygiene or to make future DynamoDB scans/exports self-describing.
//
// What it does: scans the table for item META records missing `taxExempt`
// and sets it to `false`. It never touches records that already have the
// attribute set (so it's safe to re-run, and won't clobber anything you've
// already marked tax-exempt in the admin UI).
//
// Usage:
//   set -a; source .env.local; set +a   # load AWS_REGION / DYNAMODB_TABLE / creds
//   node scripts/backfill-tax-exempt.js
//
//   Add --dry-run to preview without writing:
//   node scripts/backfill-tax-exempt.js --dry-run
//
// Optional overrides (env vars): AWS_REGION (default us-east-1),
// DYNAMODB_TABLE (default baby-registry). Uses the same AWS credential
// resolution as the app (env vars, profile, etc.) — no extra setup needed
// if .env.local / your AWS CLI is already configured.

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.DYNAMODB_TABLE || "baby-registry";
const REGION = process.env.AWS_REGION || "us-east-1";
const DRY_RUN = process.argv.includes("--dry-run");

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

async function main() {
  console.log(`Table: ${TABLE}  Region: ${REGION}${DRY_RUN ? "  (dry run)" : ""}`);

  let ExclusiveStartKey;
  let scanned = 0;
  let toUpdate = [];

  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    for (const item of res.Items || []) {
      if (item.type !== "item") continue; // only META item records, not slots
      scanned++;
      if (item.taxExempt === undefined) {
        toUpdate.push({ pk: item.pk, sk: item.sk, name: item.name });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log(`Scanned ${scanned} item(s). ${toUpdate.length} missing taxExempt.`);

  if (toUpdate.length === 0) {
    console.log("Nothing to do — every item already has the field set.");
    return;
  }

  for (const it of toUpdate) {
    console.log(`${DRY_RUN ? "[dry-run] Would set" : "Setting"} taxExempt=false on "${it.name}" (${it.pk})`);
    if (DRY_RUN) continue;
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: it.pk, sk: it.sk },
        UpdateExpression: "SET taxExempt = :f",
        ConditionExpression: "attribute_not_exists(taxExempt)",
        ExpressionAttributeValues: { ":f": false },
      })
    ).catch((e) => {
      if (e?.name !== "ConditionalCheckFailedException") throw e;
      // someone else set it in the meantime — fine, skip.
    });
  }

  console.log(DRY_RUN ? "Dry run complete — no changes written." : `Done. Updated ${toUpdate.length} item(s).`);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
