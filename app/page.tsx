import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  const title = process.env.NEXT_PUBLIC_REGISTRY_TITLE || "Baby Patel";
  const subtitle =
    process.env.NEXT_PUBLIC_REGISTRY_SUBTITLE || "We're having a baby!";
  return (
    <main className="landing">
      <header className="site-header">
        <div className="eyebrow">Welcome</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
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
