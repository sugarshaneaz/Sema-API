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

## Error Responses

```json
{ "error": "Description of validation error" }  // 400
{ "error": "Unauthorized" }                      // 401
{ "error": "Resource not found" }                // 404
{ "error": "Email already registered" }          // 409
```
