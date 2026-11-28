import { signIn } from "@/auth";
import Icon from "@/components/Icon";

/**
 * Sign-in. Exam-quiet: one card on ruled paper, one action.
 *
 * Behaviour is unchanged from before the redesign - one server action that
 * hands off to GitHub, with ALLOWED_EMAILS deciding who gets in on the way
 * back (auth.ts). Only the presentation moved.
 */
export default function LoginPage() {
  return (
    <main className="login">
      <section className="card login__card" aria-labelledby="login-title">
        <div className="login__mark" aria-hidden="true">
          <Icon name="brand" />
        </div>

        <div className="login__heading">
          <p className="eyebrow">IELTS Speaking practice</p>
          <h1 id="login-title">Speaking Coach</h1>
        </div>

        <p className="login__lede">
          Answer Parts 1, 2 and 3 out loud. Each answer is transcribed and
          marked against the four speaking criteria, with your own words
          quoted as evidence.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="button button--large button--block">
            Sign in with GitHub
            <Icon name="arrowRight" />
          </button>
        </form>

        <p className="login__note muted">
          A private practice app. Only accounts on the allow list can sign in.
        </p>
      </section>

      <p className="login__footnote muted">
        Scores are AI estimates, not official IELTS bands. Not affiliated with
        IELTS, the British Council, IDP or Cambridge.
      </p>
    </main>
  );
}
