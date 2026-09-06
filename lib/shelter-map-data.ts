export type ShelterZoneType =
  | 'gymnasium'
  | 'section'
  | 'toilet'
  | 'reception'
  | 'medical'
  | 'water'
  | 'food'
  | 'entrance';

export type ShelterRectShape = {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
};

export type ShelterZoneShape = ShelterRectShape;

export type ShelterMapZone = {
  id: string;
  name: string;
  type: ShelterZoneType;
  shape: ShelterZoneShape;
  labelPosition: { x: number; y: number };
  markerPosition: { x: number; y: number };
  description: string;
};

export type ShelterMapDefinition = {
  id: string;
  name: string;
  viewBox: string;
  zones: ShelterMapZone[];
};

export const DEMO_SHELTER_MAP: ShelterMapDefinition = {
  id: 'demo-central-shelter',
  name: '中央避難所（デモ）',
  viewBox: '0 0 900 620',
  zones: [
    {
      id: 'toilet-north', name: '北トイレ', type: 'toilet',
      shape: { kind: 'rect', x: 322, y: 20, width: 126, height: 68, rx: 18 },
      labelPosition: { x: 385, y: 70 }, markerPosition: { x: 385, y: 44 },
      description: '体育館の北側にあるトイレ',
    },
    {
      id: 'reception', name: '受付', type: 'reception',
      shape: { kind: 'rect', x: 48, y: 112, width: 126, height: 94, rx: 18 },
      labelPosition: { x: 111, y: 184 }, markerPosition: { x: 111, y: 140 },
      description: '相談や案内を受ける場所',
    },
    {
      id: 'medical', name: '救護所', type: 'medical',
      shape: { kind: 'rect', x: 48, y: 244, width: 126, height: 94, rx: 18 },
      labelPosition: { x: 111, y: 316 }, markerPosition: { x: 111, y: 272 },
      description: 'けがや体調を相談する場所',
    },
    {
      id: 'water', name: '給水所', type: 'water',
      shape: { kind: 'rect', x: 726, y: 112, width: 126, height: 94, rx: 18 },
      labelPosition: { x: 789, y: 184 }, markerPosition: { x: 789, y: 140 },
      description: '水を受け取る場所',
    },
    {
      id: 'food', name: '食事配布所', type: 'food',
      shape: { kind: 'rect', x: 726, y: 244, width: 126, height: 94, rx: 18 },
      labelPosition: { x: 789, y: 316 }, markerPosition: { x: 789, y: 272 },
      description: '食事や物資を受け取る場所',
    },
    {
      id: 'gymnasium', name: '体育館', type: 'gymnasium',
      shape: { kind: 'rect', x: 194, y: 106, width: 532, height: 386, rx: 32 },
      labelPosition: { x: 460, y: 122 }, markerPosition: { x: 460, y: 145 },
      description: '避難して過ごす大きな部屋',
    },
    {
      id: 'shelter-a', name: 'A区画', type: 'section',
      shape: { kind: 'rect', x: 220, y: 164, width: 228, height: 136, rx: 22 },
      labelPosition: { x: 334, y: 274 }, markerPosition: { x: 334, y: 208 },
      description: '体育館内の避難区画A',
    },
    {
      id: 'shelter-b', name: 'B区画', type: 'section',
      shape: { kind: 'rect', x: 472, y: 164, width: 228, height: 136, rx: 22 },
      labelPosition: { x: 586, y: 274 }, markerPosition: { x: 586, y: 208 },
      description: '体育館内の避難区画B',
    },
    {
      id: 'shelter-c', name: 'C区画', type: 'section',
      shape: { kind: 'rect', x: 220, y: 326, width: 228, height: 136, rx: 22 },
      labelPosition: { x: 334, y: 436 }, markerPosition: { x: 334, y: 370 },
      description: '体育館内の避難区画C',
    },
    {
      id: 'shelter-d', name: 'D区画', type: 'section',
      shape: { kind: 'rect', x: 472, y: 326, width: 228, height: 136, rx: 22 },
      labelPosition: { x: 586, y: 436 }, markerPosition: { x: 586, y: 370 },
      description: '体育館内の避難区画D',
    },
    {
      id: 'toilet-south', name: '南トイレ', type: 'toilet',
      shape: { kind: 'rect', x: 322, y: 524, width: 126, height: 68, rx: 18 },
      labelPosition: { x: 385, y: 574 }, markerPosition: { x: 385, y: 548 },
      description: '体育館の南側にあるトイレ',
    },
    {
      id: 'entrance', name: '入口', type: 'entrance',
      shape: { kind: 'rect', x: 726, y: 424, width: 126, height: 94, rx: 18 },
      labelPosition: { x: 789, y: 496 }, markerPosition: { x: 789, y: 452 },
      description: '避難所への出入り口',
    },
  ],
};

const LOCATION_ALIASES: Record<string, string> = {
  '体育館北側': 'shelter-a',
  '体育館南側': 'shelter-c',
  '救護スペース': 'medical',
  '救護所': 'medical',
  '食事配布': 'food',
  '食事配布所': 'food',
  '給水': 'water',
  '給水所': 'water',
  '北トイレ': 'toilet-north',
  '南トイレ': 'toilet-south',
  '体育館': 'gymnasium',
  '受付': 'reception',
  '入口': 'entrance',
};

export function resolveShelterZoneId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (DEMO_SHELTER_MAP.zones.some((zone) => zone.id === trimmed)) return trimmed;
  const exactName = DEMO_SHELTER_MAP.zones.find((zone) => zone.name === trimmed);
  return exactName?.id ?? LOCATION_ALIASES[trimmed] ?? '';
}

export function shelterLocationLabel(value: string): string {
  const zoneId = resolveShelterZoneId(value);
  return DEMO_SHELTER_MAP.zones.find((zone) => zone.id === zoneId)?.name ?? value;
}

export function getShelterZone(zoneIdOrName: string): ShelterMapZone | undefined {
  const zoneId = resolveShelterZoneId(zoneIdOrName);
  return DEMO_SHELTER_MAP.zones.find((zone) => zone.id === zoneId);
}
