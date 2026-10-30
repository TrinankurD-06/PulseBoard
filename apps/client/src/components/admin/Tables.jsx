import { Link } from 'react-router-dom';
import {
  incidentTone,
  monitorStateLabel,
  monitorTone,
  monitorTypeLabel,
} from '../../lib/adminConsole.js';
import { formatDuration, formatMs } from '../../lib/format.js';
import Badge from '../ui/Badge.jsx';
import CodeChip from '../ui/CodeChip.jsx';
import { TextLink, When } from './AdminBits.jsx';
import DataTable from './DataTable.jsx';

/** The state of a monitor with who paused it, and the administrator's note when there is one. */
export function MonitorState({ row }) {
  return (
    <div className="min-w-0">
      <div className="[&>span]:whitespace-normal">
        <Badge tone={monitorTone(row)}>{monitorStateLabel(row)}</Badge>
      </div>
      {row.isPaused && row.pauseNote && (
        <p className="mt-1 max-w-[28ch] text-xs break-words text-faint">{row.pauseNote}</p>
      )}
    </div>
  );
}

/** Name (opens the read-only monitor page) and URL. */
export function MonitorName({ row }) {
  return (
    <div className="min-w-0">
      <TextLink
        to={`/app/${row.workspace.id}/monitors/${row.id}`}
        className="font-medium wrap-anywhere"
      >
        {row.name}
      </TextLink>
      {row.url && <p className="font-mono text-[11px] break-all text-faint">{row.url}</p>}
    </div>
  );
}

export function LastCheck({ row, now }) {
  if (!row.lastCheckedAt) return <span className="text-faint">Not yet</span>;
  return (
    <div>
      <When value={row.lastCheckedAt} now={now} />
      <p className="text-xs text-faint">
        {row.lastOk === false ? 'Failed' : row.lastOk ? 'Passed' : ''}
        {row.lastResponseMs != null && ` · ${formatMs(row.lastResponseMs)}`}
      </p>
    </div>
  );
}

/** Monitors of one user or workspace: read-only, each name opens the full monitor page. */
export function MonitorSummaryTable({ rows, now, caption }) {
  const columns = [
    { key: 'name', header: 'Monitor', primary: true, cell: (row) => <MonitorName row={row} /> },
    { key: 'type', header: 'Type', cell: (row) => monitorTypeLabel(row.type) },
    { key: 'state', header: 'State', cell: (row) => <MonitorState row={row} /> },
    {
      key: 'workspace',
      header: 'Workspace',
      cell: (row) => (
        <TextLink to={`/app/admin/workspaces/${row.workspace.id}`} className="text-muted">
          {row.workspace.name}
        </TextLink>
      ),
    },
    { key: 'last', header: 'Last check', cell: (row) => <LastCheck row={row} now={now} /> },
  ];
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      empty={{ title: 'No monitors', description: 'There is nothing to show here.' }}
    />
  );
}

/** Incidents: status, monitor, cause, when and how long. Each row links to its timeline. */
export function IncidentsTable({ rows, now, caption, ...state }) {
  const columns = [
    {
      key: 'monitor',
      header: 'Monitor',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <TextLink
            to={`/app/${row.workspace.id}/monitors/${row.monitorId}`}
            className="font-medium wrap-anywhere"
          >
            {row.monitorName}
          </TextLink>
          <p className="text-xs wrap-anywhere text-faint">{row.workspace.name}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => {
        const tone = incidentTone(row);
        return <Badge tone={tone.tone}>{tone.label}</Badge>;
      },
    },
    {
      key: 'cause',
      header: 'Cause',
      wide: true,
      cell: (row) => (
        <span className="break-words">
          {row.causeCode && <CodeChip className="mr-2">{row.causeCode}</CodeChip>}
          {row.cause}
        </span>
      ),
    },
    { key: 'started', header: 'Started', cell: (row) => <When value={row.startedAt} now={now} /> },
    {
      key: 'duration',
      header: 'Duration',
      className: 'tabular-nums',
      cell: (row) =>
        row.resolvedAt
          ? formatDuration(row.durationSec)
          : `${formatDuration((now - new Date(row.startedAt).getTime()) / 1000)} so far`,
    },
    {
      key: 'timeline',
      header: 'Timeline',
      cell: (row) => (
        <Link
          to={`/app/admin/incidents/${row.id}`}
          aria-label={`Timeline of the incident on ${row.monitorName}`}
          className="text-fg underline decoration-line-strong underline-offset-4 transition-colors hover:text-brand"
        >
          Open
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      empty={{ title: 'No incidents', description: 'Nothing has gone wrong here.' }}
      {...state}
    />
  );
}
