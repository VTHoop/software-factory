export const validBranch = (name) =>
  typeof name === "string" && /^[A-Za-z0-9/_-]+$/.test(name) && !name.startsWith("-");

// A PR is ours only when its branch lives in the configured repo itself.
export const isTrustedPr = (pr, config) =>
  pr.isCrossRepository === false &&
  pr.headRepository?.nameWithOwner === config.githubRepo &&
  validBranch(pr.headRefName);

// The App's login is `name[bot]` in the REST API. `gh ... --json` shows it as `name`, or `app/name` for a
// PR author, with is_bot set. A plain user called `name` is not the App, so the short forms count only
// when GitHub says the author is a bot.
const isApp = (login, isBot, appLogin) => {
  if (!appLogin) return false;
  if (login === appLogin) return true;
  const slug = appLogin.replace(/\[bot\]$/, "");
  return isBot === true && (login === slug || login === `app/${slug}`);
};

export const trustedComments = (comments, config) =>
  comments.filter((comment) => {
    const { login, is_bot: isBot } = comment.author ?? {};
    return config.trustedAuthors.includes(login) || isApp(login, isBot, config.appLogin);
  });
