import { Link, useNavigate } from 'react-router-dom';
import { Button, Card } from '../ui';

export function ViewsSettings() {
  const navigate = useNavigate();
  return (
    <Card
      title="Views"
      description="Manage your saved filtered views."
      actions={<Button onClick={() => navigate('/settings/workspace/views/new')}>New View</Button>}
    >
      <p className="text-neutral-600">
        Go to the{' '}
        <Link to="/views" className="text-primary-600 hover:underline">
          Views page
        </Link>{' '}
        to see all your views, or create a new one above.
      </p>
    </Card>
  );
}
