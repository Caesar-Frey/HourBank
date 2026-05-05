export async function sendReceipt(payload: {
  studentName: string;
  durationMinutes: number;
  topics: string[];
  notes: string;
  balanceAfter: number;
}): Promise<void> {
  console.log('[STUB] sendReceipt', JSON.stringify(payload, null, 2));
}

export async function sendTopUpConfirmation(payload: {
  studentName: string;
  hoursAdded: number;
  amountPaid: number;
  newBalance: number;
}): Promise<void> {
  console.log('[STUB] sendTopUpConfirmation', JSON.stringify(payload, null, 2));
}

export async function sendLowBalanceAlert(payload: {
  studentName: string;
  currentBalance: number;
}): Promise<void> {
  console.log('[STUB] sendLowBalanceAlert', JSON.stringify(payload, null, 2));
}
