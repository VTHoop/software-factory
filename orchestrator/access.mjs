export const validBranch = (name) =>
  typeof name === "string" && /^[A-Za-z0-9/_-]+$/.test(name) && !name.startsWith("-");

// A PR is ours only when its branch lives in the configured repo itself.
export const isTrustedPr = (pr, config) =>
  pr.isCrossRepository === false &&
  pr.headRepository?.nameWithOwner === config.githubRepo &&
  validBranch(pr.headRefName);

export const trustedComments = (comments, config) =>
  comments.filter((comment) => config.trustedAuthors.includes(comment.author?.login));
