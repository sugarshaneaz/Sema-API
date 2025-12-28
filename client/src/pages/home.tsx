import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  ChevronDown, 
  ChevronRight, 
  Copy, 
  Check, 
  Lock, 
  Zap,
  Server,
  Shield,
  Code2,
  BookOpen
} from "lucide-react";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  auth: boolean;
  requestBody?: object;
  responseExample: object;
  parameters?: { name: string; type: string; description: string; required: boolean }[];
}

interface EndpointGroup {
  name: string;
  description: string;
  endpoints: Endpoint[];
}

const methodColors: Record<string, string> = {
  GET: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  POST: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  PUT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PATCH: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  DELETE: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

const apiGroups: EndpointGroup[] = [
  {
    name: "Authentication",
    description: "User registration and login endpoints",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/auth/register",
        description: "Register a new user account",
        auth: false,
        requestBody: {
          username: "johndoe",
          email: "john@example.com",
          password: "securePassword123"
        },
        responseExample: {
          success: true,
          data: {
            user: {
              id: "550e8400-e29b-41d4-a716-446655440000",
              username: "johndoe",
              email: "john@example.com",
              createdAt: "2024-01-15T10:30:00.000Z"
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          }
        }
      },
      {
        method: "POST",
        path: "/api/v1/auth/login",
        description: "Authenticate and receive access token",
        auth: false,
        requestBody: {
          username: "johndoe",
          password: "securePassword123"
        },
        responseExample: {
          success: true,
          data: {
            user: {
              id: "550e8400-e29b-41d4-a716-446655440000",
              username: "johndoe",
              email: "john@example.com",
              createdAt: "2024-01-15T10:30:00.000Z"
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          }
        }
      },
      {
        method: "POST",
        path: "/api/v1/auth/logout",
        description: "Invalidate current session token",
        auth: true,
        responseExample: {
          success: true,
          data: { message: "Logged out successfully" }
        }
      }
    ]
  },
  {
    name: "Users",
    description: "User management endpoints",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/users",
        description: "List all users",
        auth: true,
        responseExample: {
          success: true,
          data: [
            {
              id: "550e8400-e29b-41d4-a716-446655440000",
              username: "johndoe",
              email: "john@example.com",
              createdAt: "2024-01-15T10:30:00.000Z"
            }
          ],
          meta: { total: 1, page: 1, limit: 20 }
        }
      },
      {
        method: "GET",
        path: "/api/v1/users/:id",
        description: "Get a specific user by ID",
        auth: true,
        parameters: [
          { name: "id", type: "string", description: "User UUID", required: true }
        ],
        responseExample: {
          success: true,
          data: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            username: "johndoe",
            email: "john@example.com",
            createdAt: "2024-01-15T10:30:00.000Z"
          }
        }
      },
      {
        method: "GET",
        path: "/api/v1/users/me",
        description: "Get current authenticated user",
        auth: true,
        responseExample: {
          success: true,
          data: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            username: "johndoe",
            email: "john@example.com",
            createdAt: "2024-01-15T10:30:00.000Z"
          }
        }
      },
      {
        method: "DELETE",
        path: "/api/v1/users/:id",
        description: "Delete a user account",
        auth: true,
        parameters: [
          { name: "id", type: "string", description: "User UUID", required: true }
        ],
        responseExample: {
          success: true,
          data: { message: "User deleted successfully" }
        }
      }
    ]
  },
  {
    name: "Projects",
    description: "Project CRUD operations",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/projects",
        description: "List all projects for authenticated user",
        auth: true,
        responseExample: {
          success: true,
          data: [
            {
              id: "660e8400-e29b-41d4-a716-446655440001",
              name: "My Project",
              description: "A sample project",
              ownerId: "550e8400-e29b-41d4-a716-446655440000",
              createdAt: "2024-01-16T14:20:00.000Z",
              updatedAt: "2024-01-16T14:20:00.000Z"
            }
          ],
          meta: { total: 1 }
        }
      },
      {
        method: "POST",
        path: "/api/v1/projects",
        description: "Create a new project",
        auth: true,
        requestBody: {
          name: "My New Project",
          description: "Project description here"
        },
        responseExample: {
          success: true,
          data: {
            id: "660e8400-e29b-41d4-a716-446655440002",
            name: "My New Project",
            description: "Project description here",
            ownerId: "550e8400-e29b-41d4-a716-446655440000",
            createdAt: "2024-01-16T15:00:00.000Z",
            updatedAt: "2024-01-16T15:00:00.000Z"
          }
        }
      },
      {
        method: "GET",
        path: "/api/v1/projects/:id",
        description: "Get a specific project by ID",
        auth: true,
        parameters: [
          { name: "id", type: "string", description: "Project UUID", required: true }
        ],
        responseExample: {
          success: true,
          data: {
            id: "660e8400-e29b-41d4-a716-446655440001",
            name: "My Project",
            description: "A sample project",
            ownerId: "550e8400-e29b-41d4-a716-446655440000",
            createdAt: "2024-01-16T14:20:00.000Z",
            updatedAt: "2024-01-16T14:20:00.000Z"
          }
        }
      },
      {
        method: "PATCH",
        path: "/api/v1/projects/:id",
        description: "Update an existing project",
        auth: true,
        parameters: [
          { name: "id", type: "string", description: "Project UUID", required: true }
        ],
        requestBody: {
          name: "Updated Project Name",
          description: "Updated description"
        },
        responseExample: {
          success: true,
          data: {
            id: "660e8400-e29b-41d4-a716-446655440001",
            name: "Updated Project Name",
            description: "Updated description",
            ownerId: "550e8400-e29b-41d4-a716-446655440000",
            createdAt: "2024-01-16T14:20:00.000Z",
            updatedAt: "2024-01-16T16:45:00.000Z"
          }
        }
      },
      {
        method: "DELETE",
        path: "/api/v1/projects/:id",
        description: "Delete a project",
        auth: true,
        parameters: [
          { name: "id", type: "string", description: "Project UUID", required: true }
        ],
        responseExample: {
          success: true,
          data: { message: "Project deleted successfully" }
        }
      }
    ]
  }
];

function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-muted/50 dark:bg-muted/30 rounded-md p-4 overflow-x-auto text-sm font-mono">
        <code className="text-foreground/90">{code}</code>
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
        data-testid="button-copy-code"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div 
          className="flex items-center gap-3 p-4 hover-elevate active-elevate-2 cursor-pointer rounded-md border border-border/50"
          data-testid={`endpoint-${endpoint.method.toLowerCase()}-${endpoint.path.replace(/\//g, '-')}`}
        >
          <Badge 
            variant="outline" 
            className={`${methodColors[endpoint.method]} font-mono text-xs min-w-[60px] justify-center`}
          >
            {endpoint.method}
          </Badge>
          <code className="font-mono text-sm flex-1">{endpoint.path}</code>
          {endpoint.auth && (
            <Lock className="h-4 w-4 text-muted-foreground" />
          )}
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-4 pr-4 pb-4 space-y-4 border-x border-b border-border/50 rounded-b-md -mt-1">
          <p className="text-muted-foreground text-sm pt-4">{endpoint.description}</p>
          
          {endpoint.auth && (
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">Requires authentication token in header</span>
            </div>
          )}
          
          {endpoint.parameters && endpoint.parameters.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Parameters</h4>
              <div className="space-y-1">
                {endpoint.parameters.map((param) => (
                  <div key={param.name} className="flex items-center gap-2 text-sm">
                    <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{param.name}</code>
                    <span className="text-muted-foreground">{param.type}</span>
                    {param.required && <Badge variant="outline" className="text-xs">required</Badge>}
                    <span className="text-muted-foreground">- {param.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Tabs defaultValue={endpoint.requestBody ? "request" : "response"} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              {endpoint.requestBody && <TabsTrigger value="request">Request Body</TabsTrigger>}
              <TabsTrigger value="response" className={endpoint.requestBody ? "" : "col-span-2"}>Response</TabsTrigger>
            </TabsList>
            {endpoint.requestBody && (
              <TabsContent value="request" className="mt-3">
                <CodeBlock code={JSON.stringify(endpoint.requestBody, null, 2)} />
              </TabsContent>
            )}
            <TabsContent value="response" className="mt-3">
              <CodeBlock code={JSON.stringify(endpoint.responseExample, null, 2)} />
            </TabsContent>
          </Tabs>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EndpointGroupSection({ group }: { group: EndpointGroup }) {
  return (
    <div className="space-y-3" id={group.name.toLowerCase()}>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{group.name}</h2>
        <p className="text-muted-foreground text-sm">{group.description}</p>
      </div>
      <div className="space-y-2">
        {group.endpoints.map((endpoint, idx) => (
          <EndpointCard key={idx} endpoint={endpoint} />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-md">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold" data-testid="text-api-title">Express API</h1>
                <p className="text-xs text-muted-foreground">v1.0.0</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Zap className="h-3 w-3" />
                Live
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <aside className="lg:col-span-1">
            <div className="sticky top-24 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Navigation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <ScrollArea className="h-auto">
                    {apiGroups.map((group) => (
                      <a
                        key={group.name}
                        href={`#${group.name.toLowerCase()}`}
                        className="block py-2 px-3 text-sm hover-elevate rounded-md transition-colors"
                        data-testid={`link-nav-${group.name.toLowerCase()}`}
                      >
                        {group.name}
                      </a>
                    ))}
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Code2 className="h-4 w-4" />
                    Base URL
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1
                  </code>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Authentication
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Include the token in the Authorization header:
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono block">
                    Authorization: Bearer &lt;token&gt;
                  </code>
                </CardContent>
              </Card>
            </div>
          </aside>

          <main className="lg:col-span-3 space-y-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold">API Reference</h1>
                <p className="text-muted-foreground">
                  Complete reference documentation for the Express TypeScript API. 
                  This API provides user authentication, user management, and project CRUD operations.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-500/10 rounded-md">
                      <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Secure</p>
                      <p className="text-xs text-muted-foreground">Token-based auth</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-md">
                      <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Fast</p>
                      <p className="text-xs text-muted-foreground">In-memory storage</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-md">
                      <Code2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">RESTful</p>
                      <p className="text-xs text-muted-foreground">Standard patterns</p>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Response Format</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-green-600 dark:text-green-400">Success Response</h4>
                  <CodeBlock 
                    code={JSON.stringify({
                      success: true,
                      data: "...",
                      meta: { total: 10, page: 1, limit: 20 }
                    }, null, 2)} 
                  />
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-red-600 dark:text-red-400">Error Response</h4>
                  <CodeBlock 
                    code={JSON.stringify({
                      success: false,
                      error: {
                        code: "VALIDATION_ERROR",
                        message: "Invalid request body",
                        details: { field: "email", issue: "Invalid email format" }
                      }
                    }, null, 2)} 
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">HTTP Status Codes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { code: "200", desc: "OK - Successful GET/PUT/PATCH", color: "text-green-600 dark:text-green-400" },
                    { code: "201", desc: "Created - Successful POST", color: "text-green-600 dark:text-green-400" },
                    { code: "204", desc: "No Content - Successful DELETE", color: "text-green-600 dark:text-green-400" },
                    { code: "400", desc: "Bad Request - Validation error", color: "text-amber-600 dark:text-amber-400" },
                    { code: "401", desc: "Unauthorized - Auth required", color: "text-red-600 dark:text-red-400" },
                    { code: "403", desc: "Forbidden - Access denied", color: "text-red-600 dark:text-red-400" },
                    { code: "404", desc: "Not Found - Resource missing", color: "text-red-600 dark:text-red-400" },
                    { code: "500", desc: "Server Error", color: "text-red-600 dark:text-red-400" },
                  ].map((status) => (
                    <div key={status.code} className="flex items-center gap-3 text-sm">
                      <code className={`font-mono font-semibold ${status.color}`}>{status.code}</code>
                      <span className="text-muted-foreground">{status.desc}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {apiGroups.map((group) => (
              <EndpointGroupSection key={group.name} group={group} />
            ))}
          </main>
        </div>
      </div>
    </div>
  );
}
