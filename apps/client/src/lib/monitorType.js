// Which kind of monitor is this? Kept apart from lib/agent.js and lib/heartbeat.js, which
// pull in the form schemas (zod): a page that only needs to branch on the type (the
// monitor page) should not have to download them.
export const AGENT_TYPE = 'agent';
export const HEARTBEAT_TYPE = 'heartbeat';
export const isAgent = (monitor) => monitor?.type === AGENT_TYPE;
export const isHeartbeat = (monitor) => monitor?.type === HEARTBEAT_TYPE;
