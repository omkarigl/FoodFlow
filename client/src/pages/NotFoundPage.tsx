import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="notfound">
      <span className="notfound__code" aria-hidden="true">
        404
      </span>
      <h1>We could not find that page</h1>
      <p>The link may be old, or the order might have moved.</p>
      <div className="notfound__actions">
        <Link className="btn btn--primary" to="/scan">
          Go to scanner
        </Link>
        <Link className="btn btn--ghost" to="/orders">
          My orders
        </Link>
      </div>
      <Button variant="ghost" onClick={() => window.history.back()}>
        Go back
      </Button>
    </div>
  );
}