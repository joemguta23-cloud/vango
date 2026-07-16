import Nav from '@/components/Nav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Delete Your Account',
  description:
    'How to delete your Vanute account and associated personal data, what is removed, and what may be kept to meet legal obligations.',
  alternates: { canonical: 'https://getvango.com.au/account-deletion' },
}

export default function AccountDeletionPage() {
  return (
    <div>
      <Nav />
      <div className="max-w-3xl mx-auto px-6 pt-24 pb-20">
        <h1 className="text-4xl font-black text-slate-800 mb-2">Delete Your Account</h1>
        <p className="text-slate-500 text-sm mb-8">Last updated: 8 July 2026</p>

        <p className="text-slate-600 leading-relaxed mb-4">
          This page explains how to delete your Vanute account and the personal data associated with it. Vanute is
          operated by Two Minute Van Pty Ltd (trading as &ldquo;Vanute&rdquo;), a peer-to-peer delivery marketplace
          operating in Melbourne and Victoria, Australia.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">How to request account deletion</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          To delete your Vanute account and associated personal data, email us at{' '}
          <a href="mailto:getvango@gmail.com" className="text-orange-500 font-semibold hover:underline">getvango@gmail.com</a>{' '}
          from the email address registered to your account, with the subject line &ldquo;Delete my account&rdquo;.
          We&rsquo;ll verify that the request is from you and permanently delete your account within 30 days. You can
          also review and update your account details at any time in the app under <strong>Settings</strong>.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">What data is deleted</h2>
        <p className="text-slate-600 leading-relaxed mb-2">When your account is deleted we permanently remove:</p>
        <ul className="list-disc pl-6 text-slate-600 leading-relaxed mb-4 space-y-1">
          <li>Your profile &mdash; name, email address, phone number and password.</li>
          <li>For drivers &mdash; vehicle details, driver licence details and stored location history.</li>
          <li>Your job history &mdash; pickup and dropoff addresses, item details and photos, and in-app messages.</li>
        </ul>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">What may be kept</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          We may retain a limited amount of information where the law requires it. In particular, records of
          completed transactions and the Vanute service fee (processed by Stripe) may be kept for up to 7 years to
          meet Australian tax and financial record-keeping obligations. Retained records are not used for any other
          purpose and are deleted once the legal retention period ends. Vanute never stores your full payment card
          number.
        </p>

        <h2 className="text-xl font-bold text-slate-800 mt-8 mb-2">Questions</h2>
        <p className="text-slate-600 leading-relaxed mb-4">
          If you need help deleting your account, email us at{' '}
          <a href="mailto:getvango@gmail.com" className="text-orange-500 font-semibold hover:underline">getvango@gmail.com</a>.
        </p>
      </div>
    </div>
  )
}
