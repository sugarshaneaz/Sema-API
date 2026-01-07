# sema-api

## Overview
A minimal Express TypeScript API server with WhatsApp webhook integration, multi-niche AI agent support, and PostgreSQL database. The API handles incoming WhatsApp messages via webhooks, uses niche-specific templates and business knowledge to generate AI-powered responses.

## Current State
- **Status**: Backend with multi-niche AI agent support
- **Last Updated**: January 2026

## Architecture

### Backend (Express + TypeScript + Prisma 7)
- **Entry Point**: `src/index.ts`
- **Build Output**: `dist/index.cjs`
- **Server**: Express.js running on process.env.PORT (default 5000)
- **ORM**: Prisma 7 with @prisma/adapter-pg driver adapter
- **Database**: PostgreSQL (Replit native)
- **AI**: OpenAI via Replit AI Integrations (no API key required)

### Key Files
- `src/index.ts` - Main Express server with all API routes
- `src/promptBuilder.ts` - AI prompt assembly module
- `src/seed.ts` - Niche template seeding script
- `prisma/schema.prisma` - Database schema

## Database Schema

### whatsapp_connections
- `id` (UUID, primary key)
- `wabaId` (String) - WhatsApp Business Account ID
- `phoneNumberId` (String, unique) - Phone Number ID from Meta
- `accessToken` (String) - WhatsApp API access token
- `displayPhoneNumber` (String, optional)
- Relations: businessProfile, conversations

### niches
- `id` (String, primary key, slug)
- `label` (String)
- `version` (Int)
- `isActive` (Boolean)
- Relations: template, businessProfiles

### niche_templates
- `id` (UUID, primary key)
- `nicheId` (String, unique FK)
- `templateJson` (JSON) - Contains systemRules, intakeQuestions, qualificationFlows, upsellRules, safetyRules

### business_profiles
- `id` (UUID, primary key)
- `connectionId` (String, unique FK)
- `nicheId` (String, optional FK)
- `businessName` (String, optional)
- `languagePreference` (String: en/sw/mix)
- `tonePreference` (String: professional/friendly)
- `handoffRules` (JSON)
- `intakeAnswers` (JSON)
- Relations: knowledgeSources, faqItems, products, policies

### knowledge_sources
- `id` (UUID, primary key)
- `businessId` (String, FK)
- `type` (Enum: CATALOG, FAQ, POLICIES, WEBSITE, DOCUMENT, NOTES)
- `title`, `contentText`, `metaJson`, `isEnabled`

### faq_items
- `id`, `businessId`, `question`, `answer`, `isEnabled`

### products_services
- `id`, `businessId`, `name`, `price`, `currency`, `description`, `category`, `isActive`, `sku`, `imageUrl`

### policies
- `id`, `businessId` (unique)
- `returnsPolicyText`, `warrantyPolicyText`, `deliveryPolicyText`, `paymentMethodsJson`

### conversations
- `id`, `connectionId`, `customerPhone`
- `status` (active/escalated)
- `needsHuman` (Boolean)
- `escalationReason`, `messageHistory` (JSON)

## API Endpoints

### Health
- `GET /api/health` - Health check with timestamp
- `GET /health` - Simple health check
- `GET /api/db/ping` - Database connectivity check

### Niches
- `GET /api/niches` - List all active niches
- `GET /api/niches/:id/template` - Get niche template with intake questions

### Business Profile (requires X-Phone-Number-Id header)
- `GET /api/business/profile` - Get business profile
- `PUT /api/business/profile` - Update profile (nicheId, languagePreference, tonePreference, handoffRules, intakeAnswers)

### Knowledge Sources (requires X-Phone-Number-Id header)
- `GET /api/knowledge-sources` - List sources
- `POST /api/knowledge-sources` - Create source
- `PUT /api/knowledge-sources/:id` - Update source
- `DELETE /api/knowledge-sources/:id` - Delete source

### FAQs (requires X-Phone-Number-Id header)
- `GET /api/faqs` - List FAQs
- `POST /api/faqs` - Create FAQ
- `PUT /api/faqs/:id` - Update FAQ
- `DELETE /api/faqs/:id` - Delete FAQ

### Products (requires X-Phone-Number-Id header)
- `GET /api/products` - List products
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Policies (requires X-Phone-Number-Id header)
- `GET /api/policies` - Get policies
- `PUT /api/policies` - Update policies

### Conversations (requires X-Phone-Number-Id header)
- `GET /api/conversations` - List conversations
- `GET /api/conversations/:id` - Get conversation details
- `PUT /api/conversations/:id/resolve` - Resolve escalated conversation

### WhatsApp Connection
- `POST /api/whatsapp/connect` - Save/update WhatsApp connection
- `GET /api/whatsapp/connections` - List all connections (tokens masked)

### Webhooks
- `GET /webhooks/whatsapp` - WhatsApp webhook verification
- `POST /webhooks/whatsapp` - Receive messages, generate AI response, send reply

## Seeded Niches (12)
1. restaurant_cafe
2. grocery_minimart
3. electronics_phone
4. computers_accessories
5. hardware_building
6. beauty_supply
7. salon_services
8. clothing_shoes
9. home_decor_furniture
10. auto_parts
11. pharmacy_guardrailed (with strict safety rules)
12. general_retail

## AI Prompt Assembly
The webhook processing pipeline:
1. Parse incoming WhatsApp message
2. Find/create conversation for customer
3. Check if conversation needs human handoff
4. Load business context (profile, niche template, products, FAQs, policies, knowledge sources)
5. Check safety triggers (refusals for pharmacy, escalation for complaints)
6. Build system prompt with:
   - Global rules (no hallucination, ask clarification, use business facts)
   - Niche rules (qualification flows, upsell rules, safety)
   - Business facts (hours, policies, payment methods)
   - Catalog summary
   - FAQs
7. Generate AI response via OpenAI
8. Store conversation history
9. Send reply via WhatsApp Graph API

## Handoff to Human
- Conversations can be marked `needsHuman: true` when:
  - Safety escalation triggers match (complaints, refunds, medical keywords)
  - Manual escalation by business
- Escalated conversations skip AI replies until resolved
- Use `PUT /api/conversations/:id/resolve` to re-enable AI

## Scripts
- `npm run dev` - Development with tsx
- `npm run build` - Compile TypeScript
- `npm start` - Run production build
- `npx tsx src/seed.ts` - Seed niches (idempotent)

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

## Notes
- WhatsApp webhooks require HTTPS in production
- Access tokens stored in plain text for MVP
- Pharmacy niche has strict refusal/escalation rules
- Tenant isolation via X-Phone-Number-Id header
