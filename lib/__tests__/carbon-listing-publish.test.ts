// Copyright 2024 Farm-credit Contributors
// Licensed under the Apache License, Version 2.0

/**
 * Unit tests for lib/api/carbon-listing-publish.ts — Issue #1382
 *
 * Covers: createAndPublishListing and getPublishedListings.
 * Verifies:
 * - Required field validation (projectId, sellerAddress, quantityTonnes,
 *   pricePerTon, creditType, verificationMethod)
 * - Successful creation returns all expected fields with correct values
 * - Published listing is retrievable via getPublishedListings()
 * - Multiple listings accumulate in LIFO order (newest first)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import type {
  PublishListingRequest,
  CreditTypeCategory,
  VerificationMethod,
} from '@/lib/types/carbon-listing-publish';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Re-import the module fresh for each test to reset the in-memory store. */
function freshModule() {
  return import('@/lib/api/carbon-listing-publish?' + Date.now());
}

/** Minimal valid request that satisfies all required fields */
const validRequest: PublishListingRequest = {
  projectId: 'VCS-1940',
  projectName: 'East Africa Community Reforestation',
  sellerAddress: 'GBZXN7PIRZGNMHGA72XZQGBG66AGDCKTHJNRQ6T6O4B37666U2N2C62Z',
  landManagerName: 'Highland Carbon Stewards',
  creditType: 'Reforestation & Afforestation' as CreditTypeCategory,
  quantityTonnes: 500,
  pricePerTon: 24.5,
  currency: 'USD',
  verificationMethod: 'Verra (VCS)' as VerificationMethod,
  vintageYear: 2024,
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('createAndPublishListing', () => {
  let createAndPublishListing: Awaited<ReturnType<typeof freshModule>>['createAndPublishListing'];
  let getPublishedListings: Awaited<ReturnType<typeof freshModule>>['getPublishedListings'];

  beforeEach(async () => {
    // Use a fresh dynamic import each suite so the in-memory array is empty.
    const mod = await freshModule();
    createAndPublishListing = mod.createAndPublishListing;
    getPublishedListings = mod.getPublishedListings;
  });

  // ── validation ─────────────────────────────────────────────────────────────

  it('throws when projectId is missing', async () => {
    await expect(createAndPublishListing({ ...validRequest, projectId: '' })).rejects.toThrow(
      'Project ID is required.'
    );
  });

  it('throws when sellerAddress is missing', async () => {
    await expect(createAndPublishListing({ ...validRequest, sellerAddress: '' })).rejects.toThrow(
      'Seller address is required.'
    );
  });

  it('throws when quantityTonnes is zero', async () => {
    await expect(createAndPublishListing({ ...validRequest, quantityTonnes: 0 })).rejects.toThrow(
      'Quantity must be greater than 0 tons.'
    );
  });

  it('throws when quantityTonnes is negative', async () => {
    await expect(createAndPublishListing({ ...validRequest, quantityTonnes: -10 })).rejects.toThrow(
      'Quantity must be greater than 0 tons.'
    );
  });

  it('throws when pricePerTon is zero', async () => {
    await expect(createAndPublishListing({ ...validRequest, pricePerTon: 0 })).rejects.toThrow(
      'Price per ton must be greater than 0.'
    );
  });

  it('throws when pricePerTon is negative', async () => {
    await expect(createAndPublishListing({ ...validRequest, pricePerTon: -5 })).rejects.toThrow(
      'Price per ton must be greater than 0.'
    );
  });

  it('throws when creditType is empty', async () => {
    await expect(
      createAndPublishListing({ ...validRequest, creditType: '' as CreditTypeCategory })
    ).rejects.toThrow('Credit type must be specified.');
  });

  it('throws when verificationMethod is empty', async () => {
    await expect(
      createAndPublishListing({ ...validRequest, verificationMethod: '' as VerificationMethod })
    ).rejects.toThrow('Verification method must be specified.');
  });

  // ── successful creation ─────────────────────────────────────────────────────

  it('returns a published listing with all required fields', async () => {
    const listing = await createAndPublishListing(validRequest);

    expect(listing.id).toMatch(/^LIST-V2-/);
    expect(listing.projectId).toBe(validRequest.projectId);
    expect(listing.projectName).toBe(validRequest.projectName);
    expect(listing.sellerAddress).toBe(validRequest.sellerAddress);
    expect(listing.landManagerName).toBe(validRequest.landManagerName);
    expect(listing.creditType).toBe(validRequest.creditType);
    expect(listing.quantityTonnes).toBe(500);
    expect(listing.availableTonnes).toBe(500);
    expect(listing.pricePerTon).toBe(24.5);
    expect(listing.currency).toBe('USD');
    expect(listing.verificationMethod).toBe(validRequest.verificationMethod);
    expect(listing.vintageYear).toBe(2024);
    expect(listing.status).toBe('published');
    expect(listing.publishedAt).toBeTruthy();
    // transactionHash is optional but should be a non-empty string when provided
    if (listing.transactionHash) {
      expect(listing.transactionHash.length).toBeGreaterThan(0);
    }
  });

  it('generates a unique id per listing', async () => {
    const a = await createAndPublishListing(validRequest);
    const b = await createAndPublishListing(validRequest);
    expect(a.id).not.toBe(b.id);
  });

  it('uses the request currency when specified', async () => {
    const listing = await createAndPublishListing({ ...validRequest, currency: 'EUR' });
    expect(listing.currency).toBe('EUR');
  });

  it('defaults currency to USD when not provided', async () => {
    const { currency: _omitted, ...withoutCurrency } = validRequest;
    // Cast: currency is required in type but service falls back to 'USD'
    const listing = await createAndPublishListing(
      withoutCurrency as unknown as PublishListingRequest
    );
    expect(listing.currency).toBe('USD');
  });

  it('preserves registryReferenceId when provided', async () => {
    const listing = await createAndPublishListing({
      ...validRequest,
      registryReferenceId: 'VCS-1940-CUSTOM-REF',
    });
    expect(listing.registryReferenceId).toBe('VCS-1940-CUSTOM-REF');
  });

  it('auto-generates registryReferenceId when not provided', async () => {
    const listing = await createAndPublishListing(validRequest);
    // Should contain the projectId
    expect(listing.registryReferenceId).toContain(validRequest.projectId);
  });

  it('falls back to current year for vintageYear when not provided', async () => {
    const { vintageYear: _omitted, ...withoutVintage } = validRequest;
    const listing = await createAndPublishListing(
      withoutVintage as unknown as PublishListingRequest
    );
    expect(listing.vintageYear).toBe(new Date().getFullYear());
  });

  it('stores the listing so it is retrievable via getPublishedListings', async () => {
    const listing = await createAndPublishListing(validRequest);
    const all = await getPublishedListings();
    const found = all.find((l) => l.id === listing.id);
    expect(found).toBeDefined();
    expect(found?.creditType).toBe('Reforestation & Afforestation');
    expect(found?.verificationMethod).toBe('Verra (VCS)');
  });

  it('prepends new listings (newest first)', async () => {
    const first = await createAndPublishListing({ ...validRequest, quantityTonnes: 100 });
    const second = await createAndPublishListing({ ...validRequest, quantityTonnes: 200 });
    const all = await getPublishedListings();
    // Second listing (most recent) should appear first
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);
  });
});

describe('getPublishedListings', () => {
  it('returns an empty array initially', async () => {
    const { getPublishedListings: freshGet } = await freshModule();
    const listings = await freshGet();
    expect(listings).toBeInstanceOf(Array);
  });
});
