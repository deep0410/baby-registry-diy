import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AdminItem, Claim, PublicItem, ReserveResult } from "./types";

const TABLE = process.env.DYNAMODB_TABLE || "baby-registry";
// Hold duration in seconds — configurable via HOLD_TTL_SECONDS env var (default 30 min).
const HOLD_TTL_SECONDS = parseInt(process.env.HOLD_TTL_SECONDS || "1800", 10);

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const now = () => Math.floor(Date.now() / 1000);
const itemPk = (id: string) => `ITEM#${id}`;
const META = "META";
const slotSk = (n: number) => `SLOT#${n}`;

// ---------- Raw record types ----------
interface MetaRecord {
  pk: string;
  sk: string;
  type: "item";
  id: string;
  name: string;
  url: string;
  imageUrl: string;
  imageKey?: string;
  price?: string;
  quantity: number;
  archived: boolean;
  createdAt: string;
}
interface SlotRecord {
  pk: string;
  sk: string;
  type: "slot";
  slot: number;
  state: "hold" | "claim";
  holderSession?: string;
  ttl?: number;
  purchaserName?: string;
  message?: string;
  purchasedFrom?: string;
  claimedAt?: string;
  byAdmin?: boolean;
}

// ---------- Helpers ----------
function isActiveOccupant(s: SlotRecord, t: number): boolean {
  if (s.state === "claim") return true;
  if (s.state === "hold" && (s.ttl ?? 0) > t) return true;
  return false;
}

// Read every record once; group by item. Fine for a registry-sized table.
async function scanAll(): Promise<{ metas: MetaRecord[]; slotsByItem: Map<string, SlotRecord[]> }> {
  const metas: MetaRecord[] = [];
  const slotsByItem = new Map<string, SlotRecord[]>();
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey })
    );
    for (const r of (res.Items || []) as (MetaRecord | SlotRecord)[]) {
      if (r.type === "item") metas.push(r as MetaRecord);
      else if (r.type === "slot") {
        const id = (r.pk as string).replace("ITEM#", "");
        const arr = slotsByItem.get(id) || [];
        arr.push(r as SlotRecord);
        slotsByItem.set(id, arr);
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { metas, slotsByItem };
}

// ---------- Public listing ----------
export async function getPublicItems(): Promise<PublicItem[]> {
  const t = now();
  const { metas, slotsByItem } = await scanAll();
  return metas
    .filter((m) => !m.archived)
    .map((m) => {
      const slots = slotsByItem.get(m.id) || [];
      const taken = slots.filter((s) => isActiveOccupant(s, t)).length;
      const remaining = Math.max(0, m.quantity - taken);
      return {
        id: m.id,
        name: m.name,
        url: m.url,
        imageUrl: resolveImage(m),
        price: m.price || "",
        quantity: m.quantity,
        remaining,
        taken,
        soldOut: remaining <= 0,
      };
    })
    .sort((a, b) => Number(a.soldOut) - Number(b.soldOut) || a.name.localeCompare(b.name));
}

// ---------- Admin listing ----------
export async function getAdminItems(): Promise<AdminItem[]> {
  const t = now();
  const { metas, slotsByItem } = await scanAll();
  return metas
    .map((m) => {
      const slots = slotsByItem.get(m.id) || [];
      const claimSlots = slots.filter((s) => s.state === "claim");
      const held = slots.filter((s) => s.state === "hold" && (s.ttl ?? 0) > t).length;
      const claims: Claim[] = claimSlots
        .map((s) => ({
          slot: s.slot,
          purchaserName: s.purchaserName || "(anonymous)",
          message: s.message || "",
          purchasedFrom: s.purchasedFrom || "",
          claimedAt: s.claimedAt || "",
          byAdmin: !!s.byAdmin,
        }))
        .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
      const taken = claimSlots.length + held;
      return {
        id: m.id,
        name: m.name,
        url: m.url,
        imageUrl: resolveImage(m),
        imageKey: m.imageKey,
        price: m.price || "",
        quantity: m.quantity,
        remaining: Math.max(0, m.quantity - taken),
        claimed: claimSlots.length,
        held,
        archived: !!m.archived,
        createdAt: m.createdAt,
        claims,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveImage(m: MetaRecord): string {
  if (m.imageKey) return `/api/img?key=${encodeURIComponent(m.imageKey)}`;
  return m.imageUrl || "";
}

// ---------- Admin CRUD ----------
export async function createItem(data: {
  name: string;
  url: string;
  imageUrl?: string;
  imageKey?: string;
  price?: string;
  quantity: number;
}): Promise<string> {
  const id = randomUUID();
  const rec: MetaRecord = {
    pk: itemPk(id),
    sk: META,
    type: "item",
    id,
    name: data.name.trim(),
    url: data.url.trim(),
    imageUrl: (data.imageUrl || "").trim(),
    imageKey: data.imageKey,
    price: (data.price || "").trim(),
    quantity: Math.max(1, Math.floor(data.quantity || 1)),
    archived: false,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: rec }));
  return id;
}

export async function updateItem(
  id: string,
  data: Partial<{
    name: string;
    url: string;
    imageUrl: string;
    imageKey: string;
    price: string;
    quantity: number;
    archived: boolean;
  }>
): Promise<void> {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};
  const put = (key: string, val: any) => {
    sets.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = val;
  };
  if (data.name !== undefined) put("name", data.name.trim());
  if (data.url !== undefined) put("url", data.url.trim());
  if (data.imageUrl !== undefined) put("imageUrl", data.imageUrl.trim());
  if (data.imageKey !== undefined) put("imageKey", data.imageKey);
  if (data.price !== undefined) put("price", data.price.trim());
  if (data.quantity !== undefined) put("quantity", Math.max(1, Math.floor(data.quantity)));
  if (data.archived !== undefined) put("archived", data.archived);
  if (sets.length === 0) return;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: itemPk(id), sk: META },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk)",
    })
  );
}

async function getItemSlots(id: string): Promise<SlotRecord[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :s)",
      ExpressionAttributeValues: { ":pk": itemPk(id), ":s": "SLOT#" },
    })
  );
  return (res.Items || []) as SlotRecord[];
}

export async function deleteItem(id: string): Promise<void> {
  const slots = await getItemSlots(id);
  await Promise.all(
    slots.map((s) =>
      ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: s.pk, sk: s.sk } }))
    )
  );
  await ddb.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: itemPk(id), sk: META } })
  );
}

async function getMeta(id: string): Promise<MetaRecord | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: itemPk(id), sk: META } })
  );
  return (res.Item as MetaRecord) || null;
}

// ---------- Reservation engine (atomic, slot-based) ----------
// Grab a free or expired slot atomically. Returns the slot number on success.
export async function reserve(id: string, session: string): Promise<ReserveResult> {
  const meta = await getMeta(id);
  if (!meta || meta.archived) return { ok: false, reason: "not_found" };
  const t = now();
  const newTtl = t + HOLD_TTL_SECONDS;
  for (let n = 0; n < meta.quantity; n++) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk: itemPk(id), sk: slotSk(n) },
          UpdateExpression:
            "SET #type = :slot, #state = :hold, holderSession = :sess, #ttl = :newttl, slot = :n, createdAt = :ts",
          ConditionExpression:
            "attribute_not_exists(pk) OR (#state = :hold AND #ttl < :now)",
          ExpressionAttributeNames: { "#type": "type", "#state": "state", "#ttl": "ttl" },
          ExpressionAttributeValues: {
            ":slot": "slot",
            ":hold": "hold",
            ":sess": session,
            ":newttl": newTtl,
            ":now": t,
            ":n": n,
            ":ts": new Date().toISOString(),
          },
        })
      );
      return { ok: true, slot: n };
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") continue; // slot taken, try next
      throw e;
    }
  }
  return { ok: false, reason: "unavailable" };
}

// Release a hold the caller owns (e.g. removed from the gift list).
export async function release(id: string, slot: number, session: string): Promise<void> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: itemPk(id), sk: slotSk(slot) },
        ConditionExpression: "#state = :hold AND holderSession = :sess",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":hold": "hold", ":sess": session },
      })
    );
  } catch (e: any) {
    if (e?.name === "ConditionalCheckFailedException") return; // already gone/claimed
    throw e;
  }
}

// Convert an owned, still-valid hold into a permanent claim.
export async function confirm(
  id: string,
  slot: number,
  session: string,
  purchaserName: string,
  message: string,
  purchasedFrom: string
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: itemPk(id), sk: slotSk(slot) },
        UpdateExpression:
          "SET #state = :claim, purchaserName = :pn, message = :msg, purchasedFrom = :pf, claimedAt = :ca REMOVE #ttl, holderSession",
        ConditionExpression: "#state = :hold AND holderSession = :sess AND #ttl > :now",
        ExpressionAttributeNames: { "#state": "state", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":claim": "claim",
          ":hold": "hold",
          ":sess": session,
          ":now": now(),
          ":pn": purchaserName.trim() || "(anonymous)",
          ":msg": message.trim(),
          ":pf": purchasedFrom.trim(),
          ":ca": new Date().toISOString(),
        },
      })
    );
    return true;
  } catch (e: any) {
    if (e?.name === "ConditionalCheckFailedException") return false; // hold expired/taken
    throw e;
  }
}

// ---------- Admin manual purchase controls ----------
// Mark one more unit as purchased (by admin).
export async function adminMarkPurchased(id: string): Promise<boolean> {
  const meta = await getMeta(id);
  if (!meta) return false;
  for (let n = 0; n < meta.quantity; n++) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk: itemPk(id), sk: slotSk(n) },
          UpdateExpression:
            "SET #type = :slot, #state = :claim, slot = :n, purchaserName = :pn, message = :msg, purchasedFrom = :pf, claimedAt = :ca, byAdmin = :ba REMOVE #ttl, holderSession",
          ConditionExpression:
            "attribute_not_exists(pk) OR (#state = :hold AND #ttl < :now)",
          ExpressionAttributeNames: { "#type": "type", "#state": "state", "#ttl": "ttl" },
          ExpressionAttributeValues: {
            ":slot": "slot",
            ":claim": "claim",
            ":hold": "hold",
            ":now": now(),
            ":n": n,
            ":pn": "Marked by admin",
            ":msg": "",
            ":pf": "",
            ":ca": new Date().toISOString(),
            ":ba": true,
          },
        })
      );
      return true;
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") continue;
      throw e;
    }
  }
  return false; // nothing free to mark
}

// Remove a specific claim/hold slot (admin "unmark").
export async function adminRemoveSlot(id: string, slot: number): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: itemPk(id), sk: slotSk(slot) } })
  );
}

// Clear ALL purchases + holds for an item (fully available again).
export async function adminClearAll(id: string): Promise<void> {
  const slots = await getItemSlots(id);
  await Promise.all(
    slots.map((s) =>
      ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: s.pk, sk: s.sk } }))
    )
  );
}

// ---------- Hold validation ----------
// Given a list of { id, slot } pairs owned by a session, returns the subset
// that still have an active hold in DynamoDB (not expired, not claimed/deleted).
// Used by the client to auto-remove stale tray entries.
export async function checkHolds(
  holds: { id: string; slot: number }[],
  session: string
): Promise<Array<{ id: string; slot: number }>> {
  const t = now();
  const results = await Promise.all(
    holds.map(async ({ id, slot }) => {
      try {
        const res = await ddb.send(
          new GetCommand({ TableName: TABLE, Key: { pk: itemPk(id), sk: slotSk(slot) } })
        );
        const rec = res.Item as SlotRecord | undefined;
        const valid =
          !!rec &&
          rec.state === "hold" &&
          rec.holderSession === session &&
          (rec.ttl ?? 0) > t;
        return valid ? { id, slot } : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((r): r is { id: string; slot: number } => r !== null);
}
