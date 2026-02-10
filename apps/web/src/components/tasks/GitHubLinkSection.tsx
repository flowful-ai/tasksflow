import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Loader2, GitBranch, Link2 } from 'lucide-react';
import { api, githubApi } from '../../api/client';

interface ExternalLinkData {
  id: string;
  externalType: 'github_issue' | 'github_pr';
  externalId: string;
  externalUrl: string;
}

interface Props {
  taskId: string;
  projectId: string;
  externalLinks: ExternalLinkData[];
  onUpdated?: () => void;
}

export function GitHubLinkSection({ taskId, projectId, externalLinks, onUpdated }: Props) {
  const queryClient = useQueryClient();
  const [showIssueRepoSelector, setShowIssueRepoSelector] = useState(false);
  const [showPrLinker, setShowPrLinker] = useState(false);
  const [selectedPrRepo, setSelectedPrRepo] = useState('');
  const [prNumber, setPrNumber] = useState('');

  const { data: integration } = useQuery({
    queryKey: ['github-integration', projectId],
    queryFn: () => githubApi.getIntegration(projectId),
  });

  const createIssueMutation = useMutation({
    mutationFn: (repo: { owner: string; repo: string }) =>
      api.post<{ success: boolean; data: { url: string; number: number } }>(
        `/api/tasks/${taskId}/github-issue`,
        repo
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      setShowIssueRepoSelector(false);
      onUpdated?.();
    },
  });

  const linkPrMutation = useMutation({
    mutationFn: (payload: { owner: string; repo: string; prNumber: number }) =>
      api.post<{ success: boolean; data: { url: string; number: number } }>(
        `/api/tasks/${taskId}/github-pr`,
        payload
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      setShowPrLinker(false);
      setSelectedPrRepo('');
      setPrNumber('');
      onUpdated?.();
    },
  });

  const githubIssues = externalLinks.filter((l) => l.externalType === 'github_issue');
  const githubPRs = externalLinks.filter((l) => l.externalType === 'github_pr');
  const hasIntegration = (integration?.repositories?.length || 0) > 0;
  const hasLinkedIssue = githubIssues.length > 0;

  // Don't render if no integration and no links
  if (!hasIntegration && externalLinks.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2 text-sm font-medium text-gray-500">
          <GitBranch className="w-4 h-4" />
          <span>GitHub</span>
        </div>
        {hasIntegration && (
          <div className="flex items-center gap-1">
            {!hasLinkedIssue && !showIssueRepoSelector && (
              <button
                onClick={() => setShowIssueRepoSelector(true)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Create GitHub issue"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            {!showPrLinker && (
              <button
                onClick={() => setShowPrLinker(true)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Link pull request"
              >
                <Link2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Display linked issues */}
      {githubIssues.map((link) => (
        <a
          key={link.id}
          href={link.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors mb-2"
        >
          <svg className="w-4 h-4 text-gray-600" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span className="text-sm text-gray-700">Issue #{link.externalId}</span>
          <ExternalLink className="w-3 h-3 text-gray-400 ml-auto" />
        </a>
      ))}

      {/* Display linked PRs */}
      {githubPRs.map((link) => (
        <a
          key={link.id}
          href={link.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors mb-2"
        >
          <svg className="w-4 h-4 text-gray-600" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
          </svg>
          <span className="text-sm text-gray-700">PR #{link.externalId}</span>
          <ExternalLink className="w-3 h-3 text-gray-400 ml-auto" />
        </a>
      ))}

      {/* Repo selector for creating issue */}
      {showIssueRepoSelector && (
        <div className="mt-2 p-3 border border-gray-200 rounded-lg bg-white">
          <p className="text-xs text-gray-500 mb-2">Select repository to create issue:</p>
          <div className="space-y-1">
            {integration?.repositories.map((repo) => (
              <button
                key={`${repo.owner}/${repo.repo}`}
                onClick={() => createIssueMutation.mutate({ owner: repo.owner, repo: repo.repo })}
                disabled={createIssueMutation.isPending}
                className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="text-gray-700">
                  {repo.owner}/{repo.repo}
                </span>
                {createIssueMutation.isPending && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
              </button>
            ))}
          </div>
          {createIssueMutation.isError && (
            <p className="mt-2 text-xs text-red-600">
              {createIssueMutation.error instanceof Error ? createIssueMutation.error.message : 'Failed to create issue'}
            </p>
          )}
          <button
            onClick={() => setShowIssueRepoSelector(false)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {showPrLinker && (
        <div className="mt-2 p-3 border border-gray-200 rounded-lg bg-white">
          <p className="text-xs text-gray-500 mb-2">Link existing pull request:</p>
          <div className="space-y-2">
            <select
              value={selectedPrRepo}
              onChange={(e) => setSelectedPrRepo(e.target.value)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none"
              disabled={linkPrMutation.isPending}
            >
              <option value="">Select repository</option>
              {integration?.repositories.map((repo) => (
                <option key={`${repo.owner}/${repo.repo}`} value={`${repo.owner}/${repo.repo}`}>
                  {repo.owner}/{repo.repo}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              step={1}
              placeholder="Pull request number"
              value={prNumber}
              onChange={(e) => setPrNumber(e.target.value)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none"
              disabled={linkPrMutation.isPending}
            />
            <button
              onClick={() => {
                const parsedPrNumber = Number(prNumber);
                if (!selectedPrRepo || !Number.isInteger(parsedPrNumber) || parsedPrNumber <= 0) {
                  return;
                }

                const [owner, repo] = selectedPrRepo.split('/');
                if (!owner || !repo) {
                  return;
                }

                linkPrMutation.mutate({ owner, repo, prNumber: parsedPrNumber });
              }}
              disabled={
                linkPrMutation.isPending ||
                !selectedPrRepo ||
                !Number.isInteger(Number(prNumber)) ||
                Number(prNumber) <= 0
              }
              className="inline-flex items-center gap-2 rounded bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {linkPrMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Link PR
            </button>
          </div>
          {linkPrMutation.isError && (
            <p className="mt-2 text-xs text-red-600">
              {linkPrMutation.error instanceof Error ? linkPrMutation.error.message : 'Failed to link pull request'}
            </p>
          )}
          <button
            onClick={() => {
              setShowPrLinker(false);
              setSelectedPrRepo('');
              setPrNumber('');
            }}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {externalLinks.length === 0 && hasIntegration && !showIssueRepoSelector && !showPrLinker && (
        <p className="text-sm text-gray-400 italic">No linked issues or pull requests</p>
      )}
    </div>
  );
}
