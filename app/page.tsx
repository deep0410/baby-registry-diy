import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  const welcomeName = process.env.WELCOME_NAME || "";
  const eventName = process.env.EVENT_NAME || "Baby Shower";
  return (
    <main className="landing">
      <header className="site-header">
        <div className="eyebrow">Welcome!</div>
        <h1>
          {welcomeName} {eventName}
        </h1>
        <p>We are excited for you to join us.</p>
      </header>

      <div className="landing-cards">
        <Link href="/rsvp" className="landing-card">
          <div className="landing-emoji">💌</div>
          <h2 className="serif">RSVP</h2>
          <p>Let us know you&apos;re coming and how many people to expect.</p>
          <span className="btn block">RSVP now</span>
        </Link>

        <Link href="/baby-registry" className="landing-card">
          <div className="landing-emoji">🍼</div>
          <h2 className="serif">Baby Registry</h2>
          <p>Browse the gift list and claim something for the little one.</p>
          <span className="btn block sage">View registry</span>
        </Link>
      </div>
    </main>
  );
}
