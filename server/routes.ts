import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSchema, insertProjectSchema, loginSchema, updateProjectSchema, type ApiResponse } from "@shared/schema";
import { randomBytes, createHash } from "crypto";
import { ZodError } from "zod";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function sendSuccess<T>(res: Response, data: T, status = 200, meta?: object) {
  const response: ApiResponse<T> = { success: true, data };
  if (meta) response.meta = meta;
  res.status(status).json(response);
}

function sendError(res: Response, code: string, message: string, status = 400, details?: unknown) {
  const response: ApiResponse = {
    success: false,
    error: { code, message, details }
  };
  res.status(status).json(response);
}

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(res, "UNAUTHORIZED", "Authentication required", 401);
  }

  const token = authHeader.substring(7);
  const userId = await storage.getSession(token);
  
  if (!userId) {
    return sendError(res, "UNAUTHORIZED", "Invalid or expired token", 401);
  }

  const user = await storage.getUser(userId);
  if (!user) {
    return sendError(res, "UNAUTHORIZED", "User not found", 401);
  }

  (req as any).user = user;
  (req as any).token = token;
  next();
}

function omitPassword<T extends { password?: string }>(user: T): Omit<T, "password"> {
  const { password, ...rest } = user;
  return rest;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Auth Routes
  app.post("/api/v1/auth/register", async (req: Request, res: Response) => {
    try {
      const data = insertUserSchema.parse(req.body);
      
      const existingUsername = await storage.getUserByUsername(data.username);
      if (existingUsername) {
        return sendError(res, "CONFLICT", "Username already exists", 409);
      }

      const existingEmail = await storage.getUserByEmail(data.email);
      if (existingEmail) {
        return sendError(res, "CONFLICT", "Email already exists", 409);
      }

      const hashedPassword = hashPassword(data.password);
      const user = await storage.createUser({ ...data, hashedPassword });
      const token = generateToken();
      await storage.createSession(token, user.id);

      sendSuccess(res, { user: omitPassword(user), token }, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, error.errors);
      }
      sendError(res, "SERVER_ERROR", "Failed to register user", 500);
    }
  });

  app.post("/api/v1/auth/login", async (req: Request, res: Response) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(data.username);
      if (!user) {
        return sendError(res, "UNAUTHORIZED", "Invalid credentials", 401);
      }

      const hashedPassword = hashPassword(data.password);
      if (user.password !== hashedPassword) {
        return sendError(res, "UNAUTHORIZED", "Invalid credentials", 401);
      }

      const token = generateToken();
      await storage.createSession(token, user.id);

      sendSuccess(res, { user: omitPassword(user), token });
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, error.errors);
      }
      sendError(res, "SERVER_ERROR", "Failed to login", 500);
    }
  });

  app.post("/api/v1/auth/logout", authMiddleware, async (req: Request, res: Response) => {
    const token = (req as any).token;
    await storage.deleteSession(token);
    sendSuccess(res, { message: "Logged out successfully" });
  });

  // User Routes
  app.get("/api/v1/users", authMiddleware, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const sanitizedUsers = users.map(omitPassword);
      sendSuccess(res, sanitizedUsers, 200, { total: users.length });
    } catch (error) {
      sendError(res, "SERVER_ERROR", "Failed to fetch users", 500);
    }
  });

  app.get("/api/v1/users/me", authMiddleware, async (req: Request, res: Response) => {
    const user = (req as any).user;
    sendSuccess(res, omitPassword(user));
  });

  app.get("/api/v1/users/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return sendError(res, "NOT_FOUND", "User not found", 404);
      }
      sendSuccess(res, omitPassword(user));
    } catch (error) {
      sendError(res, "SERVER_ERROR", "Failed to fetch user", 500);
    }
  });

  app.delete("/api/v1/users/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as any).user;
      if (currentUser.id !== req.params.id) {
        return sendError(res, "FORBIDDEN", "Cannot delete other users", 403);
      }

      const deleted = await storage.deleteUser(req.params.id);
      if (!deleted) {
        return sendError(res, "NOT_FOUND", "User not found", 404);
      }
      sendSuccess(res, { message: "User deleted successfully" });
    } catch (error) {
      sendError(res, "SERVER_ERROR", "Failed to delete user", 500);
    }
  });

  // Project Routes
  app.get("/api/v1/projects", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const projects = await storage.getProjectsByOwner(user.id);
      sendSuccess(res, projects, 200, { total: projects.length });
    } catch (error) {
      sendError(res, "SERVER_ERROR", "Failed to fetch projects", 500);
    }
  });

  app.post("/api/v1/projects", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const data = insertProjectSchema.parse(req.body);
      
      const project = await storage.createProject({
        ...data,
        ownerId: user.id
      });
      
      sendSuccess(res, project, 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, error.errors);
      }
      sendError(res, "SERVER_ERROR", "Failed to create project", 500);
    }
  });

  app.get("/api/v1/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return sendError(res, "NOT_FOUND", "Project not found", 404);
      }
      
      if (project.ownerId !== user.id) {
        return sendError(res, "FORBIDDEN", "Access denied", 403);
      }
      
      sendSuccess(res, project);
    } catch (error) {
      sendError(res, "SERVER_ERROR", "Failed to fetch project", 500);
    }
  });

  app.patch("/api/v1/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const data = updateProjectSchema.parse(req.body);
      
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return sendError(res, "NOT_FOUND", "Project not found", 404);
      }
      
      if (project.ownerId !== user.id) {
        return sendError(res, "FORBIDDEN", "Access denied", 403);
      }
      
      const updated = await storage.updateProject(req.params.id, data);
      sendSuccess(res, updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, "VALIDATION_ERROR", "Invalid request body", 400, error.errors);
      }
      sendError(res, "SERVER_ERROR", "Failed to update project", 500);
    }
  });

  app.delete("/api/v1/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return sendError(res, "NOT_FOUND", "Project not found", 404);
      }
      
      if (project.ownerId !== user.id) {
        return sendError(res, "FORBIDDEN", "Access denied", 403);
      }
      
      await storage.deleteProject(req.params.id);
      sendSuccess(res, { message: "Project deleted successfully" });
    } catch (error) {
      sendError(res, "SERVER_ERROR", "Failed to delete project", 500);
    }
  });

  // Health check
  app.get("/api/v1/health", (req: Request, res: Response) => {
    sendSuccess(res, { status: "healthy", timestamp: new Date().toISOString() });
  });

  // WhatsApp Webhook Routes
  const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

  app.get("/webhooks/whatsapp", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"] as string;
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"] as string;

    if (mode === "subscribe" && WEBHOOK_VERIFY_TOKEN && token === WEBHOOK_VERIFY_TOKEN) {
      console.log("Webhook verified successfully");
      res.status(200).send(challenge);
    } else {
      console.log("Webhook verification failed", { mode, token });
      res.status(403).send("Forbidden");
    }
  });

  app.post("/webhooks/whatsapp", (req: Request, res: Response) => {
    const body = req.body;
    console.log("WhatsApp webhook received:", JSON.stringify(body, null, 2));
    
    if (body.object === "whatsapp_business_account") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.field === "messages") {
            const messages = change.value?.messages;
            if (messages) {
              messages.forEach((message: any) => {
                console.log("Message received:", {
                  from: message.from,
                  type: message.type,
                  text: message.text?.body,
                  timestamp: message.timestamp
                });
              });
            }
          }
        });
      });
    }
    
    res.status(200).send("EVENT_RECEIVED");
  });

  return httpServer;
}
