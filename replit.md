# sema-api

## Overview
A minimal Express TypeScript API server with WhatsApp webhook integration.

## Current State
- **Status**: Backend-only setup
- **Last Updated**: December 29, 2025

## Architecture

### Backend (Express + TypeScript)
- **Entry Point**: `src/server.ts`
- **Server**: Express.js running on port 5000
- **Dependencies**: express, cors (minimal setup)

## API Endpoints

### Health Check
- `GET /api/health` - Health check endpoint

### Webhooks
- `GET /webhooks/whatsapp` - WhatsApp webhook verification (Meta callback)
- `POST /webhooks/whatsapp` - Receive WhatsApp message events

## WhatsApp Webhook Setup
1. Configure your webhook URL in Meta Developer Console: `https://your-domain/webhooks/whatsapp`
2. Set the verify token to match `WEBHOOK_VERIFY_TOKEN` secret
3. Subscribe to messages webhook field

## Running the Server
```bash
npm run dev
```

## Key Files
- `src/server.ts` - Main server entry point with all routes

## Notes
- WhatsApp webhooks require HTTPS in production
- Server binds to 0.0.0.0:5000
