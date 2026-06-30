// Baby Registry — bulk item loader
// Run from this folder: node add-registry-items.mjs
// Requires AWS profile "duvaire" with DynamoDB write access.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { fromIni } from "@aws-sdk/credential-provider-ini";

const TABLE   = process.env.DYNAMODB_TABLE || "baby-registry";
const REGION  = process.env.AWS_REGION     || "us-east-1";
const PROFILE = "duvaire";

const client = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const items = [
  {
    name:     "Convertible Crib",
    url:      "https://www.walmart.ca/en/ip/Dream-On-Me-Synergy-MOD-Crib-Made-with-Sustainable-New-Zealand-Pinewood/6000208424677",
    imageUrl: "https://i5.walmartimages.com/asr/068c174f-c4ea-40ad-a97c-ce678ae3c88d.72742f243b6ce4e8e48c4c1935b02850.jpeg",
    price:    "$124.00",
    quantity: 1,
  },
  {
    name:     "Crib Mattress",
    url:      "https://www.ikea.com/ca/en/p/jaettetroett-pocket-spring-mattress-for-crib-white-00593394/",
    imageUrl: "https://www.ikea.com/ca/en/images/products/jaettetroett-pocket-spring-mattress-for-crib-white__1451266_pe990655_s5.jpg",
    price:    "$170.00",
    quantity: 1,
  },
  {
    name:     "Waterproof Mattress Pads",
    url:      "https://www.ikea.com/ca/en/p/lenast-mattress-protector-white-10373103/",
    imageUrl: "https://www.ikea.com/ca/en/images/products/lenast-mattress-protector-white__0598798_pe677807_s5.jpg",
    price:    "$45.00",
    quantity: 2,
  },
  {
    name:     "Fitted Crib Sheets",
    url:      "https://www.amazon.ca/dp/B08WG37722",
    imageUrl: "https://m.media-amazon.com/images/P/B08WG37722.01._SX500_.jpg",
    price:    "",
    quantity: 2,
  },
  {
    name:     "Swaddle Blankets",
    url:      "https://www.amazon.ca/dp/B0CL9SJ88Z",
    imageUrl: "https://m.media-amazon.com/images/P/B0CL9SJ88Z.01._SX500_.jpg",
    price:    "",
    quantity: 1,
  },
  {
    name:     "Sleep Sacks (0–6 Months)",
    url:      "https://www.amazon.ca/dp/B0CB154YVP",
    imageUrl: "https://m.media-amazon.com/images/P/B0CB154YVP.01._SX500_.jpg",
    price:    "",
    quantity: 1,
  },
  {
    name:     "Sleep Sacks (6–12 Months)",
    url:      "https://www.amazon.ca/dp/B0CB15872S",
    imageUrl: "https://m.media-amazon.com/images/P/B0CB15872S.01._SX500_.jpg",
    price:    "",
    quantity: 1,
  },
];

console.log(`Inserting ${items.length} items into table "${TABLE}" (profile: ${PROFILE}, region: ${REGION})\n`);

for (const item of items) {
  const id = randomUUID();
  const rec = {
    pk:        `ITEM#${id}`,
    sk:        "META",
    type:      "item",
    id,
    name:      item.name,
    url:       item.url,
    imageUrl:  item.imageUrl,
    price:     item.price,
    quantity:  item.quantity,
    archived:  false,
    createdAt: new Date().toISOString(),
  };

  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: rec }));
    console.log(`✓ ${item.name} (qty: ${item.quantity}${item.price ? ", " + item.price : ""})`);
  } catch (err) {
    console.error(`✗ ${item.name}: ${err.message}`);
  }
}

console.log("\nDone!");
