// Clears all active holds (state = "hold") from the baby registry DynamoDB table.
// Confirmed purchases (state = "claim") are left untouched.
// Run: node clear-holds.mjs

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";

const TABLE   = process.env.DYNAMODB_TABLE || "baby-registry";
const REGION  = process.env.AWS_REGION     || "us-east-1";
const PROFILE = "duvaire";

const client = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});
const ddb = DynamoDBDocumentClient.from(client);

console.log(`Scanning "${TABLE}" for active holds…\n`);

const holds = [];
let ExclusiveStartKey;

do {
  const res = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: "#type = :slot AND #state = :hold",
    ExpressionAttributeNames: { "#type": "type", "#state": "state" },
    ExpressionAttributeValues: { ":slot": "slot", ":hold": "hold" },
    ExclusiveStartKey,
  }));
  holds.push(...(res.Items || []));
  ExclusiveStartKey = res.LastEvaluatedKey;
} while (ExclusiveStartKey);

if (holds.length === 0) {
  console.log("No active holds found — nothing to do.");
  process.exit(0);
}

console.log(`Found ${holds.length} hold(s). Deleting…\n`);

for (const item of holds) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: item.pk, sk: item.sk },
    }));
    console.log(`✓ Released hold — ${item.pk} / ${item.sk}`);
  } catch (err) {
    console.error(`✗ Failed ${item.pk} / ${item.sk}: ${err.message}`);
  }
}

console.log("\nDone — all holds cleared.");
