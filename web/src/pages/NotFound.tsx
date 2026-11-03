import { Link } from 'react-router-dom';
import { MapPinOff } from 'lucide-react';
import { EmptyState } from '../components/ui.tsx';

export function NotFound({ title = 'We couldn’t find that page', message }: { title?: string; message?: string }) {
  return (
    <EmptyState
      icon={<MapPinOff size={28} />}
      title={title}
      action={
        <Link className="btn btn-primary" to="/">
          <span>Back to exploring</span>
        </Link>
      }
    >
      {message ?? 'The link may be out of date, or it may belong to someone else’s borrowing.'}
    </EmptyState>
  );
}
