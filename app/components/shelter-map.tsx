'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  DEMO_SHELTER_MAP,
  getShelterZone,
  resolveShelterZoneId,
  type ShelterMapZone,
  type ShelterZoneType,
} from '../../lib/shelter-map-data';

export type ShelterMapIssue = {
  id: number | string;
  title?: string;
  category: string;
  issueLocation?: string;
  reporterLocation?: string;
  location?: string;
  reportCount?: number;
  affectedPeople?: string;
  urgency?: string;
  status?: string;
};

type ShelterZoneProps = {
  zone: ShelterMapZone;
  selected: boolean;
  interactive: boolean;
  onSelect?: (zoneId: string) => void;
};

function zoneTypeLabel(type: ShelterZoneType): string {
  return type === 'section' ? '避難区画' : type === 'gymnasium' ? '建物' : '施設';
}

function shapeElement(zone: ShelterMapZone) {
  const shape = zone.shape;
  return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx ?? 0} />;
}

function ZoneIllustration({ zone }: { zone: ShelterMapZone }) {
  const { x, y } = zone.markerPosition;
  const common = { stroke: '#6b665b', strokeWidth: 2.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <g className={`shelter-map-illustration shelter-map-illustration-${zone.type}`} transform={`translate(${x} ${y})`} aria-hidden="true">
    {zone.type === 'section' && <>
      <rect x="-23" y="-11" width="46" height="22" rx="5" fill="#f3dfbf" {...common} />
      <rect x="-16" y="-7" width="15" height="9" rx="3" fill="#fff8ec" stroke="#d7b889" strokeWidth="1.4" />
      <path d="M6 -6h10M6 0h10M-18 7h36" fill="none" {...common} />
    </>}
    {zone.type === 'gymnasium' && <>
      <rect x="-24" y="-11" width="48" height="22" rx="5" fill="#e9f0e9" {...common} />
      <path d="M-14 -5h10v8h-10zM4 -5h10v8H4z" fill="#f8fbf4" stroke="#a6bca0" strokeWidth="1.6" />
      <path d="M-24 7h48" fill="none" {...common} />
    </>}
    {zone.type === 'toilet' && <>
      <rect x="-15" y="-11" width="30" height="22" rx="5" fill="#e2edf0" {...common} />
      <ellipse cx="0" cy="1" rx="7" ry="5" fill="#fff" {...common} />
      <path d="M-5 -6h10v4H-5z" fill="#fff" {...common} />
    </>}
    {zone.type === 'reception' && <>
      <path d="M-23 5h46M-18 5v7M18 5v7" fill="none" {...common} />
      <rect x="-19" y="-9" width="38" height="14" rx="3" fill="#fff8e6" {...common} />
      <path d="M-4 -5h8M0 -5v7" fill="none" stroke="#c1744c" strokeWidth="2" />
    </>}
    {zone.type === 'medical' && <>
      <rect x="-23" y="-5" width="46" height="12" rx="5" fill="#e7f0ed" {...common} />
      <path d="M-12 -9v26M-23 4h46" fill="none" {...common} />
      <path d="M-4 -8h9M.5 -12v9" fill="none" stroke="#bd6554" strokeWidth="3" />
    </>}
    {zone.type === 'water' && <>
      <path d="M-23 7h46M-18 7v6M18 7v6" fill="none" {...common} />
      <rect x="-14" y="-9" width="9" height="16" rx="3" fill="#d7eef5" {...common} />
      <path d="M-12 -12h5M-10 -14v2" fill="none" stroke="#4d9fbd" strokeWidth="2" />
      <path d="M7 -8c-5 7-5 10 0 10s5-3 0-10z" fill="#8dc8d9" stroke="#4d9fbd" strokeWidth="1.8" />
    </>}
    {zone.type === 'food' && <>
      <path d="M-23 7h46M-18 7v6M18 7v6" fill="none" {...common} />
      <ellipse cx="0" cy="-2" rx="17" ry="8" fill="#f3d49d" {...common} />
      <path d="M-10 -2h20M-8 1h16" fill="none" stroke="#c47c4c" strokeWidth="1.6" />
    </>}
    {zone.type === 'entrance' && <>
      <path d="M-18 12V-10h22v22M4 -10l12 5v17H4" fill="#f3ead9" {...common} />
      <path d="M-28 1h19M-15 -5l6 6-6 6" fill="none" stroke="#bd7352" strokeWidth="2.8" />
    </>}
  </g>;
}

export function ShelterZone({ zone, selected, interactive, onSelect }: ShelterZoneProps) {
  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (!interactive || !onSelect) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(zone.id);
    }
  };
  return <g
    className={`shelter-map-zone shelter-map-zone-${zone.type} ${selected ? 'is-selected' : ''} ${interactive ? 'is-interactive' : ''}`}
    role={interactive ? 'button' : undefined}
    tabIndex={interactive ? 0 : undefined}
    aria-label={`${zone.name}（${zoneTypeLabel(zone.type)}）。${zone.description}`}
    aria-pressed={interactive ? selected : undefined}
    onClick={interactive && onSelect ? () => onSelect(zone.id) : undefined}
    onKeyDown={handleKeyDown}
  >
    {shapeElement(zone)}
    <ZoneIllustration zone={zone} />
    <text className="shelter-map-zone-label" x={zone.labelPosition.x} y={zone.labelPosition.y} textAnchor="middle">{zone.name}</text>
    {selected && <path className="shelter-map-zone-check" d={`M${zone.labelPosition.x + 32} ${zone.labelPosition.y - 9}l7 7 13-16`} fill="none" />}
  </g>;
}

function issueIcon(category: string): string {
  if (/救護|医療|薬|けが|怪我|体調|熱/.test(category)) return '🩺';
  if (/トイレ/.test(category)) return '🚻';
  if (/衛生|手洗い|入浴/.test(category)) return '🧼';
  if (/水|飲料/.test(category)) return '💧';
  if (/食料|物資|毛布|衣類|おむつ|ミルク/.test(category)) return '🍱';
  if (/充電|通信/.test(category)) return '🔌';
  if (/ペット/.test(category)) return '🐾';
  if (/睡眠|寒さ|暑さ/.test(category)) return '🧣';
  if (/安全|危険|暴力|火災/.test(category)) return '🚨';
  return '💬';
}

export function IssueMarker({ zone, count, selected, issue, onSelect }: { zone: ShelterMapZone; count: number; selected: boolean; issue: ShelterMapIssue; onSelect: (issue: ShelterMapIssue) => void }) {
  const { x, y } = zone.markerPosition;
  const label = `${zone.name}、${issueIcon(issue.category)}の課題、相談${count}件。選択すると課題の詳細を表示します。`;
  return <g
    className={`shelter-map-issue-marker ${selected ? 'is-selected' : ''} shelter-map-issue-${issue.urgency ?? 'normal'}`}
    role="button"
    tabIndex={0}
    aria-label={label}
    onClick={() => onSelect(issue)}
    onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(issue);
      }
    }}
  >
    <rect className="shelter-map-issue-hit-area" x={x - 38} y={y - 37} width="76" height="66" rx="18" />
    <circle className="shelter-map-issue-badge" cx={x} cy={y - 12} r="24" />
    <text className="shelter-map-issue-icon" x={x} y={y - 17} textAnchor="middle">{issueIcon(issue.category)}</text>
    <text className="shelter-map-issue-count" x={x} y={y + 2} textAnchor="middle">{count}</text>
    <text className="shelter-map-issue-unit" x={x + 32} y={y - 20}>件</text>
  </g>;
}

export function MapLegend({ mode }: { mode: 'location-select' | 'issue-overview' }) {
  return <div className="shelter-map-legend" aria-label="マップの見方">
    {mode === 'location-select' ? <span><i className="shelter-map-legend-swatch shelter-map-legend-select" aria-hidden="true" />選択できます</span> : <span><i className="shelter-map-legend-swatch shelter-map-legend-issue" aria-hidden="true">3</i>課題の相談件数</span>}
    <span><i className="shelter-map-legend-swatch shelter-map-legend-life" aria-hidden="true">＋</i>生活施設</span>
  </div>;
}

function zoneIssueLocation(issue: ShelterMapIssue): string {
  return issue.issueLocation?.trim() || issue.location?.trim() || '';
}

export function ShelterMap({
  mode,
  selectedLocation = '',
  focusLocation = '',
  onSelectLocation,
  issues = [],
  onSelectIssue,
  className = '',
}: {
  mode: 'location-select' | 'issue-overview';
  selectedLocation?: string;
  focusLocation?: string;
  onSelectLocation?: (zoneId: string) => void;
  issues?: ShelterMapIssue[];
  onSelectIssue?: (issue: ShelterMapIssue) => void;
  className?: string;
}) {
  const titleId = `${useId()}-title`;
  const descId = `${useId()}-description`;
  const selectedZoneId = resolveShelterZoneId(selectedLocation);
  const focusedZoneId = resolveShelterZoneId(focusLocation);
  const issueMarkers = useMemo(() => {
    const grouped = new Map<string, { count: number; issue: ShelterMapIssue }>();
    issues.filter((issue) => !['resolved', 'cannot_resolve'].includes(issue.status ?? '')).forEach((issue) => {
      const zoneId = resolveShelterZoneId(zoneIssueLocation(issue));
      if (!zoneId) return;
      const current = grouped.get(zoneId);
      const reportCount = Math.max(1, Number(issue.reportCount ?? 1));
      if (current) current.count += reportCount;
      else grouped.set(zoneId, { count: reportCount, issue });
    });
    return Array.from(grouped.entries()).map(([zoneId, value]) => ({ zoneId, ...value }));
  }, [issues]);

  return <div className={`shelter-map ${className}`.trim()}>
    <svg className="shelter-map-svg" viewBox={DEMO_SHELTER_MAP.viewBox} role="group" aria-labelledby={`${titleId} ${descId}`}>
      <title id={titleId}>{mode === 'location-select' ? '場所を選ぶ避難所内マップ' : '課題件数を表示する避難所内マップ'}</title>
      <desc id={descId}>中央の体育館と、周囲のトイレ、受付、救護所、給水所、食事配布所、入口を表示しています。</desc>
      <rect className="shelter-map-ground" x="14" y="14" width="872" height="592" rx="34" />
      <path className="shelter-map-path" d="M176 158H194M176 290H194M726 158H744M726 290H744M460 88V106M460 492V524M726 471H704" />
      {DEMO_SHELTER_MAP.zones.map((zone) => <ShelterZone key={zone.id} zone={zone} selected={mode === 'location-select' ? zone.id === selectedZoneId : zone.id === focusedZoneId} interactive={mode === 'location-select'} onSelect={onSelectLocation} />)}
      {mode === 'issue-overview' && issueMarkers.map(({ zoneId, count, issue }) => {
        const zone = getShelterZone(zoneId);
        return zone && onSelectIssue ? <IssueMarker key={zoneId} zone={zone} count={count} issue={issue} selected={zoneId === focusedZoneId} onSelect={onSelectIssue} /> : null;
      })}
    </svg>
    <MapLegend mode={mode} />
    {mode === 'issue-overview' && <p className="shelter-map-help">数字のマーカーを選ぶと、その場所の課題詳細を確認できます。表示しているのは問題が起きている場所です。</p>}
  </div>;
}

export function LocationSelector({ value, onChange }: { value: string; onChange: (zoneId: string) => void }) {
  const [confirmedLocation, setConfirmedLocation] = useState('');
  const selectedZone = getShelterZone(value);
  const selectedZoneId = selectedZone?.id ?? resolveShelterZoneId(value);
  const selectableZones = DEMO_SHELTER_MAP.zones.filter((zone) => zone.type !== 'gymnasium');
  const selectZone = (zoneId: string) => {
    setConfirmedLocation('');
    onChange(zoneId);
  };
  return <div className="location-selector">
    <ShelterMap mode="location-select" selectedLocation={selectedZoneId} onSelectLocation={selectZone} />
    <div className="location-selector-choice" aria-live="polite">
      {selectedZone ? <p className="location-selector-selected"><span aria-hidden="true">✓</span><strong>{selectedZone.name}を選択しています</strong><small>{selectedZone.description}</small></p> : <p className="location-selector-placeholder">MAP上の場所を選ぶか、一覧から選んでください。</p>}
      <button className="button secondary location-selector-confirm" type="button" disabled={!selectedZoneId} onClick={() => setConfirmedLocation(selectedZoneId)}>この場所で決める</button>
      {confirmedLocation === selectedZoneId && selectedZone && <p className="location-selector-confirmed" role="status">{selectedZone.name}で受け付けます。下の「この内容で次へ」を押してください。</p>}
    </div>
    <details className="location-selector-list">
      <summary>一覧から選ぶ</summary>
      <div role="listbox" aria-label="避難所内の場所一覧">
        {selectableZones.map((zone) => <button type="button" role="option" aria-selected={zone.id === selectedZoneId} className={zone.id === selectedZoneId ? 'selected' : ''} key={zone.id} onClick={() => selectZone(zone.id)}><span aria-hidden="true">{zone.type === 'toilet' ? '🚻' : zone.type === 'section' ? '▤' : '＋'}</span><strong>{zone.name}</strong><small>{zone.description}</small></button>)}
      </div>
    </details>
  </div>;
}
