# sema-api

## Overview
A minimal Express TypeScript API server with WhatsApp webhook integration and PostgreSQL database.

## Current State
- **Status**: Backend-only setup with database
- **Last Updated**: December 29, 2025

## Architecture

### Backend (Express + TypeScript + Prisma 7)
- **Entry Point**: `src/index.ts`
- **Build Output**: `dist/index.cjs`
- **Server**: Express.js running on process.env.PORT (default 3000 for dev, 5000 for Replit)
- **ORM**: Prisma 7 with @prisma/adapter-pg driver adapter
- **Database**: PostgreSQL (Replit native)

## Database Schema

### whatsapp_connections
- `id` (UUID, primary key)
- `waba_id` (String) - WhatsApp Business Account ID
- `phone_number_id` (String, unique) - Phone Number ID from Meta
- `access_token` (String) - WhatsApp API access token (plain text for MVP)
- `display_phone_number` (String, optional) - Human-readable phone number
- `created_at` (DateTime)
- `updated_at` (DateTime)

## Scripts
- `npm run dev` - Development with tsx
- `npm run build` - Compile TypeScript to dist/index.cjs
- `npm start` - Run production build

## API Endpoints

### Health Check
- `GET /api/health` - Health check with timestamp
- `GET /health` - Simple health check

### WhatsApp Connections
- `POST /api/whatsapp/connect` - Save/update WhatsApp connection
  - Body: `{ wabaId, phoneNumberId, accessToken, displayPhoneNumber? }`
  - Upserts by phoneNumberId
- `GET /api/whatsapp/connections` - List all connections (tokens masked)

### Webhooks
- `GET /webhooks/whatsapp` - WhatsApp webhook verification (Meta callback)
- `POST /webhooks/whatsapp` - Receive WhatsApp message events
  - Looks up connection by phone_number_id from webhook metadata
  - Logs connection status and message details

## Deployment
- **Build command**: `npm run build`
- **Run command**: `node dist/index.cjs`
- Server binds to 0.0.0.0 on process.env.PORT

## WhatsApp Webhook Setup
1. Configure your webhook URL in Meta Developer Console: `https://your-domain/webhooks/whatsapp`
2. Set the verify token to match `WEBHOOK_VERIFY_TOKEN` secret
3. Subscribe to messages webhook field
4. Save connection via `POST /api/whatsapp/connect` with your WABA credentials

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-configured by Replit)
- `WEBHOOK_VERIFY_TOKEN` - Token for Meta webhook verification (stored in Secrets)
- `PORT` - Server port (default 3000)

## Notes
- WhatsApp webhooks require HTTPS in production
- Access tokens stored in plain text for MVP (production should encrypt)
- Prisma 7 requires driver adapters (@prisma/adapter-pg)
