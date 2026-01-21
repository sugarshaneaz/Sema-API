import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

let adminToken: string;
let businessId: string;
let categoryId: string;
let itemId: string;

const testEmail = `test-${Date.now()}@example.com`;
const testPassword = "testpassword123";

async function fetchApi(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (adminToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  return { status: response.status, data };
}

describe("Business API", () => {
  beforeAll(async () => {
    const { status, data } = await fetchApi("/api/admin/register", {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Test User",
      }),
    });

    if (status === 201) {
      adminToken = data.token;
    } else {
      const loginRes = await fetchApi("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      adminToken = loginRes.data.token;
    }
  });

  describe("POST /api/admin/businesses", () => {
    it("should create a business", async () => {
      const { status, data } = await fetchApi("/api/admin/businesses", {
        method: "POST",
        body: JSON.stringify({
          type: "RETAIL",
          name: "Test Retail Store",
          phone: "+254700000000",
          address: "123 Test St",
        }),
      });

      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe("Test Retail Store");
      expect(data.type).toBe("RETAIL");
      businessId = data.id;
    });

    it("should require name", async () => {
      const { status, data } = await fetchApi("/api/admin/businesses", {
        method: "POST",
        body: JSON.stringify({ type: "RETAIL" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("name is required");
    });

    it("should require valid type", async () => {
      const { status, data } = await fetchApi("/api/admin/businesses", {
        method: "POST",
        body: JSON.stringify({ name: "Test", type: "INVALID" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("type is required");
    });
  });

  describe("GET /api/admin/businesses", () => {
    it("should list businesses", async () => {
      const { status, data } = await fetchApi("/api/admin/businesses");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/admin/businesses/:id", () => {
    it("should get business details", async () => {
      const { status, data } = await fetchApi(`/api/admin/businesses/${businessId}`);

      expect(status).toBe(200);
      expect(data.id).toBe(businessId);
      expect(data.catalogCategories).toBeDefined();
      expect(data.catalogItems).toBeDefined();
    });

    it("should return 404 for non-existent business", async () => {
      const { status } = await fetchApi("/api/admin/businesses/non-existent-id");

      expect(status).toBe(404);
    });
  });

  describe("POST /api/admin/businesses/:id/select", () => {
    it("should select a business as active", async () => {
      const { status, data } = await fetchApi(`/api/admin/businesses/${businessId}/select`, {
        method: "POST",
      });

      expect(status).toBe(200);
      expect(data.activeBusinessId).toBe(businessId);
    });
  });

  describe("Catalog Categories", () => {
    it("should create a category", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/categories`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Electronics",
            description: "Electronic devices",
            position: 0,
          }),
        }
      );

      expect(status).toBe(201);
      expect(data.name).toBe("Electronics");
      categoryId = data.id;
    });

    it("should list categories", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/categories`
      );

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("should update a category", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/categories/${categoryId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "Updated Electronics" }),
        }
      );

      expect(status).toBe(200);
      expect(data.name).toBe("Updated Electronics");
    });
  });

  describe("Catalog Items", () => {
    it("should create an item", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/items`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Test Product",
            price: 99.99,
            currency: "USD",
            categoryId,
          }),
        }
      );

      expect(status).toBe(201);
      expect(data.name).toBe("Test Product");
      expect(data.price).toBe(99.99);
      itemId = data.id;
    });

    it("should create item without price (for GOV type)", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/items`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Free Service",
          }),
        }
      );

      expect(status).toBe(201);
      expect(data.price).toBeNull();
    });

    it("should list items", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/items`
      );

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("should update an item", async () => {
      const { status, data } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/items/${itemId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ price: 149.99 }),
        }
      );

      expect(status).toBe(200);
      expect(data.price).toBe(149.99);
    });

    it("should delete an item", async () => {
      const { status } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/items/${itemId}`,
        { method: "DELETE" }
      );

      expect(status).toBe(200);
    });
  });

  describe("Delete Category", () => {
    it("should delete a category", async () => {
      const { status } = await fetchApi(
        `/api/admin/businesses/${businessId}/catalog/categories/${categoryId}`,
        { method: "DELETE" }
      );

      expect(status).toBe(200);
    });
  });

  describe("Ownership Enforcement", () => {
    it("should not allow access to another admin's business", async () => {
      const email2 = `test2-${Date.now()}@example.com`;
      const regRes = await fetchApi("/api/admin/register", {
        method: "POST",
        body: JSON.stringify({
          email: email2,
          password: testPassword,
          name: "Other Admin",
        }),
      });

      const otherToken = regRes.data.token;

      const { status } = await fetchApi(`/api/admin/businesses/${businessId}`, {
        headers: { Authorization: `Bearer ${otherToken}` },
      });

      expect(status).toBe(404);
    });
  });
});

describe("Backward Compatibility", () => {
  describe("Legacy Restaurant Endpoints", () => {
    it("GET /api/admin/me should include activeBusinessId", async () => {
      const { status, data } = await fetchApi("/api/admin/me");

      expect(status).toBe(200);
      expect("activeBusinessId" in data).toBe(true);
      expect("restaurantId" in data).toBe(true);
    });
  });
});
