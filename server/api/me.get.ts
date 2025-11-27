import { createError } from 'h3'
import { getServerSession, getSessionUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const user = getSessionUser(session)

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  return {
    data: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  }
})
