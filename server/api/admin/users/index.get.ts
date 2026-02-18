import { requireAdmin } from '#server/utils/security'
import { useDrizzle, tables } from '#server/utils/drizzle'
import type { UserOption } from '#shared/types/ui'

export default defineEventHandler(async (event): Promise<{ data: UserOption[] }> => {
  await requireAdmin(event)

  const query = getQuery(event)
  const searchValue = query.search as string | undefined
  const limit = query.limit ? Number.parseInt(String(query.limit), 10) : 100
  const offset = query.offset ? Number.parseInt(String(query.offset), 10) : 0

  const db = useDrizzle()

  try {
    const users = await db.query.users.findMany({
      columns: {
        id: true,
        username: true,
        email: true,
      },
      where: searchValue 
        ? (u, { or, like }) => or(
            like(u.email, `%${searchValue}%`),
            like(u.username, `%${searchValue}%`)
          )
        : undefined,
      orderBy: (u, { desc }) => [desc(u.createdAt)],
      limit,
      offset,
    })

    const userOptions: UserOption[] = users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email || undefined,
    }))

    return {
      data: userOptions,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list users'
    throw createError({
      status: 500,
      message,
    })
  }
})
