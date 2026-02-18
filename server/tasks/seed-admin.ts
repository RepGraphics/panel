import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { useDrizzle, tables, eq, and } from '#server/utils/drizzle'
import type { SeedUser } from "#shared/types/seed";

export default defineTask({
  meta: {
    name: "db:seed",
    description: "Run database seed task",
  },
  async run() {
    console.log("Running DB seed task...");
    const db = useDrizzle();

    const users: SeedUser[] = [
      {
        name: "John Doe",
        username: "john",
        email: "user@xyrapanel.com",
        password: "password123",
        avatar: "https://example.com/avatar/john.png",
        rootAdmin: true,
        role: "admin",
        permissions: [
          "admin.users.read",
          "admin.servers.read",
          "admin.nodes.read",
          "admin.locations.read",
          "admin.eggs.read",
          "admin.mounts.read",
          "admin.database-hosts.read",
          "admin.activity.read",
          "admin.settings.read",
        ],
      },
    ];

    const createdUsers: string[] = [];
    const updatedUsers: string[] = [];

    for (const user of users) {
      const existingUser = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.email, user.email),
        columns: { id: true }
      })

      const hashedPassword = await bcrypt.hash(user.password, 12)
      const [nameFirst, ...nameRest] = user.name.split(' ')
      const nameLast = nameRest.join(' ') || null
      const timestamp = new Date()

      if (existingUser) {
        const updateData = {
          username: user.username,
          displayUsername: user.username,
          email: user.email,
          password: hashedPassword,
          nameFirst,
          nameLast,
          language: 'en',
          rootAdmin: user.rootAdmin ?? false,
          role: user.role ?? (user.rootAdmin ? 'admin' : 'user'),
          image: user.avatar,
          updatedAt: timestamp,
        }

        if (existingUser) {
          await db.update(tables.users)
            .set(updateData)
            .where(eq(tables.users.id, existingUser.id))
        }

        const existingAccount = await db.query.accounts.findFirst({
          where: (acc, { and, eq }) => and(
            eq(acc.userId, existingUser.id),
            eq(acc.provider, 'credential')
          ),
          columns: { id: true }
        })

        const accountUpdateData = {
          password: hashedPassword,
          providerAccountId: existingUser.id,
          accountId: existingUser.id,
          providerId: 'credential',
          updatedAt: timestamp,
        }

        if (existingAccount) {
          await db.update(tables.accounts)
            .set(accountUpdateData)
            .where(eq(tables.accounts.id, existingAccount.id))
        }
        else {
          const accountId = randomUUID()
          const newAccountData = {
            id: accountId,
            userId: existingUser.id,
            type: 'credential',
            provider: 'credential',
            providerAccountId: existingUser.id,
            accountId: existingUser.id,
            providerId: 'credential',
            password: hashedPassword,
            createdAt: timestamp,
            updatedAt: timestamp,
          }

          await db.insert(tables.accounts).values(newAccountData)
        }

        updatedUsers.push(user.email)
        continue
      }

      const userId = randomUUID()
      const accountId = randomUUID()
      const userData = {
        id: userId,
        username: user.username,
        displayUsername: user.username,
        email: user.email,
        password: hashedPassword,
        nameFirst,
        nameLast,
        language: 'en',
        rootAdmin: user.rootAdmin ?? false,
        role: user.role ?? (user.rootAdmin ? 'admin' : 'user'),
        image: user.avatar,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      await db.insert(tables.users).values(userData)

      const accountData = {
        id: accountId,
        userId,
        type: 'credential',
        provider: 'credential',
        providerAccountId: userId,
        accountId: userId,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      await db.insert(tables.accounts).values(accountData)

      createdUsers.push(user.email)
    }

    return {
      result: createdUsers.length
        ? "created"
        : updatedUsers.length
          ? "updated"
          : "skipped",
      created: createdUsers,
      updated: updatedUsers,
    };
  },
});
