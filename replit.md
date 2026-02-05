# sema-api

## Overview
The `sema-api` project is a minimal Express TypeScript API server designed to integrate WhatsApp webhooks with multi-niche AI agents and a PostgreSQL database. Its primary purpose is to automate responses to WhatsApp messages using AI, leveraging niche-specific templates and business knowledge. The system supports various business types, including restaurants, retail, clinics, salons, and government offices, through a generalized catalog system. The project aims to provide an intelligent, automated communication layer for businesses interacting with customers via WhatsApp, offering capabilities like multi-language support, payment integration, and robust administrative tools.

## User Preferences
The user prefers clear, concise communication and detailed explanations when necessary. They expect an iterative development approach and would like to be consulted before any major architectural changes or significant code refactoring. The user also requests that the agent prioritizes maintaining backward compatibility for existing mobile clients while new features are developed using the updated business and catalog endpoints. They prefer a pragmatic approach to development, balancing new feature delivery with system stability.

## System Architecture

### Backend
The backend is built with Express.js and TypeScript, using Prisma 7 with `@prisma/adapter-pg` for ORM. PostgreSQL serves as the primary database, and OpenAI (via Replit AI Integrations) is used for AI functionalities.

### Data Models
The database schema supports multi-business functionality with models for `businesses`, `catalog_categories`, and `catalog_items`, allowing flexible definitions for various business types (RESTAURANT, RETAIL, CLINIC, SALON, GOV, OTHER). It includes backward-compatible legacy models for `restaurants`, `menu_categories`, and `menu_items`. Internationalization (i18n) is handled by `messages`, `translation_cache`, and `translation_usage_daily` models, facilitating multi-language support with translation caching and quota management. WhatsApp integration is managed through `whatsapp_connections`, `whatsapp_messages`, `whatsapp_drafts`, and `whatsapp_webhook_events`.

### API Endpoints
The API provides a comprehensive set of endpoints:
-   **Health Checks**: Basic system and database health checks.
-   **Admin Authentication**: Endpoints for admin registration, login, logout, and retrieving admin information.
-   **Business Management**: CRUD operations for businesses and setting active businesses.
-   **Catalog Management**: CRUD operations for categories and items within a business's catalog.
-   **i18n / Translation**: Endpoints for language detection, translation, managing language settings, and tracking translation usage.
-   **Knowledge Upload**: Functionality to upload knowledge sources (PDF/images) and scrape websites for AI knowledge base population.
-   **Legacy Endpoints**: Backward-compatible endpoints for restaurant and menu management.
-   **Orders**: Endpoints for listing and updating order statuses.
-   **WhatsApp Embedded Signup**: Flow for onboarding WhatsApp Business accounts.
-   **WhatsApp Endpoints**: Management of WhatsApp connections, messages, drafts, and webhook handling.
-   **Payment Endpoints**: Integration with Selcom for checkout and payment status retrieval.
-   **WhatsApp Business Profile**: Endpoints for managing business profiles, knowledge sources, FAQs, products, policies, and conversations.

### UI/UX Decisions
The system supports configurable `colors` and `settings` for businesses, suggesting a degree of UI customization for each business's profile or client-facing interfaces. The `uiLanguage` setting indicates support for user interface localization. The WhatsApp embedded signup flow is server-rendered HTML.

### Design Choices
-   **Tenant Isolation**: Achieved via `X-Phone-Number-Id` header for WhatsApp and Bearer tokens for Admin.
-   **Backward Compatibility**: Legacy restaurant and menu endpoints are maintained for existing clients during migration to the new multi-business model.
-   **Generalized Catalog**: A flexible catalog system supports various business types, abstracting product/service offerings.
-   **AI Integration**: AI agents are niche-specific, using templates and business knowledge for relevant responses.
-   **Multi-language Support**: Features auto-translation and translation caching, with quotas managed by business plans.
-   **Webhook Handling**: Robust logging of WhatsApp webhook events for debugging and auditing.

## External Dependencies

-   **Database**: PostgreSQL (Replit native)
-   **ORM**: Prisma 7
-   **AI**: OpenAI (via Replit AI Integrations)
-   **WhatsApp**: Meta (for WhatsApp Business API and Embedded Signup)
-   **Payment Gateway**: Selcom (for payment processing)
-   **Testing**: Vitest (for unit and integration tests)
## WhatsApp Embedded Signup Setup

### Prerequisites
1. Meta Developer Account with a Facebook App
2. WhatsApp Business API access enabled on your app
3. Facebook Login for Business configured with Embedded Signup

### Environment Variables Setup
```bash
# Required for Embedded Signup page
META_APP_ID=your_facebook_app_id
META_APP_SECRET=your_facebook_app_secret
META_CONFIG_ID=your_embedded_signup_config_id

# Optional
META_REDIRECT_URI=https://your-domain.com/connect/whatsapp
API_BASE_URL=https://your-domain.com
```

### Meta Developer Console Setup
1. Go to Meta Developer Console → Your App → Add Products → WhatsApp
2. Under App Settings → Basic, copy App ID and App Secret
3. Under Facebook Login for Business → Configurations, create a new configuration:
   - Select "Embedded Signup for WhatsApp"
   - Copy the Configuration ID
4. Add your domain to Valid OAuth Redirect URIs

### Testing the Flow
```bash
# 1. Open the signup page in browser
open https://your-domain.com/connect/whatsapp

# 2. Check connection status
curl https://your-domain.com/api/whatsapp/embedded-signup/status

# 3. View onboarding debug logs
curl "https://your-domain.com/api/debug/whatsapp/onboarding?key=DEBUG_KEY&limit=10"

# 4. Verify webhook subscription (after connection)
curl "https://your-domain.com/api/whatsapp/connections"
```

### Webhook Configuration
After successful Embedded Signup:
1. The app automatically subscribes to WABA webhooks via Graph API
2. Configure webhook URL in Meta Developer Console:
   - Callback URL: `https://your-domain.com/webhooks/whatsapp`
   - Verify Token: Value of `WEBHOOK_VERIFY_TOKEN` env var
3. Subscribe to: messages, message_deliveries, message_reads
