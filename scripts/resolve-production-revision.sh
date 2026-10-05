#!/usr/bin/env bash
set -Eeuo pipefail

# Promote an exact main tree through a single-parent production commit. This
# preserves production's linear-history rule even when main has merge commits.
event_name="${GITHUB_EVENT_NAME:?GITHUB_EVENT_NAME is required}"
requested_sha="${MAIN_SHA:-}"
git fetch --no-tags origin main:refs/remotes/origin/main
main_tip="$(git rev-parse origin/main)"

case "$event_name" in
  workflow_dispatch)
    deploy_sha="${requested_sha:-$main_tip}"
    ;;
  push)
    case "${GITHUB_REF:-}" in
      refs/heads/main) deploy_sha="${GITHUB_SHA:?GITHUB_SHA is required}" ;;
      refs/heads/production)
        deploy_sha="${GITHUB_SHA:?GITHUB_SHA is required}"
        if ! git diff --quiet "$deploy_sha" "$main_tip"; then
          echo 'Production content must match current main.' >&2
          exit 1
        fi
        git checkout --detach "$deploy_sha"
        printf 'DEPLOY_SHA=%s\n' "$deploy_sha" >> "${GITHUB_ENV:?GITHUB_ENV is required}"
        exit 0
        ;;
      *) echo 'Only main or production may deploy.' >&2; exit 1 ;;
    esac
    ;;
  *) echo 'Unsupported deployment event.' >&2; exit 1 ;;
esac

if [[ "$deploy_sha" != "$main_tip" ]]; then
  echo "Requested revision is stale: current main is $main_tip. Run deployment again for current main." >&2
  exit 1
fi

git fetch --no-tags origin production:refs/remotes/origin/production
production_tip="$(git rev-parse origin/production)"
if ! git diff --quiet "$production_tip" "$deploy_sha"; then
  export GIT_AUTHOR_NAME='github-actions[bot]'
  export GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
  export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  release_commit="$(git commit-tree "$deploy_sha^{tree}" -p "$production_tip" -m "Deploy main $deploy_sha")"
  # Never force-push: a concurrent production update must fail safely.
  git push origin "$release_commit:refs/heads/production"
fi

git checkout --detach "$deploy_sha"
printf 'DEPLOY_SHA=%s\n' "$deploy_sha" >> "${GITHUB_ENV:?GITHUB_ENV is required}"
