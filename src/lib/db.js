const { PrismaClient } = require('@prisma/client');

/**
 * Singleton class for Prisma Client
 * Ensures only one connection pool is created for the entire application.
 */
class Database {
    constructor() {
        if (!Database.instance) {
            Database.instance = new PrismaClient({
                log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
            });
        }
    }

    getInstance() {
        return Database.instance;
    }
}

const db = new Database();
const prisma = db.getInstance();

module.exports = prisma;
