/** How often an install is polled unless it says otherwise. */
export const connectorSchedules = ['hourly', 'daily', 'none'] as const;

export type ConnectorSchedule = (typeof connectorSchedules)[number];

const connectorName = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A connector's name is lower case with hyphens, such as `app-store-connect`. */
export function isConnectorName(name: string): boolean {
  return connectorName.test(name);
}
