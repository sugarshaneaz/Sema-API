# Express TypeScript API Server - Design Guidelines

## Project Classification
This is a **backend API server** with no visual user interface. Design focus shifts to API architecture, developer experience, and documentation presentation.

---

## API Architecture & Structure

**RESTful Design Principles**
- Resource-based URL structure (`/api/v1/users`, `/api/v1/products`)
- Proper HTTP method usage (GET, POST, PUT, PATCH, DELETE)
- Consistent naming conventions (plural nouns for collections)
- Clear versioning strategy in URL path

**Response Format Standards**
```
Success: { success: true, data: {...}, meta: {...} }
Error: { success: false, error: { code, message, details } }
```

**Status Code Consistency**
- 200: Successful GET/PUT/PATCH
- 201: Successful POST (resource created)
- 204: Successful DELETE
- 400: Bad request/validation errors
- 401: Authentication required
- 403: Forbidden
- 404: Resource not found
- 500: Server errors

---

## Developer Documentation Interface

**API Documentation Portal** (using Swagger/OpenAPI or similar)

**Visual Hierarchy**
- Clean, minimal design prioritizing readability
- Left sidebar: Endpoint navigation grouped by resource
- Main content: Endpoint details, examples, schemas
- Right panel: Code examples in multiple languages

**Typography**
- Headings: Inter or system fonts (600-700 weight)
- Code blocks: JetBrains Mono or Fira Code
- Body text: 16px for optimal readability

**Layout System**
- Use Tailwind spacing: p-4, p-6, p-8 for consistent rhythm
- Code blocks: Full-width with p-4 internal padding
- Section spacing: mb-8 between major sections

**Component Library**
- Endpoint cards with method badges (GET=blue, POST=green, DELETE=red)
- Collapsible request/response examples
- Authentication requirement indicators
- Rate limit displays
- Interactive "Try it out" sections

**Reference Inspiration**
- Stripe API docs: Clean, developer-focused
- GitHub API: Clear navigation and examples
- Twilio: Interactive testing interface

---

## Key Design Deliverables

1. **API Response Schema**: Consistent JSON structure across all endpoints
2. **Error Handling Patterns**: Standardized error objects with helpful messages
3. **Documentation Theme**: Professional, code-focused interface
4. **Authentication Flow**: Clear visual guide for token-based auth
5. **Rate Limiting Display**: Visual indicators for API usage limits

**No Images Required** - Documentation should be text and code-focused with syntax highlighting as the primary visual element.