import Link from "next/link";
import { geminiPaidTier } from "@/lib/guest/config";

/**
 * NOT LEGAL ADVICE.
 *
 * This page is a plain-language description of what the code actually does,
 * written by reading the code. It is not a lawyer-drafted privacy policy and
 * it has not been reviewed by one. If this app ever has real users beyond you
 * and a few friends, or takes payment, or is used by anyone in a jurisdiction
 * with a notice-and-consent regime you care about (GDPR, UK GDPR, CCPA), get
 * it reviewed properly.
 *
 * The statements about Google were checked against Google's published Gemini
 * API terms and the Interactions API documentation on 27 November 2026. Those
 * terms change. If you enable billing, set GEMINI_PAID_TIER=true and the
 * paid-tier paragraph below replaces the free-tier one, so the page cannot
 * silently become wrong.
 *
 * Keep this page honest even when it is unflattering. A privacy page that
 * overstates what you do is worse than having none.
 */

/**
 * Rendered per request, not prerendered. This page reads an env var, and a
 * prerendered copy would bake the value in at build time - which would mean
 * the GUEST_MODE_ENABLED kill switch needed a redeploy to take effect. It has
 * to be immediate.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Privacy",
  description:
    "What this app does and does not do with your voice, your transcript and your feedback.",
};

const CONTACT_URL = "https://github.com/Zorrow14/ielts_speaking_coach/issues";

export default function PrivacyPage() {
  const paid = geminiPaidTier();

  return (
    <main className="shell prose">
      <header className="shell__header">
        <h1>Privacy</h1>
        <p className="muted">
          Written in plain language, describing what the code actually does.
          Last reviewed 27 November 2026.
        </p>
      </header>

      <section className="card">
        <h2>The short version</h2>
        <ul className="bullets">
          <li>
            Your audio is sent to Google&apos;s Gemini API, which produces the
            transcript and the feedback. It has to be &mdash; that is what does
            the marking.
          </li>
          <li>
            <strong>This app never stores your audio.</strong> Not in a file,
            not in a database, not in a log. It passes through memory and is
            gone.
          </li>
          <li>
            In <strong>guest mode</strong>, this app stores no transcript, no
            feedback, no scores and no questions either. Your results live in
            your browser tab and disappear when you refresh or close it.
          </li>
          <li>
            The only thing kept is an <strong>anonymous counter</strong>, for up
            to 24 hours, so the free allowance cannot be abused. It contains no
            text and nothing that identifies you.
          </li>
          <li>
            There is no analytics, no session replay, no advertising, no
            tracking pixel and no third-party error reporting.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>What happens to your voice</h2>
        <p>
          When you record an answer, the audio is uploaded to this app&apos;s
          server, forwarded straight to Google&apos;s Gemini API, and discarded
          as soon as the response comes back. It is never written to disk or to
          a database, and its contents are never logged.
        </p>

        {paid ? (
          <>
            <h3>What Google does with it</h3>
            <p>
              This app uses the <strong>paid</strong> Gemini API. Under
              Google&apos;s terms for paid services, Google does not use your
              prompts or the model&apos;s responses to improve their products,
              and the content is not reviewed by people for that purpose.
              Google retains it for a limited period for abuse detection and
              legal compliance.
            </p>
            <p>
              This app also sets <code>store: false</code> on every request,
              which Google&apos;s documentation says opts out of storing the
              interaction for state management and observability.
            </p>
          </>
        ) : (
          <>
            <h3>What Google does with it &mdash; read this part</h3>
            <p className="alert alert--soft">
              This app currently uses the <strong>free</strong> tier of the
              Gemini API. Under Google&apos;s terms for unpaid services,{" "}
              <strong>
                Google may use what you submit to improve their products and
                services, and human reviewers may read or listen to it
              </strong>
              . Google&apos;s own terms tell developers not to submit sensitive,
              confidential or personal information on this tier.
            </p>
            <p>
              So: practise answering an exam question, and treat it as though
              you were speaking in a public place. Do not say anything you would
              not want a stranger at Google to hear. Do not read out your
              address, your ID numbers, your medical history or anyone
              else&apos;s private business.
            </p>
            <p className="muted">
              Google applies its paid-service terms to everyone in the European
              Economic Area, Switzerland and the United Kingdom, so if you are
              in one of those places this does not apply to you &mdash; but do
              not rely on that without checking Google&apos;s current terms
              yourself.
            </p>
            <p>
              This app does set <code>store: false</code> on every request,
              which Google&apos;s documentation says opts out of storing the
              interaction for state management and observability. That is a
              separate thing from the training question above.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>The anonymous counter</h2>
        <p>
          To stop one person, or a script, using up the daily allowance, the app
          counts requests. A counter row holds exactly four things:
        </p>
        <ul className="bullets">
          <li>
            a one-way hash of your guest session id, or of your IP address
          </li>
          <li>the date</li>
          <li>which endpoint it was (&ldquo;question&rdquo; or &ldquo;evaluate&rdquo;)</li>
          <li>a number</li>
        </ul>
        <p>
          The hash is salted with a secret that <strong>changes every day</strong>,
          which means the hash for the same person tomorrow is unrelated to
          today&apos;s. These rows cannot be joined across days to build a
          picture of anyone, and the raw IP address is never written down &mdash;
          it is hashed in memory and only the hash is stored. Rows older than a
          day are deleted.
        </p>
        <p className="muted">
          No user agent, no device information, no location, no referrer, no
          content of any kind.
        </p>
      </section>

      <section className="card">
        <h2>Cookies</h2>
        <p>
          Guest mode sets one cookie, <code>guest_token</code>. It contains a
          random id and an expiry time, nothing else. It is{" "}
          <code>httpOnly</code>, so page scripts cannot read it, and it expires
          within 24 hours. Its only job is to remember that you passed the
          automated-traffic check, so your remaining free answers follow you
          between pages.
        </p>
        <p>
          If you sign in as the owner, Auth.js sets a session cookie. That is a
          login session, not tracking.
        </p>
        <p className="muted">
          No advertising cookies. Nothing shared with anyone.
        </p>
      </section>

      <section className="card">
        <h2>Logs</h2>
        <p>
          The server writes one line per request containing the route, the HTTP
          status, how long it took, and a short error label if something failed.
          It deliberately does not log audio, transcripts, questions, feedback,
          scores, raw IP addresses, cookies or any credential.
        </p>
      </section>

      <section className="card">
        <h2>If you sign in as the owner</h2>
        <p>
          The owner account is different, on purpose: that is the point of the
          app. Transcripts, scores, mistakes and notebook entries are stored in
          a Postgres database so progress can be tracked over time. Audio is
          still never stored, for the owner either.
        </p>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p>
          In guest mode there is nothing to delete, because nothing about you
          was kept &mdash; only the anonymous counter, which deletes itself
          within a day and cannot be traced back to you even before then. That
          is also why there is no &ldquo;download my data&rdquo; button for
          guests: the Download button on the results page gives you the only
          copy that exists.
        </p>
      </section>

      <section className="card">
        <h2>Scores are estimates</h2>
        <p>
          Every band on every screen is an estimate produced by an AI model, not
          an official IELTS band, and should not be used to decide whether you
          are ready for the real test. Pronunciation is the least reliable of
          the four and is labelled as an indicator rather than a band.
        </p>
        <p>
          This app is not affiliated with, endorsed by, or connected to IELTS,
          the British Council, IDP Education or Cambridge University Press and
          Assessment.
        </p>
      </section>

      <section className="card">
        <h2>Contact</h2>
        <p>
          Questions, or something here looks wrong?{" "}
          <a href={CONTACT_URL} rel="noreferrer noopener" target="_blank">
            Open an issue on GitHub
          </a>
          .
        </p>
        <p className="muted">
          This is a personal project, not a company. There is no support desk.
        </p>
      </section>

      <section className="card">
        <div className="row">
          <Link className="button button--quiet" href="/terms">
            Terms
          </Link>
          <Link className="button button--quiet" href="/login">
            Back
          </Link>
        </div>
      </section>
    </main>
  );
}
