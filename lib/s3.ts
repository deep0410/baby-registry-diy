import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.S3_BUCKET || "";
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Presigned PUT so the admin browser can upload a photo straight to S3.
export async function presignUpload(contentType: string): Promise<{ url: string; key: string }> {
  const ext = ALLOWED[contentType];
  if (!ext) throw new Error("Unsupported image type");
  const key = `uploads/${randomUUID()}.${ext}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 }
  );
  return { url, key };
}

// Presigned GET so pages can display a private-bucket image without making the bucket public.
export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 3600,
  });
}
