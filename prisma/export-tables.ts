import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const [tables, connections] = await Promise.all([
	prisma.cafeTable.findMany({ orderBy: { code: 'asc' } }),
	prisma.tableConnection.findMany(),
]);

// id، createdAt و updatedAt عمدا حذف می‌شن؛ اینها رو دیتابیس خودش می‌سازه
// و اگه تو seed بمونن، روی دیتابیس تازه تداخل ایجاد می‌کنن
const clean = tables.map(({ id, createdAt, updatedAt, ...rest }) => rest);

const byId = Object.fromEntries(tables.map((t) => [t.id, t.code]));
const pairs = connections.map((c) => [byId[c.tableAId], byId[c.tableBId]]).filter(([a, b]) => a && b);

console.log('\tconst tableData = ' + JSON.stringify(clean, null, '\t').replace(/\n/g, '\n\t') + ';\n');
console.log('\tconst wantedConnections = ' + JSON.stringify(pairs) + ';\n');

await prisma.$disconnect();
