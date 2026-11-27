import Link from "next/link";

/**
 * NOT LEGAL ADVICE.
 *
 * Same caveat as the privacy page: this is a short, honest description of what
 * using the app means, written by someone reading the code, not a
 * lawyer-drafted terms of service. It has no liability cap, no governing-law
 * clause and no dispute-resolution process, because inventing those without
 * advice would be worse than leaving them out. If this app ever takes money or
 * has real users, get it reviewed.
 *
 * The IELTS trademark disclaimer is here because the app's name uses the word.
 * Keep it.
 */

export const metadata = {
  title: "Terms",
  description: "What using this app means, in short.",
};

const CONTACT_URL = "https://github.com/Zorrow14/ielts_speaking_coach/issues";

export default function TermsPage() {
  return (
    <main className="shell prose">
      <header className="shell__header">
        <h1>Terms</h1>
        <p className="muted">Short, because there is not much to say.</p>
      </header>

      <section className="card">
        <h2>What this is</h2>
        <p>
          A personal practice tool that records a spoken answer, sends it to an
          AI model, and gives you a transcript plus feedback. It is free to try
          as a guest, with limits. It is not a product, there is no account, no
          payment and no guarantee that it will be working tomorrow.
        </p>
      </section>

      <section className="card">
        <h2>The scores are estimates</h2>
        <p>
          Every band shown is an estimate produced by an AI model. They are not
          official IELTS bands, they are not produced by a certified examiner,
          and they can be wrong &mdash; sometimes by a full band. Pronunciation
          in particular is an indicator only, judged from audio quality, and is
          the least reliable of the four.
        </p>
        <p>
          <strong>
            Do not use these scores to decide whether you are ready to sit the
            real test.
          </strong>{" "}
          Use them to find mistakes worth practising.
        </p>
      </section>

      <section className="card">
        <h2>Not affiliated with IELTS</h2>
        <p>
          This app is not affiliated with, endorsed by, sponsored by or
          connected to IELTS, the British Council, IDP Education, or Cambridge
          University Press and Assessment. &ldquo;IELTS&rdquo; is used here only
          to describe the format of the practice being simulated. All trademarks
          belong to their owners.
        </p>
      </section>

      <section className="card">
        <h2>Your audio goes to Google</h2>
        <p>
          The marking is done by Google&apos;s Gemini API, so your audio is sent
          there. What Google may do with it depends on which tier this app is
          using, and the <Link href="/privacy">privacy page</Link> says plainly
          which one that is and what it means. Read it before you record
          anything.
        </p>
        <p>
          This app does not store your audio. In guest mode it stores no
          transcript or feedback either.
        </p>
      </section>

      <section className="card">
        <h2>Fair use</h2>
        <p>Please do not:</p>
        <ul className="bullets">
          <li>
            run scripts against it, or try to get around the guest limits or the
            automated-traffic check
          </li>
          <li>
            upload audio of someone who has not agreed to it, or anything
            unlawful
          </li>
          <li>
            treat it as a service you can build something else on top of
          </li>
        </ul>
        <p className="muted">
          Guest access can be withdrawn at any time, for any reason or none,
          including turning the whole feature off.
        </p>
      </section>

      <section className="card">
        <h2>No warranty</h2>
        <p>
          This is provided as-is, with no warranty of any kind. It may be
          unavailable, it may lose your in-progress answer, and its feedback may
          be wrong. Since nothing is stored in guest mode, there is nothing to
          lose except the results in your current tab &mdash; download them if
          you want to keep them.
        </p>
      </section>

      <section className="card">
        <h2>Contact</h2>
        <p>
          <a href={CONTACT_URL} rel="noreferrer noopener" target="_blank">
            Open an issue on GitHub
          </a>
          .
        </p>
      </section>

      <section className="card">
        <div className="row">
          <Link className="button button--quiet" href="/privacy">
            Privacy
          </Link>
          <Link className="button button--quiet" href="/login">
            Back
          </Link>
        </div>
      </section>
    </main>
  );
}
