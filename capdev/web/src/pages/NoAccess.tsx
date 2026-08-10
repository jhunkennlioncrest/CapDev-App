export function NoAccess({ email }: { email: string }): JSX.Element {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-3xl mb-3">No access yet</h1>
        <p className="text-ink-70 mb-6">
          You&rsquo;re signed in as <span className="font-mono text-sm">{email}</span>, but
          that address hasn&rsquo;t been added to the platform. Ask an administrator
          to invite you.
        </p>
      </div>
    </main>
  );
}
