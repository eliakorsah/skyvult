import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";

export const runtime = "nodejs";

const BUCKET = "kyc-docs";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const Schema = z.object({
  filename:    z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  sizeBytes:   z.number().int().positive().max(MAX_SIZE_BYTES),
  slot:        z.enum(["front", "back", "selfie"]),
});

/** Ensure the private bucket exists. Creates it if missing.
 *  Safe to call on every upload — createBucket is a no-op if already present. */
async function ensureBucket(): Promise<void> {
  const { data: list } = await supabaseAdmin.storage.listBuckets();
  const exists = (list ?? []).some((b) => b.name === BUCKET);
  if (exists) return;

  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_SIZE_BYTES,
    allowedMimeTypes: ALLOWED_TYPES,
  });
  if (error) {
    // "Duplicate" error is fine — another request created it first
    if (!error.message.toLowerCase().includes("already exists")) {
      throw new Error(`Could not create storage bucket: ${error.message}`);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    if (!ALLOWED_TYPES.includes(body.contentType)) {
      return fail(400, "File type not allowed. Use JPEG, PNG, WEBP, HEIC, or PDF.");
    }

    await ensureBucket();

    const ext  = body.filename.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${user.id}/${body.slot}_${Date.now()}.${ext}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      console.error("[kyc/upload] storage error:", error?.message);
      return fail(500, "Could not create upload URL.");
    }

    return ok({ signedUrl: data.signedUrl, path });
  } catch (e) {
    return handleError(e);
  }
}
