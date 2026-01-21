import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function migrateRestaurantsToBusiness() {
  console.log("Starting Restaurant -> Business migration...");

  const restaurants = await prisma.restaurant.findMany({
    include: {
      admin: true,
      categories: {
        include: { menuItems: true },
      },
      menuItems: true,
      orders: true,
    },
  });

  console.log(`Found ${restaurants.length} restaurants to migrate`);

  for (const restaurant of restaurants) {
    const existingBusiness = await prisma.business.findUnique({
      where: { legacyRestaurantId: restaurant.id },
    });

    if (existingBusiness) {
      console.log(`Restaurant ${restaurant.id} already migrated to Business ${existingBusiness.id}, skipping...`);
      continue;
    }

    console.log(`Migrating restaurant: ${restaurant.name} (${restaurant.id})`);

    await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          ownerAdminId: restaurant.adminId,
          type: "RESTAURANT",
          name: restaurant.name,
          phone: restaurant.phone,
          address: restaurant.address,
          description: restaurant.description,
          logoUrl: restaurant.logoUrl,
          colors: restaurant.colors || {},
          settings: restaurant.settings || {},
          legacyRestaurantId: restaurant.id,
        },
      });

      console.log(`  Created Business: ${business.id}`);

      const categoryIdMap = new Map<string, string>();

      for (const category of restaurant.categories) {
        const catalogCategory = await tx.catalogCategory.create({
          data: {
            businessId: business.id,
            name: category.name,
            description: category.description,
            position: category.position,
            isActive: category.isActive,
          },
        });
        categoryIdMap.set(category.id, catalogCategory.id);
        console.log(`  Migrated category: ${category.name} -> ${catalogCategory.id}`);
      }

      for (const item of restaurant.menuItems) {
        const newCategoryId = item.categoryId ? categoryIdMap.get(item.categoryId) : null;

        await tx.catalogItem.create({
          data: {
            businessId: business.id,
            categoryId: newCategoryId || null,
            name: item.name,
            price: item.price,
            currency: item.currency,
            description: item.description,
            imageUrl: item.imageUrl,
            isAvailable: item.isAvailable,
            position: item.position,
            metadata: {},
          },
        });
        console.log(`  Migrated item: ${item.name}`);
      }

      if (restaurant.orders.length > 0) {
        await tx.order.updateMany({
          where: { restaurantId: restaurant.id },
          data: { businessId: business.id },
        });
        console.log(`  Linked ${restaurant.orders.length} orders to business`);
      }

      await tx.admin.update({
        where: { id: restaurant.adminId },
        data: { activeBusinessId: business.id },
      });
      console.log(`  Set activeBusinessId for admin ${restaurant.adminId}`);
    });

    console.log(`  Completed migration for restaurant: ${restaurant.name}`);
  }

  console.log("Migration complete!");
}

migrateRestaurantsToBusiness()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
