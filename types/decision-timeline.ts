export type DecisionTimelineEventType='MARKET_DATA_VERIFIED'|'RULE_CONFIRMED'|'RULE_BECAME_MISSING'|'RULE_VIOLATED'|'SETUP_DETECTED'|'VERDICT_PRODUCED'|'FINAL_RISK_CHECK_COMPLETED'|'REPORT_SAVED';
export type DecisionTimelineState='CONFIRMED'|'MISSING'|'BLOCKED'|'INFORMATIONAL';
export type DecisionTimelineEvent={id:string;type:DecisionTimelineEventType;timestamp:string;title:string;description:string;state:DecisionTimelineState;ruleId?:string;evidenceIds:string[];deterministic:true};
export type DecisionTimeline={events:DecisionTimelineEvent[];detailedTimingAvailable:boolean};
