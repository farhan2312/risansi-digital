// Every server error the portal throws, written somewhere a person can read.
//
// Next calls onRequestError for anything that throws on the server — a page
// render, a route handler, a server action, and crucially the framework code
// AROUND an action: argument decoding, looking the action up by id, and the
// re-render that follows it. None of that is reachable from inside the action,
// which is exactly the gap this fills.
//
// It exists because every tile on the landing dashboard answered 500 and there
// was no way to find out why. dashDrilldown catches its own errors and records
// them, the audit table stayed empty, and the only copy of the real message was
// a Vercel function log that nobody reading the dashboard can open. Now the
// portal keeps its own copy.
//
// Deliberately cheap and deliberately silent on failure: logging an error must
// never become a second error. It writes one row and swallows anything that
// goes wrong doing so.

export function register() {
  // Nothing to set up. The hook below is the whole point of this file.
}

type ErrorRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};
type ErrorContext = {
  routerKind: string;
  routePath: string;
  routeType: string;
  renderSource?: string;
  revalidateReason?: string;
};

export async function onRequestError(
  err: unknown,
  request: ErrorRequest,
  context: ErrorContext,
) {
  // The edge runtime has no pg driver and no connection to give it.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const e = err instanceof Error ? err : new Error(String(err));
  // Console first, so the record exists even if the database write fails.
  console.error('[onRequestError]', request.method, request.path, context.routeType, e);

  try {
    const { default: risansiPool } = await import('@/lib/db-risansi');
    const digest = (e as Error & { digest?: string }).digest ?? null;
    await risansiPool.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, entity_label, summary, metadata)
       VALUES ('server.error', 'request', $1, $2, $3, $4::jsonb)`,
      [
        context.routePath || request.path,
        `${request.method} ${request.path}`,
        `${e.name}: ${e.message}`.slice(0, 500),
        JSON.stringify({
          name: e.name,
          message: e.message,
          digest,
          // The head of the stack only: enough to name the frame that threw,
          // without putting a hundred lines of framework internals in a row
          // somebody has to read.
          stack: (e.stack ?? '').split('\n').slice(0, 20).join('\n'),
          cause: e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : null,
          method: request.method,
          path: request.path,
          // routeType is the one that answers "was this an action, a render or
          // a route handler" — the question this whole file was added for.
          ...context,
          // The action id, where there is one. A mismatch between the id the
          // browser sends and the ids this build knows is its own kind of
          // failure, and it is invisible without this.
          nextAction: typeof request.headers['next-action'] === 'string'
            ? request.headers['next-action'] : null,
        }),
      ],
    );
  } catch (logErr) {
    console.error('[onRequestError] could not record the error', logErr);
  }
}
