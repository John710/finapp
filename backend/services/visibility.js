/**
 * Entity visibility resolution for family sharing.
 * A user sees their own entities plus entities shared to them directly or
 * to the whole family (shared_with IS NULL). All helpers return plain id
 * arrays usable with = ANY($n).
 */

// A share only counts while its owner_id still owns the account — a stale or
// forged grant for someone else's account must not expose it.
export async function visibleAccountIds(db, userId) {
  const { rows } = await db.query(
    `SELECT id FROM accounts WHERE user_id = $1
     UNION
     SELECT a.id FROM entity_shares es
     JOIN accounts a ON a.id = es.entity_id AND a.user_id = es.owner_id
     WHERE es.entity_type = 'account' AND es.owner_id <> $1
       AND (es.shared_with = $1 OR es.shared_with IS NULL)`,
    [userId]
  )
  return rows.map(r => r.id)
}

// Accounts (not owned by the user) the user may WRITE to
export async function editableSharedAccountIds(db, userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT a.id FROM entity_shares es
     JOIN accounts a ON a.id = es.entity_id AND a.user_id = es.owner_id
     WHERE es.entity_type = 'account' AND es.permission = 'edit' AND es.owner_id <> $1
       AND (es.shared_with = $1 OR es.shared_with IS NULL)`,
    [userId]
  )
  return rows.map(r => r.id)
}

// When an account has both a family-wide and a personal grant for the user,
// the most permissive one wins — the same rule canModifyTransaction() and
// editableSharedAccountIds() apply and the account list shows.
const SHARE_PERMISSION = `(SELECT es.permission FROM entity_shares es
                      WHERE es.entity_type = 'account' AND es.entity_id = a.id
                        AND es.owner_id = a.user_id
                        AND (es.shared_with = $1 OR es.shared_with IS NULL)
                      ORDER BY (es.permission = 'edit') DESC
                      LIMIT 1)`

/**
 * Resolve one account for a write operation. Returns the account row (with
 * owner_id) when the user may create transactions on it, else null.
 */
export async function accountForWrite(db, userId, accountId) {
  const { rows } = await db.query(
    `SELECT a.id, a.user_id AS owner_id, a.currency, a.type,
            CASE WHEN a.user_id = $1 THEN 'own'
                 ELSE COALESCE(${SHARE_PERMISSION}, 'none') END AS access
     FROM accounts a WHERE a.id = $2`,
    [userId, accountId]
  )
  const acc = rows[0]
  if (!acc || acc.access === 'none' || acc.access === 'view') return null
  return acc
}

/** Read access check for one account (any permission). */
export async function accountForRead(db, userId, accountId) {
  const { rows } = await db.query(
    `SELECT a.id, a.user_id AS owner_id,
            CASE WHEN a.user_id = $1 THEN 'own'
                 ELSE COALESCE(${SHARE_PERMISSION}, 'none') END AS access
     FROM accounts a WHERE a.id = $2`,
    [userId, accountId]
  )
  const acc = rows[0]
  if (!acc || acc.access === 'none') return null
  return acc
}

/**
 * Can the user modify an existing transaction row? They can when they own it
 * or when its account is shared with them with edit permission.
 */
export async function canModifyTransaction(db, userId, tx) {
  if (tx.user_id === userId) return true
  const acc = await db.query(
    `SELECT 1 FROM entity_shares
     WHERE entity_type = 'account' AND entity_id = $1 AND owner_id = $2
       AND permission = 'edit' AND (shared_with = $3 OR shared_with IS NULL)`,
    [tx.account_id, tx.user_id, userId]
  )
  return acc.rows.length > 0
}
