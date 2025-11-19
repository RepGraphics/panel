import { createError } from 'h3'
import { getServerSession } from '#auth'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { resolveSessionUser } from '~~/server/utils/auth/sessionUser'
import { accountProfileUpdateSchema } from '#shared/schema/account'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const user = resolveSessionUser(session)

  if (!user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readValidatedBody(event, payload => accountProfileUpdateSchema.parse(payload))

  const db = useDrizzle()

  try {
    const updates: Partial<typeof tables.users.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (body.username !== undefined)
      updates.username = body.username

    if (body.email !== undefined)
      updates.email = body.email

    await db.update(tables.users)
      .set(updates)
      .where(eq(tables.users.id, user.id))
      .run()

    const updatedUser = db
      .select({
        id: tables.users.id,
        username: tables.users.username,
        email: tables.users.email,
        role: tables.users.role,
      })
      .from(tables.users)
      .where(eq(tables.users.id, user.id))
      .get()

    if (!updatedUser)
      throw createError({ statusCode: 404, statusMessage: 'User not found after update' })

    return {
      data: updatedUser,
    }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to update profile'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
