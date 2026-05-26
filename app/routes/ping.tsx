/**
 * Health-probe page
 *
 * This file is a small diagnostic route that proves the app can reach its D1
 * database end to end. Its loader reads the twenty most recent rows from the
 * `pings` table and lists them; its action inserts a new ping, optionally
 * tagged with a short note trimmed to a safe length, then reloads the list.
 * It exists purely to confirm reads and writes work against the live database
 * — it carries no authentication and no business logic.
 *
 * @version v0.1.0
 */

import type { Route } from "./+types/ping";
import { Form, redirect } from "react-router";
import { desc } from "drizzle-orm";
import { cloudflareContext } from "~/context";
import { getDb, schema } from "~/db/client.server";
import { logError } from "~/lib/logging.server";

const LAST_N = 20;
const NOTE_MAX = 500;

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const db = getDb(env);
  const rows = await db
    .select()
    .from(schema.pings)
    .orderBy(desc(schema.pings.createdAt))
    .limit(LAST_N)
    .all();
  return { rows };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const rawNote = form.get("note");
  const note =
    typeof rawNote === "string" && rawNote.length > 0
      ? rawNote.slice(0, NOTE_MAX)
      : null;

  try {
    const { env } = context.get(cloudflareContext);
    const db = getDb(env);
    await db.insert(schema.pings).values({
      note,
      createdAt: Date.now(),
    });
  } catch (err) {
    logError(err, { action: "ping.create", noteLength: note?.length ?? 0 });
    throw new Response("Failed to insert ping", { status: 500 });
  }

  return redirect("/ping");
}

export default function Ping({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;
  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1 className="text-2xl font-semibold">Ping</h1>
      <p className="mt-2">
        Last {LAST_N} rows from the <code>pings</code> table.
      </p>
      <Form method="post" className="mt-4 flex gap-2">
        <label htmlFor="note" className="sr-only">
          Note
        </label>
        <input
          id="note"
          name="note"
          type="text"
          maxLength={500}
          placeholder="Optional note…"
          className="border rounded px-2 py-1 flex-1"
        />
        <button type="submit" className="border rounded px-3 py-1 underline">
          Insert ping
        </button>
      </Form>
      <ul className="mt-6 space-y-1">
        {rows.length === 0 ? (
          <li className="italic">No pings yet.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="font-mono text-sm">
              #{r.id} — {new Date(r.createdAt).toISOString()} —{" "}
              {r.note ?? "(no note)"}
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
