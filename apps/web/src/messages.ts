import type {
  AppMetricGroup,
  CostGroup,
  ByHandGroup,
  ConnectorScheduleValue,
  GateCheck,
  GatePassValue,
  ListingStore,
  AgentKind,
  AssistantFeature,
  AgentScope,
  OptInScope,
  StandardPreset,
  TokenPreset,
  DecisionStatus,
  decisionSourceKinds,
  GateState,
  InboxSource,
  InboxStatus,
  ReleaseItemKind,
  ReleaseStatus,
  SessionState,
  BoardGroupName,
  CardColumn,
  CardPriority,
  EventArea,
  EventVia,
  PostStatus,
  LaunchTemplate,
  ProjectKind,
  Role,
  StartStepId,
  TabId,
  ViewId,
  ConnectorReason,
  TurnKind,
  RoutineEvent,
  RoutineRunState,
} from '@turnkeel/protocol';

/**
 * Every string the web app shows. English only; all strings go through here
 * (plain sentences, no numbers that were not measured).
 */
export const messages = {
  appName: 'Turnkeel',
} as const;
