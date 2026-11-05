export const validBranch = (name) =>
  typeof name === "string" && /^[A-Za-z0-9/_-]+$/.test(name) && !name.startsWith("-");

// A PR is ours only when its branch lives in the configured repo itself.
export const isTrustedPr = (pr, config) =>
  pr.isCrossRepository === false &&
  pr.headRepository?.nameWithOwner === config.githubRepo &&
  validBranch(pr.headRefName);

// The App's login is `name[bot]` in the REST API; `gh ... --json` shows a bot as `name` with is_bot set.
// A plain user called `name` is not the App, so the short form counts only when GitHub says it is a bot.
const isApp = (login, isBot, appLogin) =>
  Boolean(appLogin) && (login === appLogin || (isBot === true && login === appLogin.replace(/\[bot\]$/, "")));

export const trustedComments = (comments, config) =>
  comments.filter((comment) => {
    const { login, is_bot: isBot } = comment.author ?? {};
    return config.trustedAuthors.includes(login) || isApp(login, isBot, config.appLogin);
  });
