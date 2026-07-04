/** Busiest endpoints, rendered as a labelled horizontal bar chart. */
import type { EndpointUsage } from '../api.js';
import { trimDecimal } from '../format.js';
import { EmptyState } from './States.js';

export function TopEndpoints({ endpoints }: { endpoints: EndpointUsage[] }): JSX.Element {
  if (endpoints.length === 0) {
    return (
      <section className="card panel">
        <h2 className="panel-title">Top endpoints</h2>
        <EmptyState message="No endpoint activity yet." />
      </section>
    );
  }

  const maxCalls = Math.max(...endpoints.map((e) => e.calls), 1);

  return (
    <section className="card panel">
      <h2 className="panel-title">Top endpoints</h2>
      <ul className="bar-list">
        {endpoints.map((endpoint) => (
          <li className="bar-row" key={endpoint.endpoint}>
            <span className="bar-label" title={endpoint.endpoint}>
              {endpoint.endpoint}
            </span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(endpoint.calls / maxCalls) * 100}%` }}
              />
            </div>
            <span className="bar-value">
              {endpoint.calls}
              <span className="bar-value-sub"> · {trimDecimal(endpoint.revenue)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
