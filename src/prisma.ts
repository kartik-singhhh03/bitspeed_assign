import { PrismaClient } from "@prisma/client";

// Create a single Prisma client instance and reuse it across the app
const prisma = new PrismaClient();

export default prisma;
