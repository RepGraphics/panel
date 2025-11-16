import { defineEventHandler } from 'h3'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import type { AdminUsersPayload } from '#shared/types/admin'

export default defineEventHandler((): AdminUsersPayload => {
  const db = useDrizzle()

  const rows = db.select().from(tables.users).all()
  const users = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    data: users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.nameFirst && user.nameLast
        ? `${user.nameFirst} ${user.nameLast}`
        : user.nameFirst || user.nameLast || '',
      role: user.rootAdmin ? 'admin' : 'user',
      createdAt: user.createdAt.toISOString(),
    })),
  }
})
