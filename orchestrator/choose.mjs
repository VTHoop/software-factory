const rank = (priority) => (priority === 0 ? 5 : priority);

// The issue the script should start next, or null. Pure: it reads only its arguments.
export const chooseIssue = (issues, config) => {
  const eligible = issues.filter(
    (issue) =>
      issue.status === "Ready" &&
      config.projects.includes(issue.project) &&
      !issue.labels.includes("needs-owner") &&
      issue.blockedBy.every((blocker) => blocker.status === "Done"),
  );
  eligible.sort(
    (a, b) =>
      rank(a.priority) - rank(b.priority) || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  return eligible[0] ?? null;
};
