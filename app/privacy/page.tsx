export const metadata = { title: 'Privacy Policy – REPS Tracker' };

export default function PrivacyPolicy() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-slate-800 dark:text-slate-200">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-slate-500 mb-8">Last updated: March 2026</p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-lg font-semibold mb-2">1. What we collect</h2>
          <p>
            REPS Tracker collects only the information necessary to provide the service:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-600 dark:text-slate-400">
            <li>Your Google account name, email address, and profile picture (via Google Sign-In)</li>
            <li>Hours entries, categories, and properties you create in the app</li>
            <li>File metadata (filename, size, type) for attachments you upload</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">2. Google Drive</h2>
          <p>
            If you grant Drive access, REPS Tracker uploads your attachment files directly to a
            folder named <strong>REPS Tracker</strong> in your own Google Drive. We use the
            restricted <code>drive.file</code> scope, which means the app can only access files
            it creates — not the rest of your Drive. We store a link to each file; we never
            copy or retain the file contents on our servers.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">3. How we use your data</h2>
          <p>
            Your data is used solely to operate and improve REPS Tracker. We do not sell,
            share, or rent your personal information to third parties. We do not use your data
            for advertising purposes.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">4. Data storage</h2>
          <p>
            Your entries and account information are stored in a PostgreSQL database. Attachment
            files reside in your own Google Drive account. You can delete your account and all
            associated data at any time from the Settings page.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">5. Cookies and local storage</h2>
          <p>
            REPS Tracker stores authentication tokens in your browser&apos;s local storage to keep
            you signed in. No third-party tracking cookies are used.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">6. Contact</h2>
          <p>
            Questions about this policy? Email us at{' '}
            <a href="mailto:support@repstracker.app" className="text-blue-600 dark:text-blue-400 underline">
              support@repstracker.app
            </a>.
          </p>
        </div>
      </section>
    </main>
  );
}
