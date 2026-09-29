export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  return (
    <main>
      <form className="login" method="post" action="/api/auth/login">
        <h1>The Tower</h1>
        <p className="note">Owner passcode. Only Saaqib approves, pastes and edits.</p>
        <input type="hidden" name="next" value={params.next ?? "/"} />
        <p>
          <input type="password" name="passcode" placeholder="Passcode" autoFocus required style={{ width: "100%" }} />
        </p>
        {params.error ? <p className="error">That passcode did not match.</p> : null}
        <button type="submit">Enter the building</button>
      </form>
    </main>
  );
}
