import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="shell shell--centred">
      <section className="card">
        <h1>IELTS Speaking Coach</h1>
        <p className="muted">
          Private practice app. Sign in with the GitHub account on the allow
          list.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="button">
            Sign in with GitHub
          </button>
        </form>
      </section>
    </main>
  );
}
