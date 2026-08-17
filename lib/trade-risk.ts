export function normalizedRiskReward(entry:number,stopLoss:number,takeProfit:number):number{
  const riskDistance=Math.abs(entry-stopLoss);
  const rewardDistance=Math.abs(takeProfit-entry);
  return Number((riskDistance>0?rewardDistance/riskDistance:0).toFixed(5));
}

export function meetsMinimumRiskReward(actualRR:number,minimumRR:number):boolean{
  return actualRR>=minimumRR;
}

export function isStopDistanceWithinMaximum(actualDistance:number,maximumDistance:number):boolean{
  return actualDistance<=maximumDistance;
}
