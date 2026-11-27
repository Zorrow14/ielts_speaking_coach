/**
 * Review mode. The queue is fetched on the server, already filtered to what is
 * actually due for this user.
 */
import Link from "next/link";
import { auth } from "@/auth";
import VocabReview from "@/components/VocabReview";
import { ensureUser } from "@/lib/db/users";
import { dueForReview } from "@/lib/db/vocab";

export default async function VocabReviewPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to review your notebook.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));

  const queue = await dueForReview(userId);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Review</h1>
        <p className="muted">
          {queue.length === 0
            ? "Nothing is due right now."
            : `${queue.length} ${queue.length === 1 ? "phrase" : "phrases"} due.`}
        </p>
      </header>

      <VocabReview queue={queue} />

      <Link className="button button--quiet" href="/vocab">
        Back to the notebook
      </Link>
    </main>
  );
}
