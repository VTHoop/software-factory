// The entry that owns an issue: one listing its project, else the team-wide one.
export const entryFor = (config, { team, project }) => {
  const ofTeam = config.entries.filter((entry) => entry.team === team);
  return (
    ofTeam.find((entry) => entry.projects?.includes(project)) ??
    ofTeam.find((entry) => !entry.projects) ??
    null
  );
};
