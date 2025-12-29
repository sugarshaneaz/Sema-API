# sema-api

## Overview
A minimal Express TypeScript API server with WhatsApp webhook integration.

## Current State
- **Status**: Backend-only setup
- **Last Updated**: December 29, 2025

## Architecture

### Backend (Express + TypeScript)
- **Entry Point**: `src/index.ts`
- **Build Output**: `dist/index.cjs`
- **Server**: Express.js running on process.env.PORT (default 3000)
- **Dependencies**: express, cors (minimal setup)

## Scripts
- `npm run dev` - Development with tsx
- `npm run build` - Compile TypeScript to dist/index.cjs
- `npm start` - Run production build

## API Endpoints

### Health Check
- `GET /api/health` - Health check with timestamp
- `GET /health` - Simple health check

### Webhooks
- `GET /webhooks/whatsapp` - WhatsApp webhook verification (Meta callback)
- `POST /webhooks/whatsapp` - Receive WhatsApp message events

## Deployment
- **Build command**: `npm run build`
- **Run command**: `node dist/index.cjs`
- Server binds to 0.0.0.0 on process.env.PORT

## WhatsApp Webhook Setup
1. Configure your webhook URL in Meta Developer Console: `https://your-domain/webhooks/whatsapp`
2. Set the verify token to match `WEBHOOK_VERIFY_TOKEN` secret
3. Subscribe to messages webhook field

## Notes
- WhatsApp webhooks require HTTPS in production
