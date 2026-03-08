import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseJsonBody, optionalString } from '@/lib/apiValidation';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

    const db = getDb();

    // Check ownership
    const [asset] = await db
      .select()
      .from(marketplaceAssets)
      .where(and(eq(marketplaceAssets.id, assetId), eq(marketplaceAssets.sellerId, user.id)))
      .limit(1);

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const parsed = await parseJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const updates: Record<string, unknown> = {};

    if (parsed.body.name !== undefined) {
      const r = optionalString(parsed.body.name, 'Name', { maxLength: 200 });
      if (!r.ok) return r.response;
      updates.name = r.value;
    }
    if (parsed.body.description !== undefined) {
      const r = optionalString(parsed.body.description, 'Description', { maxLength: 5000 });
      if (!r.ok) return r.response;
      updates.description = r.value;
    }
    if (parsed.body.priceTokens !== undefined) {
      const p = parsed.body.priceTokens;
      if (typeof p !== 'number' || !Number.isInteger(p) || p < 0) {
        return NextResponse.json({ error: 'priceTokens must be a non-negative integer' }, { status: 400 });
      }
      updates.priceTokens = p;
    }
    if (parsed.body.license !== undefined) {
      const r = optionalString(parsed.body.license, 'License', { maxLength: 50 });
      if (!r.ok) return r.response;
      updates.license = r.value;
    }
    if (parsed.body.tags !== undefined) {
      if (!Array.isArray(parsed.body.tags)) {
        return NextResponse.json({ error: 'Tags must be an array' }, { status: 400 });
      }
      updates.tags = (parsed.body.tags as unknown[])
        .filter((t): t is string => typeof t === 'string')
        .slice(0, 20);
    }
    if (parsed.body.previewUrl !== undefined) {
      const r = optionalString(parsed.body.previewUrl, 'Preview URL', { maxLength: 2000 });
      if (!r.ok) return r.response;
      updates.previewUrl = r.value;
    }
    if (parsed.body.assetFileUrl !== undefined) {
      const r = optionalString(parsed.body.assetFileUrl, 'Asset file URL', { maxLength: 2000 });
      if (!r.ok) return r.response;
      updates.assetFileUrl = r.value;
    }
    if (parsed.body.assetFileSize !== undefined) {
      const s = parsed.body.assetFileSize;
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) {
        return NextResponse.json({ error: 'assetFileSize must be a non-negative integer' }, { status: 400 });
      }
      updates.assetFileSize = s;
    }
    if (parsed.body.status !== undefined) {
      // Sellers can only transition draft -> pending_review. Publishing requires admin review.
      const allowedTransitions: Record<string, string[]> = {
        draft: ['pending_review'],
        pending_review: ['draft'], // Can withdraw back to draft
        rejected: ['pending_review', 'draft'], // Can resubmit
      };
      const allowed = allowedTransitions[asset.status] || [];
      const newStatus = parsed.body.status;
      if (typeof newStatus !== 'string' || !allowed.includes(newStatus)) {
        return NextResponse.json(
          { error: `Cannot transition from '${asset.status}' to '${newStatus}'` },
          { status: 400 }
        );
      }
      updates.status = newStatus;
    }

    await db
      .update(marketplaceAssets)
      .set(updates)
      .where(eq(marketplaceAssets.id, assetId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating asset:', error);
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 });
  }
}
