# sema-api API Reference

## Base URL
```
https://sema-api--shanesylvester.replit.app
```

## Authentication
All admin endpoints require Bearer token authentication:
```
Authorization: Bearer <token>
```

---

## Authentication Endpoints

### POST /api/admin/register
Create a new admin account.

**Request:**
```json
{
  "email": "admin@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

**Response 201:**
```json
{
  "token": "64-char-hex-token",
  "admin": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "John Doe"
  }
}
```

### POST /api/admin/login
Login with email/password.

**Request:**
```json
{
  "email": "admin@example.com",
  "password": "securepassword"
}
```

**Response 200:**
```json
{
  "token": "64-char-hex-token",
  "admin": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "John Doe",
    "restaurantId": "uuid or null"
  }
}
```

### POST /api/admin/logout
Logout and invalidate token.

**Response 200:**
```json
{ "success": true }
```

### GET /api/admin/me
Get current admin info.

**Response 200:**
```json
{
  "id": "uuid",
  "email": "admin@example.com",
  "name": "John Doe",
  "restaurantId": "uuid or null",
  "activeBusinessId": "uuid or null",
  "restaurant": { ... } | null,
  "createdAt": "2025-01-21T..."
}
```

---

## Business Endpoints (NEW)

Businesses are the generalized entity that can represent restaurants, retail stores, clinics, salons, government offices, or other business types.

### Business Types
- `RESTAURANT`
- `RETAIL`
- `CLINIC`
- `SALON`
- `GOV`
- `OTHER`

### POST /api/admin/businesses
Create a new business. Admins can create multiple businesses.

**Request:**
```json
{
  "type": "RESTAURANT",
  "name": "My Restaurant",
  "phone": "+1234567890",
  "address": "123 Main St",
  "description": "Best food in town",
  "logoUrl": "https://...",
  "colors": { "primary": "#FF5722" },
  "settings": { "currency": "USD" }
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "ownerAdminId": "uuid",
  "type": "RESTAURANT",
  "name": "My Restaurant",
  ...
}
```

### GET /api/admin/businesses
List all businesses owned by the authenticated admin.

**Response 200:**
```json
[
  { "id": "uuid", "type": "RESTAURANT", "name": "...", ... }
]
```

### GET /api/admin/businesses/:id
Get a specific business with catalog categories and items.

**Response 200:**
```json
{
  "id": "uuid",
  "type": "RESTAURANT",
  "name": "...",
  "catalogCategories": [
    {
      "id": "uuid",
      "name": "Appetizers",
      "catalogItems": [...]
    }
  ],
  "catalogItems": [...]
}
```

### PATCH /api/admin/businesses/:id
Update a business.

**Request (all fields optional):**
```json
{
  "name": "New Name",
  "phone": "...",
  "address": "...",
  "description": "...",
  "logoUrl": "...",
  "colors": {...},
  "settings": {...}
}
```

### POST /api/admin/businesses/:id/select
Set a business as the admin's active business.

**Response 200:**
```json
{ "activeBusinessId": "uuid" }
```

---

## Catalog Endpoints (NEW)

Catalog is the generalized product/service system that replaces menu for non-restaurant businesses.

### GET /api/admin/businesses/:id/catalog/categories
List all categories for a business.

### POST /api/admin/businesses/:id/catalog/categories
Create a category.

**Request:**
```json
{
  "name": "Electronics",
  "description": "...",
  "position": 0,
  "isActive": true
}
```

### PATCH /api/admin/businesses/:id/catalog/categories/:categoryId
Update a category.

### DELETE /api/admin/businesses/:id/catalog/categories/:categoryId
Delete a category.

### GET /api/admin/businesses/:id/catalog/items
List all catalog items for a business.

### POST /api/admin/businesses/:id/catalog/items
Create a catalog item.

**Request:**
```json
{
  "name": "iPhone 15",
  "price": 999.99,
  "currency": "USD",
  "description": "Latest model",
  "categoryId": "uuid or null",
  "imageUrl": "https://...",
  "isAvailable": true,
  "position": 0,
  "metadata": { "sku": "IPHONE15" }
}
```

**Note:** For GOV business type, `price` can be null.

### PATCH /api/admin/businesses/:id/catalog/items/:itemId
Update a catalog item.

### DELETE /api/admin/businesses/:id/catalog/items/:itemId
Delete a catalog item.

---

## Knowledge Upload Endpoint

### POST /api/admin/businesses/:id/upload-knowledge
Upload and process files (PDFs, images) for AI training. Compresses files and extracts text content.

**Request:**
```
Content-Type: multipart/form-data
file: <binary>
type: "pdf" | "image"
```

**Supported File Types:**
- **Images:** JPEG, PNG, WEBP (resized to max 1600px width, 70% JPEG quality)
- **PDFs:** Up to 20MB (metadata stripped, compressed)

**Response 200:**
```json
{
  "success": true,
  "file": {
    "url": "/objects/uploads/uuid",
    "originalSize": 8500000,
    "compressedSize": 2100000,
    "extractedText": "Menu items: Chapati 20 KES, Mandazi 10 KES..."
  }
}
```

**Features:**
- Image compression with sharp (resize, quality reduction)
- PDF compression with pdf-lib (metadata stripping)
- Text extraction from PDFs using pdf-parse
- OCR for images and image-based PDFs using tesseract.js
- Extracted text stored in business `settings.knowledgeBase`
- Files stored in object storage with private visibility

**Error Responses:**
- 400: Invalid file type or missing required fields
- 404: Business not found
- 500: Processing or upload failure

### POST /api/admin/businesses/:id/scrape-website
Scrape a website and extract business-relevant information using AI.

**Request:**
```json
{
  "url": "https://example-restaurant.com"
}
```

**Response 200:**
```json
{
  "success": true,
  "content": "Menu Items:\n- Chapati: 20 KES\n- Mandazi: 10 KES\n\nHours: Mon-Sat 7am-8pm\n\nDelivery available within 5km"
}
```

**Features:**
- Fetches and parses HTML using cheerio
- Removes scripts, styles, navigation, and other non-content elements
- Extracts text from headings, paragraphs, lists, and tables
- Uses AI (GPT-4o-mini) to summarize and structure the content
- Extracts: products/services with prices, hours, location, contact info, policies
- Automatically appends extracted content to business `settings.knowledgeBase`
- 10 second timeout to prevent hanging on slow sites
- Limits extracted text to 10,000 characters before AI processing

**Error Responses:**
- 400: Invalid URL, site unreachable, or no meaningful content extracted
- 404: Business not found
- 408: Request timeout (website took too long)
- 500: Processing failure

---

## Legacy Restaurant Endpoints (Backward Compatible)

These endpoints continue to work for existing mobile clients. They now internally create/sync with Business entities.

### POST /api/admin/restaurant
Create a restaurant (creates both Restaurant and Business entities).

### GET /api/admin/restaurant
Get the admin's restaurant with menu.

### PATCH /api/admin/restaurant
Update restaurant settings.

### Menu Categories
- GET /api/admin/menu/categories
- POST /api/admin/menu/categories
- PATCH /api/admin/menu/categories/:id
- DELETE /api/admin/menu/categories/:id

### Menu Items
- GET /api/admin/menu/items
- POST /api/admin/menu/items
- PATCH /api/admin/menu/items/:id
- DELETE /api/admin/menu/items/:id

### Orders
- GET /api/admin/orders
- PATCH /api/admin/orders/:id/status

---

## Business Type Metadata Examples

### RESTAURANT
```json
{
  "settings": {
    "currency": "KES",
    "deliveryFee": 100,
    "minimumOrder": 500,
    "openingHours": "9:00-22:00"
  }
}
```

### RETAIL
```json
{
  "settings": {
    "currency": "USD",
    "taxRate": 0.08,
    "shippingOptions": ["pickup", "delivery"]
  }
}
```

### CLINIC
```json
{
  "settings": {
    "appointmentDuration": 30,
    "services": ["consultation", "checkup"],
    "insuranceAccepted": ["Blue Cross", "Aetna"]
  }
}
```

### SALON
```json
{
  "settings": {
    "bookingRequired": true,
    "services": ["haircut", "manicure", "pedicure"]
  }
}
```

### GOV
```json
{
  "settings": {
    "servicesOffered": ["permits", "licenses"],
    "requiredDocuments": ["ID", "proof of residence"]
  }
}
```

---

## Internationalization (i18n) Endpoints

Multi-language support for East Africa + Ethiopia with language detection, translation, caching, and daily quotas.

### Supported Languages

**UI Languages (Day 1):** en, sw, am, so, fr

**Translation Languages (Day 1):** en, sw, am, so, fr, ar, om, ti, rw, lg

### GET /v1/i18n/languages
Get list of supported languages (public endpoint).

**Response 200:**
```json
{
  "uiLanguages": ["en", "sw", "am", "so", "fr"],
  "translationLanguages": ["en", "sw", "am", "so", "fr", "ar", "om", "ti", "rw", "lg"]
}
```

### POST /v1/i18n/detect
Detect language of text. Requires auth.

**Request:**
```json
{
  "text": "Habari, nataka kusaidia"
}
```

**Response 200:**
```json
{
  "lang": "sw"
}
```

### POST /v1/i18n/translate
Translate text. Requires auth and active business. Uses translation cache and enforces daily quotas.

**Request:**
```json
{
  "text": "Hello, how can I help you?",
  "to": "sw",
  "from": "en",
  "mode": "plain"
}
```

**Response 200:**
```json
{
  "from": "en",
  "to": "sw",
  "translatedText": "Habari, naweza kukusaidia vipi?",
  "cached": false
}
```

**Response 429 (Quota exceeded):**
```json
{
  "error": "TRANSLATION_LIMIT_REACHED",
  "limit": 200,
  "plan": "free"
}
```

### GET /v1/business/:id/language-settings
Get business language settings. Requires auth.

**Response 200:**
```json
{
  "id": "uuid",
  "uiLanguage": "en",
  "incomingTranslateTo": "en",
  "outgoingTranslateTo": "en",
  "autoTranslateIncoming": true,
  "autoTranslateOutgoing": false,
  "plan": "free"
}
```

### PUT /v1/business/:id/language-settings
Update business language settings. Requires auth.

**Request (all fields optional):**
```json
{
  "uiLanguage": "sw",
  "incomingTranslateTo": "en",
  "outgoingTranslateTo": "sw",
  "autoTranslateIncoming": true,
  "autoTranslateOutgoing": true
}
```

### GET /v1/business/:id/translation-usage
Get daily translation usage and quota. Requires auth.

**Response 200:**
```json
{
  "businessId": "uuid",
  "plan": "free",
  "today": "2026-01-23",
  "used": 45,
  "limit": 200,
  "remaining": 155
}
```

### POST /v1/business/:id/messages
Create a message with automatic translation. Requires auth.

**Request:**
```json
{
  "text": "Habari, nataka kusaidia",
  "direction": "inbound",
  "senderPhone": "+254700000000",
  "conversationId": "uuid"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "businessId": "uuid",
  "textOriginal": "Habari, nataka kusaidia",
  "langOriginal": "sw",
  "textTranslated": "Hello, I want to help",
  "langTranslated": "en",
  "translationStatus": "done",
  "translationError": null,
  ...
}
```

### GET /v1/business/:id/messages
List messages with original and translated text. Requires auth.

**Query params:** conversationId, limit, offset

**Response 200:** Array of messages with both original and translated fields.

---

## Translation Quotas

| Plan | Daily Limit |
|------|-------------|
| free | 200 translations |
| pro  | 5000 translations |

Cached translations do NOT count toward daily quota.

---

## Environment Variables (i18n)

- `OPENAI_API_KEY` - Required for translation
- `AI_TRANSLATION_MODEL` - Model to use (default: gpt-4o-mini)
- `TRANSLATION_FREE_DAILY_LIMIT` - Free plan limit (default: 200)
- `TRANSLATION_PRO_DAILY_LIMIT` - Pro plan limit (default: 5000)

---

## Error Responses

```json
{ "error": "Description of validation error" }  // 400
{ "error": "Unauthorized" }                      // 401
{ "error": "Resource not found" }                // 404
{ "error": "Email already registered" }          // 409
{ "error": "TRANSLATION_LIMIT_REACHED", ... }    // 429
{ "error": "Text exceeds maximum length..." }    // 413
```
