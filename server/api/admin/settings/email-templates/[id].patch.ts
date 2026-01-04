import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Template ID is required',
    })
  }

  const body = await readBody(event)
  if (!body.content || typeof body.content !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Template content is required',
    })
  }

  try {
    const db = useDrizzle()
    const now = new Date()
    
    db.update(tables.emailTemplates)
      .set({
        htmlContent: body.content,
        updatedAt: now,
      })
      .where(eq(tables.emailTemplates.templateId, id))
      .run()

    return {
      id,
      message: 'Template updated successfully',
      updatedAt: now,
    }
  }
  catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to update template: ${err instanceof Error ? err.message : 'Unknown error'}`,
    })
  }
})
