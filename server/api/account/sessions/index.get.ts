import { createError, parseCookies, getRequestIP, getHeader, getRequestFingerprint } from 'h3'
import { getServerSession } from '#auth'
import type { AccountSessionRow, SessionMetadataUpsertInput, UserSessionSummary, AccountSessionsResponse } from '#shared/types/auth'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { resolveSessionUser } from '~~/server/utils/auth/sessionUser'

function parseUserAgent(userAgent: string | null | undefined) {
  const ua = userAgent ?? ''
  if (!ua) {
    return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' }
  }

  const normalized = ua.toLowerCase()

  let browser = 'Unknown'
  if (/firefox\/[\d.]+/i.test(ua)) browser = 'Firefox'
  else if (/edg(e|a|ios)?\/[\d.]+/i.test(ua)) browser = 'Microsoft Edge'
  else if (/opr\/[\d.]+/i.test(ua) || /opera/i.test(ua)) browser = 'Opera'
  else if (/chrome\/[\d.]+/i.test(ua) && !/edg\//i.test(ua) && !/opr\//i.test(ua)) browser = 'Chrome'
  else if (/crios\/[\d.]+/i.test(ua)) browser = 'Chrome iOS'
  else if (/safari\/[\d.]+/i.test(ua) && /version\/[\d.]+/i.test(ua)) browser = 'Safari'
  else if (/msie|trident/i.test(ua)) browser = 'Internet Explorer'
  else if (/brave/i.test(ua)) browser = 'Brave'

  let os = 'Unknown'
  if (/windows nt 10\.0|windows nt 11\.0/i.test(normalized)) os = 'Windows'
  else if (/windows nt 6\.3/i.test(normalized)) os = 'Windows 8.1'
  else if (/windows nt 6\.2/i.test(normalized)) os = 'Windows 8'
  else if (/windows nt 6\.1/i.test(normalized)) os = 'Windows 7'
  else if (/mac os x 10[._]\d+/i.test(ua)) os = 'macOS'
  else if (/cros/i.test(ua)) os = 'ChromeOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/linux/i.test(ua)) os = 'Linux'

  let device = 'Desktop'
  if (/ipad|tablet/i.test(ua)) device = 'Tablet'
  else if (/mobile|iphone|ipod|android/i.test(ua)) device = 'Mobile'
  else if (/bot|crawler|spider/i.test(ua)) device = 'Bot'

  return { browser, os, device }
}

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const resolvedUser = resolveSessionUser(session)
  const db = useDrizzle()

  if (!resolvedUser?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  let metadataAvailable = true
  let rows: AccountSessionRow[]

  try {
    rows = db.select({
      sessionToken: tables.sessions.sessionToken,
      expires: tables.sessions.expires,
      metadataIp: tables.sessionMetadata.ipAddress,
      metadataUserAgent: tables.sessionMetadata.userAgent,
      metadataDevice: tables.sessionMetadata.deviceName,
      metadataBrowser: tables.sessionMetadata.browserName,
      metadataOs: tables.sessionMetadata.osName,
      firstSeenAt: tables.sessionMetadata.firstSeenAt,
      lastSeenAt: tables.sessionMetadata.lastSeenAt,
    })
      .from(tables.sessions)
      .leftJoin(tables.sessionMetadata, eq(tables.sessionMetadata.sessionToken, tables.sessions.sessionToken))
      .where(eq(tables.sessions.userId, resolvedUser.id))
      .all()
  }
  catch (error) {
    // If the session metadata table is missing (migration not applied yet), fall back to basic session info.
    if (error instanceof Error && /session_metadata/i.test(error.message ?? '')) {
      metadataAvailable = false
      rows = db.select({
        sessionToken: tables.sessions.sessionToken,
        expires: tables.sessions.expires,
      })
        .from(tables.sessions)
        .where(eq(tables.sessions.userId, resolvedUser.id))
        .all()
    }
    else {
      throw error
    }
  }

  const cookies = parseCookies(event)
  const currentToken = cookies['authjs.session-token']
    ?? cookies['next-auth.session-token']
    ?? cookies['__Secure-next-auth.session-token']

  const currentIp = getRequestIP(event) || null
  const currentUserAgent = getHeader(event, 'user-agent') || ''
  let currentFingerprint: string | null = null
  try {
    currentFingerprint = await getRequestFingerprint(event)
  }
  catch {
    currentFingerprint = null
  }

  const metadataUpserts: SessionMetadataUpsertInput[] = []

  const data: UserSessionSummary[] = rows.map((row) => {
    const expiresDate = row.expires instanceof Date
      ? row.expires
      : new Date(row.expires)

    const isCurrent = row.sessionToken === currentToken

    let ipAddress = row.metadataIp || null
    let userAgent = row.metadataUserAgent || ''
    let browser = row.metadataBrowser || ''
    let os = row.metadataOs || ''
    let device = row.metadataDevice || ''

    const firstSeenDate = row.firstSeenAt instanceof Date
      ? row.firstSeenAt
      : row.firstSeenAt
        ? new Date(row.firstSeenAt)
        : null

    const lastSeenDate = row.lastSeenAt instanceof Date
      ? row.lastSeenAt
      : row.lastSeenAt
        ? new Date(row.lastSeenAt)
        : null

    if (isCurrent) {
      if (!ipAddress && currentIp)
        ipAddress = currentIp
      if (!userAgent && currentUserAgent)
        userAgent = currentUserAgent
    }

    const parsedInfo = parseUserAgent(userAgent)
    if (!browser)
      browser = parsedInfo.browser
    if (!os)
      os = parsedInfo.os
    if (!device)
      device = parsedInfo.device

    if (
      isCurrent &&
      metadataAvailable &&
      userAgent &&
      (
        !row.metadataUserAgent ||
        !row.metadataIp ||
        !row.metadataBrowser ||
        !row.metadataOs ||
        !row.metadataDevice
      )
    ) {
      metadataUpserts.push({
        sessionToken: row.sessionToken,
        ipAddress,
        userAgent,
        deviceName: device || null,
        browserName: browser || null,
        osName: os || null,
        firstSeenAt: firstSeenDate,
      })
    }

    return {
      token: row.sessionToken,
      issuedAt: new Date(expiresDate.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString(),
      expiresAt: expiresDate.toISOString(),
      expiresAtTimestamp: expiresDate.getTime(),
      isCurrent,
      ipAddress: ipAddress || 'Unknown',
      userAgent: userAgent || 'Unknown',
      browser,
      os,
      device,
      lastSeenAt: lastSeenDate ? lastSeenDate.toISOString() : null,
      firstSeenAt: firstSeenDate ? firstSeenDate.toISOString() : null,
      fingerprint: isCurrent ? currentFingerprint : null,
    }
  })

  if (metadataAvailable && metadataUpserts.length) {
    const now = new Date()
    await Promise.all(metadataUpserts.map((entry) =>
      db.insert(tables.sessionMetadata).values({
        sessionToken: entry.sessionToken,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        deviceName: entry.deviceName,
        browserName: entry.browserName,
        osName: entry.osName,
        firstSeenAt: entry.firstSeenAt ?? now,
        lastSeenAt: now,
      }).onConflictDoUpdate({
        target: tables.sessionMetadata.sessionToken,
        set: {
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          deviceName: entry.deviceName,
          browserName: entry.browserName,
          osName: entry.osName,
          lastSeenAt: now,
        },
      })
    ))
  }

  const response: AccountSessionsResponse = {
    data,
    currentToken: currentToken ?? null,
  }

  return response
})
