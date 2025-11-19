import { createError } from 'h3'
import { getServerSession } from '#auth'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { resolveSessionUser } from '~~/server/utils/auth/sessionUser'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const resolvedUser = resolveSessionUser(session)

  if (!resolvedUser?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = useDrizzle()

  const user = db
    .select({
      id: tables.users.id,
      username: tables.users.username,
      email: tables.users.email,
      role: tables.users.role,
    })
    .from(tables.users)
    .where(eq(tables.users.id, resolvedUser.id))
    .get()

  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  return { data: user }
})
