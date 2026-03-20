export const metadata = { title: 'Terms of Service – REPS Tracker' };

export default function TermsOfService() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-slate-800 dark:text-slate-200">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-slate-500 mb-8">Last updated: March 2026</p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-lg font-semibold mb-2">1. Acceptance</h2>
          <p>
            By using REPS Tracker you agree to these Terms. If you do not agree, do not use
            the service.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">2. Description of service</h2>
          <p>
            REPS Tracker is a personal record-keeping tool designed to help real-estate
            professionals log and document hours spent on material and non-material activities
            for IRS Real Estate Professional Status (REPS) purposes. It is not a tax or legal
            advice service.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">3. Your account</h2>
          <p>
            You are responsible for maintaining the security of your Google account. You are
            responsible for all activity that occurs under your account.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-slate-600 dark:text-slate-400">
            <li>Use the service for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Upload malicious files or content</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">5. Your data</h2>
          <p>
            You own your data. You can export or delete it at any time. We make reasonable
            efforts to keep your data safe but provide no guarantees of uptime or data
            retention. Maintain your own backups for important records.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">6. No tax or legal advice</h2>
          <p>
            REPS Tracker is a logging tool only. Nothing in the app constitutes tax, legal,
            or financial advice. Consult a qualified tax professional regarding IRS REPS
            qualification requirements.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">7. Disclaimer of warranties</h2>
          <p>
            The service is provided &ldquo;as is&rdquo; without warranty of any kind. We are not liable
            for any damages arising from your use of the service.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">8. Changes</h2>
          <p>
            We may update these Terms. Continued use after changes constitutes acceptance.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">9. Contact</h2>
          <p>
            Questions?{' '}
            <a href="mailto:support@repstracker.app" className="text-blue-600 dark:text-blue-400 underline">
              support@repstracker.app
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
