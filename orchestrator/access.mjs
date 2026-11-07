export const validBranch = (name) =>
  typeof name === "string" && /^[A-Za-z0-9/_-]+$/.test(name) && !name.startsWith("-");

// A PR is ours only when its branch lives in the configured repo itself.
export const isTrustedPr = (pr, config) =>
  pr.isCrossRepository === false &&
  pr.headRepository?.nameWithOwner === config.githubRepo &&
  validBranch(pr.headRefName);

// Comments come from the REST API, where the App's login is exactly `name[bot]`. No user login can
// contain `[`, so an exact match can't be taken by a user named like the App. (`gh pr view --json
// comments` shows the App as a bare `name`, with no is_bot, which is why it isn't used.)
export const trustedComments = (comments, config) =>
  comments.filter(({ author }) => {
    const login = author?.login;
    return config.trustedAuthors.includes(login) || (Boolean(config.appLogin) && login === config.appLogin);
  });
