import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Users,
  Mail,
  Shield,
  User,
  Clock,
  AlertTriangle,
  Loader2,
  CheckCircle,
  LogIn,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';
import { invitationApi, type PublicInvitation, ApiError } from '../api/client';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthStore();
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);

  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [acceptedWorkspace, setAcceptedWorkspace] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    const loadInvitation = async () => {
      if (!token) {
        setError('Invalid invitation link');
        setIsLoading(false);
        return;
      }

      try {
        const response = await invitationApi.getByToken(token);
        setInvitation(response.data);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          setErrorCode(err.code);
        } else {
          setError('Failed to load invitation');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadInvitation();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;

    setIsAccepting(true);
    setError(null);

    try {
      const response = await invitationApi.accept(token);
      setAcceptedWorkspace({
        id: response.data.workspaceId,
        name: response.data.workspaceName,
      });

      // Refresh workspaces to include the new one
      await fetchWorkspaces();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to accept invitation');
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const handleGoToWorkspace = () => {
    navigate('/dashboard');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
          <p className="text-gray-600">Loading invitation...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {errorCode === 'EXPIRED' ? 'Invitation Expired' : 'Invalid Invitation'}
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link to="/login" className="btn btn-primary">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  // Show success state
  if (acceptedWorkspace) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Welcome to {acceptedWorkspace.name}!
          </h1>
          <p className="text-gray-600 mb-6">
            You've successfully joined the workspace. You can now start collaborating with your team.
          </p>
          <button onClick={handleGoToWorkspace} className="btn btn-primary">
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Email mismatch check - only applies to email-specific invitations
  const isEmailMismatch =
    isAuthenticated &&
    user &&
    invitation &&
    !invitation.isGeneric &&
    invitation.email !== null &&
    user.email.toLowerCase() !== invitation.email.toLowerCase();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 p-6 text-white">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-8 h-8" />
            <h1 className="text-xl font-semibold">Workspace Invitation</h1>
          </div>
          <p className="text-primary-100">
            You've been invited to join a workspace
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Workspace info */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {invitation?.workspaceName}
            </h2>
            <div className="flex items-center justify-center gap-2 text-gray-600">
              {invitation?.role === 'admin' ? (
                <>
                  <Shield className="w-4 h-4 text-blue-500" />
                  <span>Admin</span>
                </>
              ) : (
                <>
                  <User className="w-4 h-4 text-gray-400" />
                  <span>Member</span>
                </>
              )}
            </div>
          </div>

          {/* Invitation details */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            {invitation?.isGeneric ? (
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-purple-500" />
                <div>
                  <p className="text-sm text-gray-500">Invitation type</p>
                  <p className="font-medium text-purple-700">Open invite link</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Invited</p>
                  <p className="font-medium text-gray-900">{invitation?.email}</p>
                </div>
              </div>
            )}

            {invitation?.invitedBy && (
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Invited by</p>
                  <p className="font-medium text-gray-900">
                    {invitation.invitedBy.name || invitation.invitedBy.email}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Expires</p>
                <p className="font-medium text-gray-900">
                  {invitation && new Date(invitation.expiresAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
          )}

          {/* Email mismatch warning */}
          {isEmailMismatch && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">Email mismatch</p>
                  <p className="text-sm text-amber-700 mt-1">
                    This invitation was sent to <strong>{invitation?.email}</strong>, but you're
                    signed in as <strong>{user?.email}</strong>.
                  </p>
                  <p className="text-sm text-amber-700 mt-2">
                    Sign in with the correct email to accept this invitation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            {isAuthenticated ? (
              isEmailMismatch ? (
                <Link to="/login" className="btn btn-primary w-full justify-center">
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign in with different account
                </Link>
              ) : (
                <button
                  onClick={handleAccept}
                  disabled={isAccepting}
                  className="btn btn-primary w-full justify-center"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    'Accept Invitation'
                  )}
                </button>
              )
            ) : (
              <>
                <Link
                  to={`/login?redirect=/invite/${token}`}
                  className="btn btn-primary w-full justify-center"
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign in to Accept
                </Link>
                <p className="text-sm text-center text-gray-500">
                  Don't have an account?{' '}
                  <Link
                    to={`/register?redirect=/invite/${token}`}
                    className="text-primary-600 hover:underline"
                  >
                    Create one
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
