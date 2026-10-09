import { Link } from 'react-router-dom';

const POINTS = [
  { title: 'Scan the code', body: 'Each table and counter has its own QR code. Scanning opens that canteen and its menu.' },
  { title: 'Order and pay', body: 'Add items to the cart, then pay from the wallet or through Razorpay.' },
  { title: 'Get a token', body: 'Every paid order gets a pickup token you can print or show on your phone.' },
  { title: 'Track the order', body: 'Accepted, preparing, ready — the status updates as the kitchen works through the queue.' },
  { title: 'Live stock', body: 'Availability comes from the counter, so sold out items are marked before you add them.' },
  { title: 'Cancel and refund', body: 'Cancel while the order is still preparing and the amount goes back to your wallet.' },
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing__nav">
        <span className="landing__brand">FoodFlow</span>
        <div className="landing__actions">
          <Link className="btn btn--ghost" to="/login">
            Sign in
          </Link>
          <Link className="btn" to="/register">
            Create account
          </Link>
        </div>
      </header>

      <section className="landing__hero">
        <h1>Order from the canteen on your phone</h1>
        <p className="landing__lead">
          Scan the QR code at your table, order from the live menu, pay, and get a token for the counter. The kitchen sees your order as soon as payment
          clears.
        </p>
        <div className="landing__cta">
          <Link className="btn" to="/register">
            Create account
          </Link>
          <Link className="btn btn--ghost" to="/login">
            Sign in
          </Link>
        </div>
      </section>

      <section className="landing__grid">
        {POINTS.map((point) => (
          <article key={point.title} className="feature">
            <h3>{point.title}</h3>
            <p>{point.body}</p>
          </article>
        ))}
      </section>

      <footer className="landing__foot">
        <span>FoodFlow</span>
        <Link to="/login">Staff sign in</Link>
      </footer>
    </div>
  );
}