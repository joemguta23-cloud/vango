import Nav from '@/components/Nav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Vanute collects, uses and protects your information, including driver location data used to match and track deliveries across Melbourne and Victoria.',
  alternates: { canonical: 'https://vanute.com.au/privacy' },
}

export default function PrivacyPage() {
  return (
    <div>
      <Nav />
      <div className="max-w-3xl mx-auto px-6 pt-24 pb-20">
        <h1 className="text-4xl font-black text-slate-800 mb-2">Privacy Policy</h1>
        <p className="text-slate-500 text-sm mb-8">Last updated: 2 July 2026</p>

        <p className="text-slate-600 leading-relaxed mb-4">
          This Privacy Policy explains how Two Minute Van Pty Ltd, trading as Vanute (“Vanute”, “we”, “us”),
          collects, uses, discloses and protects your personal information when you use the Vanute website and
          mobile app (the “Service”). Vanute is a peer-to-peer delivery marketplace operating in Melbourne and
          Victoria, Australia. By using the Service you agree to this policy.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Information we collect</h2>
        <p className="text-slate-600 leading-relaxed mb-2">We collect the following information:</p>
        <ul className="list-disc pl-6 text-slate-600 leading-relaxed mb-4 space-y-1">
          <li><strong>Account information</strong> — your name, email address, phone number and password, and the state/region you select.</li>
          <li><strong>Driver information</strong> — for drivers: vehicle details and driver licence details.</li>
          <li><strong>Location information</strong> — for drivers who go “Online”, we collect your device’s precise location, including while the app is running in the background, so we can match you to nearby jobs and show buyers live tracking. Location is only collected while you are Online and stops when you go Offline.</li>
          <li><strong>Job information</strong> — pickup and dropoff addresses, item details and photos, and delivery status.</li>
          <li><strong>Payment information</strong> — card payments for the Vanute service fee are processed by Stripe. We do not store your full card number; Stripe handles it securely.</li>
          <li><strong>Usage and device data</strong> — basic technical information needed to operate and secure the Service.</li>
        </ul>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">How we use your information</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          We use your information to create and manage your account, match buyers with nearby drivers, enable live
          delivery tracking, process the service fee, provide customer support, keep the Service safe and secure,
          and comply with our legal obligations. Driver location is used solely to operate the delivery service.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">How we share your information</h2>
        <p className="text-slate-600 leading-relaxed mb-2">We share information only as needed to run the Service:</p>
        <ul className="list-disc pl-6 text-slate-600 leading-relaxed mb-4 space-y-1">
          <li><strong>With other users</strong> — to complete a job, a buyer and their assigned driver see the information needed for the delivery (such as names, relevant addresses and, during an active job, the driver’s live location).</li>
          <li><strong>Service providers</strong> — Stripe (payments), Google Maps (addresses and mapping), and Supabase (secure hosting and database).</li>
          <li><strong>Legal</strong> — where required by law or to protect the rights, safety and property of users or Vanute.</li>
        </ul>
        <p className="text-slate-600 leading-relaxed mb-4">We do not sell your personal information.</p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Data retention</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          We keep your information for as long as your account is active and as needed to provide the Service and
          meet legal requirements. You can ask us to delete your account and associated personal data at any time.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Your rights and choices</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          You can access and update your account details in the app’s settings. You can request access to,
          correction of, or deletion of your personal information by contacting us. Drivers can stop all location
          collection at any time by going Offline or by revoking the location permission in their device settings.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Security</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          Data is encrypted in transit. We use reputable providers and reasonable technical and organisational
          measures to protect your information, though no method of transmission or storage is completely secure.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Children</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          The Service is intended for people aged 18 and over and is not directed at children. We do not knowingly
          collect personal information from children.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Changes to this policy</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          We may update this policy from time to time. Material changes will be reflected by updating the date at
          the top of this page.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Contact us</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          Questions about this policy or your data? Email us at{' '}
          <a href="mailto:admin@vanute.com.au" className="text-orange-500 font-semibold hover:underline">admin@vanute.com.au</a>.
        </p>
      </div>
    </div>
  )
}
