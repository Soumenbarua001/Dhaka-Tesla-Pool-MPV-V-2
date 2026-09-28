import Link from "next/link";

export default function Home() {
  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <span className="eyebrow">BANANI → MOHAKHALI / GULSHAN</span>
          <h1>Share a seat.<br />Split the fare.</h1>
          <p className="lede">A compact ride-pooling MVP built around Dhaka&apos;s three-seat “Tesla” rickshaws. One pool, visible capacity, individual fares, explicit trip states.</p>
          <div className="row gap">
            <Link className="button primary" href="/login">Open demo</Link>
            <Link className="button ghost" href="/register">Create account</Link>
          </div>
        </div>
        <div className="story-card">
          <div className="story-time">08:41</div>
          <h2>Road 11, Banani</h2>
          <div className="route-line"><span>Nusrat</span><b>Banani → Mohakhali</b><em>1 seat</em></div>
          <div className="route-line"><span>Rafiq</span><b>Banani → Gulshan 1</b><em>1 seat</em></div>
          <div className="capacity"><span>Bullet</span><strong>2 / 3 seats reserved</strong></div>
        </div>
      </section>

      <section className="feature-grid">
        <article><span>01</span><h3>Pool safely</h3><p>Compatible trips share a vehicle only while capacity remains.</p></article>
        <article><span>02</span><h3>Track the lifecycle</h3><p>Requested, matched, driver arrived, started, completed or cancelled.</p></article>
        <article><span>03</span><h3>Keep fares personal</h3><p>Every passenger sees their own fare and ride history.</p></article>
      </section>

      <section className="demo-strip">
        <div><small>DRIVER</small><strong>jashim@tesla.dhaka</strong></div>
        <div><small>PASSENGER</small><strong>nusrat@tesla.dhaka</strong></div>
        <div><small>PASSWORD</small><strong>password123</strong></div>
      </section>
    </div>
  );
}
