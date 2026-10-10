/**
 * Opportunities belonging to a client that still exists.
 *
 * Archiving a client has to take its opportunities with it. They have no
 * archived state of their own — and giving them one would mean a second flag to
 * keep in step with the client's, which would drift the first time somebody
 * restored a client and the pipeline came back half empty. So the client is the
 * single source of truth and every list or aggregate over opportunities asks it.
 *
 * EXISTS rather than a join: the queries this goes into already join clients
 * under a dozen different aliases, or not at all, and adding another join risks
 * fanning a row out and double-counting money.
 *
 * Single-record reads (`WHERE id = $1`) and reads already scoped to one client
 * do NOT need this. An archived client's own pages are unreachable, and a
 * specific opportunity fetched by id is reached from somewhere that was already
 * filtered. It is the lists and the sums that would otherwise still carry it.
 *
 * scripts/opportunity-scope-check.mjs enforces that; it runs in the build.
 *
 * @param alias The opportunities alias in the query — 'o' in `FROM opportunities o`.
 */
export const LIVE_CLIENT = (alias = 'o') =>
  `EXISTS (SELECT 1 FROM clients lc WHERE lc.id = ${alias}.client_id AND lc.deleted_at IS NULL)`;

/** The same thing as an ` AND …` fragment, for appending to an existing WHERE. */
export const AND_LIVE_CLIENT = (alias = 'o') => ` AND ${LIVE_CLIENT(alias)}`;
