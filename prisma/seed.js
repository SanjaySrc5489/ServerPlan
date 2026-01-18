const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting database seed...\n');

    // Create default admin user
    const adminPassword = await bcrypt.hash('admin123', 12);

    const admin = await prisma.user.upsert({
        where: { username: 'admin' },
        update: {
            // Only update if already exists (keep password if already set)
            isActive: true,
            role: 'admin',
        },
        create: {
            username: 'admin',
            email: 'admin@parentguard.local',
            passwordHash: adminPassword,
            role: 'admin',
            isActive: true,
            permissions: JSON.stringify(['*']), // All permissions
            maxDevices: 999,
            signatureSecret: uuidv4(),
        },
    });

    console.log('✅ Admin user created/updated:');
    console.log(`   Username: admin`);
    console.log(`   Password: admin123 (change this immediately!)`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   ID: ${admin.id}\n`);

    // Link all existing devices to admin (for migration)
    const unassignedDevices = await prisma.device.findMany({
        where: { userId: null }
    });

    if (unassignedDevices.length > 0) {
        await prisma.device.updateMany({
            where: { userId: null },
            data: {
                userId: admin.id,
                linkedAt: new Date()
            }
        });
        console.log(`✅ Linked ${unassignedDevices.length} existing device(s) to admin user\n`);
    }

    // Create a sample client user (optional - for testing)
    const sampleClientPassword = await bcrypt.hash('client123', 12);

    const sampleClient = await prisma.user.upsert({
        where: { username: 'demo_client' },
        update: {},
        create: {
            username: 'demo_client',
            email: 'demo@parentguard.local',
            passwordHash: sampleClientPassword,
            role: 'client',
            isActive: true,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            permissions: JSON.stringify(['sms', 'calls', 'location', 'photos', 'notifications']), // Limited permissions
            maxDevices: 2,
            signatureSecret: uuidv4(),
            createdBy: admin.id,
        },
    });

    console.log('✅ Demo client user created:');
    console.log(`   Username: demo_client`);
    console.log(`   Password: client123`);
    console.log(`   Role: ${sampleClient.role}`);
    console.log(`   Expires: ${sampleClient.expiresAt?.toISOString()}`);
    console.log(`   Permissions: ${sampleClient.permissions}\n`);

    console.log('🎉 Database seed completed successfully!\n');
    console.log('Available feature permissions:');
    console.log('   sms, calls, location, photos, notifications, keylogs,');
    console.log('   apps, commands, recordings, files, stream, chat');
    console.log('\n   Use "*" for all permissions (admin only)');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
