import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { Section } from "@/components/LegalShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service · SkyVult",
  description: "The terms governing your use of the SkyVult trading platform.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These Terms of Service ("Terms") govern your access to and use of ${LEGAL.appName}, operated by ${LEGAL.companyName} ("we", "us", "our"). By creating an account or using the platform, you agree to these Terms. If you do not agree, do not use ${LEGAL.appName}.`}
    >
      <Section n={1} title="Eligibility">
        <p>
          You must be at least {LEGAL.minAge} years old and legally able to enter into a binding contract
          under the laws of {LEGAL.jurisdiction}. You may not use {LEGAL.appName} if doing so is prohibited
          where you live, or if you are accessing it on behalf of a sanctioned person or entity.
        </p>
        <p>
          You agree to provide accurate, current information when you register and to keep it up to date.
          One person may hold only one real-money account.
        </p>
      </Section>

      <Section n={2} title="Risk Disclosure">
        <p className="text-down font-medium">
          Trading involves substantial risk. You can lose some or all of the money you deposit.
        </p>
        <p>
          {LEGAL.appName} offers short-term price-prediction trades on financial instruments. Outcomes are
          based on real market price movements and are inherently uncertain. Past performance, demo results,
          and any figures shown on the platform do not guarantee future results. Only trade with money you
          can afford to lose. Nothing on {LEGAL.appName} is financial, investment, tax, or legal advice.
        </p>
      </Section>

      <Section n={3} title="Demo Accounts">
        <p>
          Every account includes a demo balance using virtual funds for practice only. Demo balances have no
          monetary value, cannot be withdrawn, and may be reset or adjusted at any time. Demo results do not
          reflect what you would earn or lose with real money.
        </p>
      </Section>

      <Section n={4} title="Deposits">
        <p>
          Deposits are made in Ghana Cedis (GHS) through the payment methods we make available, including
          Mobile Money. The minimum deposit is ₵80. When you start a deposit you
          receive a unique reference; you must include that reference with your payment so we can match it to
          your account. Funds are credited only after we confirm receipt, which is usually within a few
          minutes but may take longer.
        </p>
        <p>
          You are responsible for paying to the correct details and quoting the correct reference. We are not
          responsible for payments sent to the wrong destination, without the reference, or from an account
          that is not yours.
        </p>
      </Section>

      <Section n={5} title="Withdrawals & KYC">
        <p>
          Withdrawals are paid to your verified Mobile Money number and are reviewed and approved manually
          before being sent. Before you can withdraw, you must complete identity verification (KYC) by
          submitting a valid government ID. We may request additional information to comply with anti-money
          laundering (AML) and "know your customer" obligations.
        </p>
        <p>
          We may delay, decline, or reverse a withdrawal where we reasonably suspect fraud, error, abuse,
          unverified identity, or a breach of these Terms, or where we are required to do so by law.
        </p>
      </Section>

      <Section n={6} title="Referral Bonus">
        <p>
          You may earn a referral bonus (currently ₵30) when someone you refer signs up using your link and
          makes their first qualifying deposit. Referral bonuses are subject to a wagering requirement before
          the bonus portion can be withdrawn, and are paid at our discretion. We may withhold or reverse
          bonuses obtained through self-referral, fake accounts, or other abuse, and may change or end the
          referral program at any time.
        </p>
      </Section>

      <Section n={7} title="Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-muted">
          <li>use the platform for money laundering, fraud, or any unlawful purpose;</li>
          <li>open multiple real-money accounts or trade on behalf of others without authorisation;</li>
          <li>manipulate, exploit, or attempt to game prices, bonuses, or the trading engine;</li>
          <li>access the platform through bots, scrapers, or automated means without our written consent;</li>
          <li>interfere with, probe, or attempt to breach the security of the platform.</li>
        </ul>
        <p>
          We may suspend or terminate accounts that breach these rules and may withhold funds connected to
          the breach pending investigation.
        </p>
      </Section>

      <Section n={8} title="Account Suspension & Termination">
        <p>
          We may suspend or close your account, with or without notice, if you breach these Terms, if required
          by law, or to protect the platform or other users. You may close your account at any time after
          withdrawing your available, withdrawable balance.
        </p>
      </Section>

      <Section n={9} title="Limitation of Liability">
        <p>
          {LEGAL.appName} is provided "as is" and "as available". To the fullest extent permitted by law, we
          are not liable for trading losses, for indirect or consequential losses, or for losses caused by
          events outside our reasonable control, including outages of payment providers, market data feeds,
          internet, or device failures. Nothing in these Terms limits liability that cannot be limited under
          the laws of {LEGAL.jurisdiction}.
        </p>
      </Section>

      <Section n={10} title="Changes to These Terms">
        <p>
          We may update these Terms from time to time. Material changes will be notified through the platform
          or by email. Continuing to use {LEGAL.appName} after changes take effect means you accept the
          updated Terms.
        </p>
      </Section>

      <Section n={11} title="Governing Law">
        <p>
          These Terms are governed by the laws of {LEGAL.jurisdiction}, and any dispute is subject to the
          exclusive jurisdiction of its courts.
        </p>
      </Section>

      <Section n={12} title="Contact">
        <p>
          {LEGAL.companyName}
          {LEGAL.registration ? <> · Reg. {LEGAL.registration}</> : null}
          {LEGAL.address ? <><br />{LEGAL.address}</> : null}
        </p>
        <Link
          href="/support"
          className="inline-flex items-center gap-2 mt-1 px-3.5 py-2 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 transition-colors"
        >
          💬 Message Us
        </Link>
      </Section>
    </LegalShell>
  );
}
