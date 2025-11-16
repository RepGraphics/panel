import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useDrizzle, tables, eq } from './drizzle'

export async function requireAdmin(event: H3Event): Promise<void> {
  const { getServerSession } = await import('#auth')
  const session = await getServerSession(event)

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized',
    })
  }

  const db = useDrizzle()

  const user = db
    .select()
    .from(tables.users)
    .where(eq(tables.users.email, session.user.email!))
    .get()

  if (!user || !user.rootAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Admin access required',
    })
  }
}
