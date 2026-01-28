# sema-api

## Overview
A minimal Express TypeScript API server with WhatsApp webhook integration, multi-niche AI agent support, and PostgreSQL database. The API handles incoming WhatsApp messages via webhooks, uses niche-specific templates and business knowledge to generate AI-powered responses. Supports multiple business types (restaurants, retail, clinics, salons, government offices) with a generalized catalog system.

## Current State
- **Status**: Backend with multi-business support and generalized catalog
- **Last Updated**: January 2026

## Architecture

### Backend (Express + TypeScript + Prisma 7)
- **Entry Point**: `src/index.ts`
- **Build Output**: `dist/index.cjs`
- **Server**: Express.js running on process.env.PORT (default 5000)
- **ORM**: Prisma 7 with @prisma/adapter-pg driver adapter
- **Database**: PostgreSQL (Replit native)
- **AI**: OpenAI via Replit AI Integrations (no API key required)
- **Testing**: Vitest

### Key Files
- `src/index.ts` - Main Express server with all API routes
- `src/promptBuilder.ts` - AI prompt assembly module
- `src/seed.ts` - Niche template seeding script
- `scripts/migrateRestaurantToBusiness.ts` - Data migration script
- `prisma/schema.prisma` - Database schema
- `docs/API.md` - API reference documentation
- `MIGRATION_RUNBOOK.md` - Migration instructions

## Database Schema

### New Domain Models (Multi-Business Support)

### businesses
- `id` (UUID, primary key)
- `ownerAdminId` (String, FK to Admin)
- `type` (Enum: RESTAURANT, RETAIL, CLINIC, SALON, GOV, OTHER)
- `name`, `phone`, `address`, `description`, `logoUrl`
- `colors` (JSON), `settings` (JSON)
- `legacyRestaurantId` (String, unique, nullable) - For migration tracking
- `uiLanguage`, `incomingTranslateTo`, `outgoingTranslateTo` (String, default "en")
- `autoTranslateIncoming` (Boolean, default true), `autoTranslateOutgoing` (Boolean, default false)
- `plan` (String, default "free") - Controls translation quotas
- Relations: catalogCategories, catalogItems, messages, translationUsage

### catalog_categories
- `id` (UUID, primary key)
- `businessId` (String, FK to Business)
- `name`, `description`, `position`, `isActive`
- Relations: catalogItems

### catalog_items
- `id` (UUID, primary key)
- `businessId` (String, FK to Business)
- `categoryId` (String, nullable FK to CatalogCategory)
- `name`, `price` (nullable for GOV), `currency`, `description`
- `imageUrl`, `isAvailable`, `position`, `metadata` (JSON)

### admins
- `id` (UUID, primary key)
- `email` (String, unique)
- `passwordHash`, `salt` (String) - SHA256 hashed password
- `name` (String)
- `activeBusinessId` (String, nullable FK to Business)
- Relations: restaurant (1:1, legacy), businesses (1:many)

### Legacy Models (Backward Compatible)

### restaurants
- `id` (UUID, primary key)
- `adminId` (String, unique FK)
- `name`, `phone`, `address`, `description`, `logoUrl`
- `colors` (JSON), `settings` (JSON)
- Relations: categories, menuItems, orders

### menu_categories
- `id`, `restaurantId`, `name`, `description`, `position`, `isActive`

### menu_items
- `id`, `restaurantId`, `categoryId`, `name`, `description`, `price`, `currency`, `imageUrl`, `isAvailable`, `position`

### orders
- `id`, `restaurantId`, `businessId` (nullable)
- `status` (Enum: pending, confirmed, preparing, ready, delivered, cancelled)
- `items` (JSON), `customerName`, `customerPhone`, `customerEmail`, `subtotal`, `total`, `notes`

### i18n Models (Multi-Language Support)

### messages
- `id`, `businessId`, `conversationId`, `direction`, `senderPhone`, `recipientPhone`
- `textOriginal`, `langOriginal`, `textTranslated`, `langTranslated`
- `translationStatus` (Enum: none, done, failed), `translationError`

### translation_cache
- `id`, `keyHash` (unique), `fromLang`, `toLang`
- `textOriginal`, `textTranslated`, `hitCount`, `lastHitAt`

### translation_usage_daily
- `id`, `businessId`, `day`, `count`
- Unique constraint: (businessId, day)

### WhatsApp Domain Models

### whatsapp_connections
- `id` (UUID, primary key)
- `wabaId`, `phoneNumberId` (unique), `accessToken`, `displayPhoneNumber`
- `enabled` (Boolean, default true) - Toggle connection on/off
- `mode` (String, default "REVIEW") - OFF | REVIEW | AUTO
- `pausedUntil` (DateTime, nullable) - Optional pause window
- `lastInboundAt`, `lastOutboundAt` (DateTime, nullable)
- Relations: businessProfile, conversations

### whatsapp_messages
- `id` (UUID, primary key)
- `phoneNumberId`, `direction` (IN/OUT), `fromNumber`, `toNumber`
- `waMessageId`, `text`, `rawPayload` (JSON)
- `status` (String, default "RECEIVED") - RECEIVED | DRAFT | SENT | FAILED
- Indexes: (phoneNumberId, createdAt), (waMessageId)

### whatsapp_drafts
- `id` (UUID, primary key)
- `phoneNumberId`, `inboundMsgId` (nullable), `toNumber`, `text`
- `createdBy` (nullable), `status` (default "PENDING") - PENDING | SENT | CANCELED
- Index: (phoneNumberId, createdAt)

### Other WhatsApp Models
- business_profiles, niches, niche_templates
- knowledge_sources, faq_items, products_services, policies, conversations

## API Endpoints

### Health
- `GET /api/health` - Health check with timestamp
- `GET /health` - Simple health check
- `GET /api/db/ping` - Database connectivity check

### Admin Authentication
- `POST /api/admin/register` - Create admin account → returns Bearer token
- `POST /api/admin/login` - Login → returns Bearer token
- `POST /api/admin/logout` - Logout and invalidate token
- `GET /api/admin/me` - Get current admin info (includes activeBusinessId)

### Business Management (NEW - requires Bearer token)
- `POST /api/admin/businesses` - Create business (type, name, phone, etc.)
- `GET /api/admin/businesses` - List admin's businesses
- `GET /api/admin/businesses/:id` - Get business with catalog
- `PATCH /api/admin/businesses/:id` - Update business
- `POST /api/admin/businesses/:id/select` - Set as active business

### Catalog Management (NEW - requires Bearer token)
- `GET /api/admin/businesses/:id/catalog/categories` - List categories
- `POST /api/admin/businesses/:id/catalog/categories` - Create category
- `PATCH /api/admin/businesses/:id/catalog/categories/:categoryId` - Update
- `DELETE /api/admin/businesses/:id/catalog/categories/:categoryId` - Delete
- `GET /api/admin/businesses/:id/catalog/items` - List items
- `POST /api/admin/businesses/:id/catalog/items` - Create item
- `PATCH /api/admin/businesses/:id/catalog/items/:itemId` - Update
- `DELETE /api/admin/businesses/:id/catalog/items/:itemId` - Delete

### i18n / Translation (NEW - requires Bearer token)
- `GET /v1/i18n/languages` - List supported UI and translation languages
- `POST /v1/i18n/detect` - Detect language of text
- `POST /v1/i18n/translate` - Translate text (uses cache, enforces quotas)
- `GET /v1/business/:id/language-settings` - Get business language settings
- `PUT /v1/business/:id/language-settings` - Update language settings
- `GET /v1/business/:id/translation-usage` - Get daily translation quota usage
- `POST /v1/business/:id/messages` - Create message with auto-translation
- `GET /v1/business/:id/messages` - List messages (includes original + translated)

### Knowledge Upload (requires Bearer token)
- `POST /api/admin/businesses/:id/upload-knowledge` - Upload PDF/image, compress, extract text, store in object storage
- `POST /api/admin/businesses/:id/scrape-website` - Scrape website, extract content with AI, store in knowledgeBase

### Legacy Restaurant Endpoints (Backward Compatible)
- `POST /api/admin/restaurant` - Create restaurant (also creates Business)
- `GET /api/admin/restaurant` - Get restaurant with menu
- `PATCH /api/admin/restaurant` - Update restaurant (syncs to Business)

### Legacy Menu Endpoints (Backward Compatible)
- `GET/POST/PATCH/DELETE /api/admin/menu/categories`
- `GET/POST/PATCH/DELETE /api/admin/menu/items`

### Orders (requires Bearer token)
- `GET /api/admin/orders` - List orders (?status=pending&limit=50&offset=0)
- `PATCH /api/admin/orders/:id/status` - Update order status

### WhatsApp Endpoints
- `POST /api/whatsapp/connect` - Save/update connection
- `GET /api/whatsapp/connections` - List connections (includes enabled, mode, pausedUntil, lastInboundAt, lastOutboundAt)
- `GET /api/whatsapp/connections/:phoneNumberId` - Get single connection
- `PATCH /api/whatsapp/connections/:phoneNumberId` - Toggle connection (enabled, mode: OFF|REVIEW|AUTO, pausedUntil)
- `GET /api/whatsapp/status/:phoneNumberId` - Get connection status summary
- `GET /api/whatsapp/messages?phoneNumberId=...&limit=50&cursor=...` - List messages with pagination
- `GET /api/whatsapp/drafts?phoneNumberId=...&status=PENDING` - List drafts
- `POST /api/whatsapp/drafts` - Create draft (phoneNumberId, toNumber, text, inboundMsgId?, createdBy?)
- `POST /api/whatsapp/drafts/:id/send` - Send draft via WhatsApp API
- `GET /webhooks/whatsapp` - Webhook verification
- `POST /webhooks/whatsapp` - Receive messages (logs all, respects enabled/mode/pausedUntil for auto-reply)

### WhatsApp Business Profile (requires X-Phone-Number-Id header)
- `GET/PUT /api/business/profile`
- `GET/POST/PUT/DELETE /api/knowledge-sources`, `/api/faqs`, `/api/products`, `/api/policies`
- `GET/PUT /api/conversations/:id`

## Business Types
- `RESTAURANT` - Food service (menu items with prices)
- `RETAIL` - Retail stores (products with SKUs)
- `CLINIC` - Healthcare (services, appointments)
- `SALON` - Beauty services (services, booking)
- `GOV` - Government offices (services, no prices)
- `OTHER` - Generic business type

## Scripts
- `npm run dev` - Development with tsx
- `npm run build` - Compile TypeScript
- `npm start` - Run production build
- `npx tsx src/seed.ts` - Seed niches (idempotent)
- `npx tsx scripts/migrateRestaurantToBusiness.ts` - Migrate restaurant data
- `npx vitest run` - Run tests

## Deployment
- **Build command**: `npm run build`
- **Run command**: `node dist/index.cjs`
- Production requires: `npx prisma migrate deploy` then seed

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `WEBHOOK_VERIFY_TOKEN` - Token for Meta webhook verification
- `PORT` - Server port
- `AI_INTEGRATIONS_OPENAI_API_KEY` - Auto-configured by Replit
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Auto-configured by Replit

## Migration Notes
- Existing Restaurant data can be migrated to Business using the migration script
- Legacy endpoints continue to work for existing mobile clients
- New mobile app versions should use Business/Catalog endpoints
- See `MIGRATION_RUNBOOK.md` for detailed migration instructions

## Notes
- WhatsApp webhooks require HTTPS in production
- Access tokens stored in plain text for MVP
- Pharmacy niche has strict refusal/escalation rules
- Tenant isolation via X-Phone-Number-Id header (WhatsApp) and Bearer token (Admin)
- Order status transitions: pending → confirmed → preparing → ready → delivered (cancel allowed at any stage except delivered/cancelled)
