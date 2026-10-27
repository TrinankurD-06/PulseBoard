// What the header line says on its right: derived from the realtime connection
// and the number of open incidents (null while unknown).
export function liveStatus({ connected, openIncidents }) {
  if (!connected) {
    return {
      key: 'offline',
      label: 'Offline',
      title: 'Reconnecting; data refreshes every 30s meanwhile',
      dot: 'bg-status-paused',
      pulse: false,
    };
  }
  if (openIncidents > 0) {
    return {
      key: 'incidents',
      label: `${openIncidents} ${openIncidents === 1 ? 'incident' : 'incidents'} open`,
      title: 'Receiving live updates',
      dot: 'bg-status-down',
      pulse: false,
    };
  }
  return {
    key: 'normal',
    label: 'All systems normal',
    title: 'Receiving live updates',
    dot: 'bg-status-up',
    pulse: true,
  };
}
