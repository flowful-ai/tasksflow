import { Link, useNavigate } from 'react-router-dom';

export function ViewsSettings() {
  const navigate = useNavigate();
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Views</h2>
          <p className="text-sm text-gray-600 mt-1">Manage your saved filtered views.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings/workspace/views/new')}
          className="btn btn-primary"
        >
          New View
        </button>
      </div>
      <p className="text-gray-600">
        Go to the{' '}
        <Link to="/views" className="text-primary-600 hover:underline">
          Views page
        </Link>{' '}
        to see all your views, or create a new one above.
      </p>
    </div>
  );
}
