import { t, getUserLang } from './i18n.js'

/**
 * Route-level preHandler for the global catalog (categories, tags). Every user
 * may create entries, but changing, deleting or merging one rewrites every
 * user's transactions, recurring rules and budgets, so those stay with the
 * administrator. Non-admins get 403.
 */
export async function catalogAdminOnly(request, reply) {
  if (request.user?.role === 'admin') return
  const lang = await getUserLang(this.db, request.user?.userId)
  reply.code(403).send({ error: t('errors.catalog_admin_only', {}, lang) })
  return reply
}
