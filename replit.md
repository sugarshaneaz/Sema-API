# Express TypeScript API Server

## Overview
A fully-functional Express TypeScript API server with authentication, user management, and project CRUD operations. Features a beautiful API documentation frontend.

## Current State
- **Status**: Complete MVP
- **Last Updated**: December 28, 2025

## Architecture

### Backend (Express + TypeScript)
- **Server**: Express.js running on port 5000
- **Storage**: In-memory storage (MemStorage class)
- **Authentication**: Token-based auth with Bearer tokens
- **API Version**: v1 (all routes prefixed with `/api/v1`)

### Frontend (React + Vite)
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui components
- **Purpose**: API documentation and reference UI

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login and get token
- `POST /api/v1/auth/logout` - Invalidate session (requires auth)

### Users (requires auth)
- `GET /api/v1/users` - List all users
- `GET /api/v1/users/me` - Get current user
- `GET /api/v1/users/:id` - Get user by ID
- `DELETE /api/v1/users/:id` - Delete own account

### Projects (requires auth)
- `GET /api/v1/projects` - List user's projects
- `POST /api/v1/projects` - Create project
- `GET /api/v1/projects/:id` - Get project by ID
- `PATCH /api/v1/projects/:id` - Update project
- `DELETE /api/v1/projects/:id` - Delete project

### Utility
- `GET /api/v1/health` - Health check

## Response Format

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 10 }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": { ... }
  }
}
```

## Key Files
- `server/routes.ts` - API route definitions
- `server/storage.ts` - In-memory storage implementation
- `shared/schema.ts` - Data models and validation schemas
- `client/src/pages/home.tsx` - API documentation UI

## Running the Server
```bash
npm run dev
```

## Authentication Flow
1. Register: `POST /api/v1/auth/register` with `{ username, email, password }`
2. Login: `POST /api/v1/auth/login` with `{ username, password }`
3. Use token: Include `Authorization: Bearer <token>` header

## Notes
- In-memory storage resets on server restart
- For production, consider implementing PostgreSQL persistence
- Password hashing uses SHA-256 (upgrade to bcrypt for production)
