# Migration Runbook: Restaurant to Business

This document provides step-by-step instructions for migrating existing Restaurant data to the new generalized Business domain.

## Overview

The migration creates corresponding Business, CatalogCategory, and CatalogItem entries for each existing Restaurant, MenuCategory, and MenuItem. It also links Orders to their Business and sets Admin.activeBusinessId.

## Prerequisites

1. Database backup (Replit provides automatic checkpoints)
2. Access to the Replit console
3. All migrations applied: `npx prisma migrate deploy`

## Pre-Migration Checklist

- [ ] Verify current data: `SELECT COUNT(*) FROM restaurants;`
- [ ] Verify no existing migrations: `SELECT COUNT(*) FROM businesses WHERE "legacyRestaurantId" IS NOT NULL;`
- [ ] Ensure server is stopped or can handle brief downtime

## Migration Steps

### 1. Apply Database Migrations

```bash
npx prisma migrate deploy
```

This creates the new tables:
- `businesses`
- `catalog_categories`
- `catalog_items`

And adds new columns:
- `admins.activeBusinessId`
- `orders.businessId`

### 2. Run Data Migration Script

```bash
npx tsx scripts/migrateRestaurantToBusiness.ts
```

The script will:
1. Find all existing Restaurants
2. For each Restaurant:
   - Create a Business with `type=RESTAURANT`
   - Copy all fields (name, phone, address, etc.)
   - Set `legacyRestaurantId` for idempotency
3. Migrate MenuCategory → CatalogCategory
4. Migrate MenuItem → CatalogItem
5. Link Orders to the new Business
6. Set Admin.activeBusinessId

### 3. Verify Migration

```sql
-- Check businesses created
SELECT COUNT(*) FROM businesses WHERE "legacyRestaurantId" IS NOT NULL;

-- Check categories migrated
SELECT COUNT(*) FROM catalog_categories;

-- Check items migrated
SELECT COUNT(*) FROM catalog_items;

-- Verify admin linkage
SELECT id, email, "activeBusinessId" FROM admins WHERE "activeBusinessId" IS NOT NULL;

-- Verify order linkage
SELECT COUNT(*) FROM orders WHERE "businessId" IS NOT NULL;
```

### 4. Validate API Endpoints

Test legacy endpoints still work:
```bash
# Login
curl -X POST https://your-app.replit.app/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password"}'

# Get restaurant (should return same data as before)
curl https://your-app.replit.app/api/admin/restaurant \
  -H "Authorization: Bearer <token>"

# List businesses (should show migrated restaurant)
curl https://your-app.replit.app/api/admin/businesses \
  -H "Authorization: Bearer <token>"
```

## Rollback Guidance

If migration fails or needs to be reverted:

### Option 1: Database Rollback (Replit)
Use Replit's checkpoint system to restore to a previous state.

### Option 2: Manual Cleanup

```sql
-- Remove migrated data (in reverse order due to FK constraints)
DELETE FROM catalog_items WHERE "businessId" IN (
  SELECT id FROM businesses WHERE "legacyRestaurantId" IS NOT NULL
);

DELETE FROM catalog_categories WHERE "businessId" IN (
  SELECT id FROM businesses WHERE "legacyRestaurantId" IS NOT NULL
);

UPDATE orders SET "businessId" = NULL;

UPDATE admins SET "activeBusinessId" = NULL;

DELETE FROM businesses WHERE "legacyRestaurantId" IS NOT NULL;
```

### Option 3: Schema Rollback

```bash
npx prisma migrate resolve --rolled-back add_business_catalog_models
```

## Idempotency

The migration script is idempotent:
- It checks `legacyRestaurantId` to skip already-migrated restaurants
- Running it multiple times is safe
- Each Restaurant creates exactly one Business

## Post-Migration

After successful migration:

1. **Verify mobile app compatibility**: Test that the Sema app still works with legacy endpoints
2. **Monitor logs**: Watch for any errors in `/api/admin/restaurant` or `/api/admin/menu/*` endpoints
3. **Gradual rollout**: New mobile app versions can start using `/api/admin/businesses/*` endpoints

## Troubleshooting

### Migration script fails with connection error
```bash
# Check DATABASE_URL is set
echo $DATABASE_URL

# Test database connection
npx prisma db pull
```

### "legacyRestaurantId already exists" error
This means the restaurant was already migrated. The script handles this automatically by skipping.

### Orders not linked
Run this SQL to manually link orders:
```sql
UPDATE orders o
SET "businessId" = b.id
FROM businesses b
WHERE b."legacyRestaurantId" = o."restaurantId"
  AND o."businessId" IS NULL;
```

## Support

For issues during migration, use Replit's checkpoint system to restore to a known-good state, or contact support.
