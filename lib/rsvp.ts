import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const TABLE = process.env.DYNAMODB_TABLE || "baby-registry";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export interface Rsvp {
  name: string;
  email: string;
  partySize: number;
  createdAt: string;
  updatedAt: string;
}

// RSVPs live in the same table as registry items, under their own pk prefix.
// pk = RSVP#<email>, sk = META, type = "rsvp" — invisible to the registry
// code, which only looks at type "item" / "slot".
const rsvpPk = (email: string) => `RSVP#${normalizeEmail(email)}`;
const META = "META";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface RsvpRecord extends Rsvp {
  pk: string;
  sk: string;
  type: "rsvp";
}

export async function getRsvp(email: string): Promise<Rsvp | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: rsvpPk(email), sk: META } })
  );
  const rec = res.Item as RsvpRecord | undefined;
  if (!rec) return null;
  return {
    name: rec.name,
    email: rec.email,
    partySize: rec.partySize,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

// Create or update an RSVP. Returns the saved record plus whether it was new.
export async function saveRsvp(data: {
  name: string;
  email: string;
  partySize: number;
}): Promise<{ rsvp: Rsvp; created: boolean }> {
  const email = normalizeEmail(data.email);
  const existing = await getRsvp(email);
  const nowIso = new Date().toISOString();
  const rec: RsvpRecord = {
    pk: rsvpPk(email),
    sk: META,
    type: "rsvp",
    name: data.name.trim(),
    email,
    partySize: Math.max(1, Math.floor(data.partySize)),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: rec }));
  return {
    rsvp: {
      name: rec.name,
      email: rec.email,
      partySize: rec.partySize,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    },
    created: !existing,
  };
}

export async function deleteRsvp(email: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: rsvpPk(email), sk: META } })
  );
}

// Admin edit. If the email changed, the record moves to a new key (email is
// the partition key), preserving the original createdAt.
export async function updateRsvp(data: {
  originalEmail: string;
  name: string;
  email: string;
  partySize: number;
}): Promise<{ rsvp: Rsvp } | { error: string }> {
  const from = normalizeEmail(data.originalEmail);
  const to = normalizeEmail(data.email);
  const existing = await getRsvp(from);
  if (!existing) return { error: "RSVP not found" };
  if (from !== to) {
    const clash = await getRsvp(to);
    if (clash) return { error: "An RSVP with that email already exists" };
  }
  const rec: RsvpRecord = {
    pk: rsvpPk(to),
    sk: META,
    type: "rsvp",
    name: data.name.trim(),
    email: to,
    partySize: Math.max(1, Math.floor(data.partySize)),
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: rec }));
  if (from !== to) await deleteRsvp(from);
  return {
    rsvp: {
      name: rec.name,
      email: rec.email,
      partySize: rec.partySize,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    },
  };
}

export async function listRsvps(): Promise<Rsvp[]> {
  const out: Rsvp[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "#type = :rsvp",
        ExpressionAttributeNames: { "#type": "type" },
        ExpressionAttributeValues: { ":rsvp": "rsvp" },
        ExclusiveStartKey,
      })
    );
    for (const r of (res.Items || []) as RsvpRecord[]) {
      out.push({
        name: r.name,
        email: r.email,
        partySize: r.partySize,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
