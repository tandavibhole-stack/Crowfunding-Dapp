import {
  rpc,
  TransactionBuilder,
  Networks,
  Account,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import {
  isConnected as freighterIsConnected,
  requestAccess,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL);
const dummyAccount = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');

// Wrapper for checking if Freighter is connected (returns boolean directly)
export async function isConnected(): Promise<boolean> {
  try {
    const res = await freighterIsConnected();
    return !!res.isConnected;
  } catch {
    return false;
  }
}

// Wrapper for retrieving the connected public key (returns string directly)
export async function getPublicKey(): Promise<string | null> {
  try {
    const res = await requestAccess();
    if (res.error) {
      console.warn('Freighter requestAccess error:', res.error);
      return null;
    }
    return res.address;
  } catch (err) {
    console.error('Freighter requestAccess failed:', err);
    return null;
  }
}

// Helper to poll transaction status
async function pollTransactionStatus(txHash: string): Promise<rpc.Api.GetTransactionResponse> {
  let attempts = 0;
  while (attempts < 30) {
    const txRes = await server.getTransaction(txHash);
    if (txRes.status === 'SUCCESS') {
      return txRes;
    } else if (txRes.status === 'FAILED') {
      throw new Error(`Transaction failed: ${JSON.stringify(txRes.resultXdr)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    attempts++;
  }
  throw new Error('Transaction polling timed out');
}

// Read-only contract call simulator
async function callReadOnly(contractId: string, functionName: string, args: any[] = []): Promise<any> {
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(dummyAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  const simRes = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(simRes) && simRes.result) {
    const resultVal = simRes.result.retval;
    return scValToNative(resultVal);
  } else {
    throw new Error(`Simulation failed for read-only function "${functionName}": ${JSON.stringify(simRes)}`);
  }
}

// Write contract transaction executor
interface TxResult {
  hash: string;
  result: any;
}

async function executeTransaction(
  contractId: string,
  functionName: string,
  args: any[] = [],
  userPublicKey: string
): Promise<TxResult> {
  const contract = new Contract(contractId);
  const accountDetails = await server.getAccount(userPublicKey);
  const sourceAccount = new Account(userPublicKey, accountDetails.sequenceNumber());

  let tx = new TransactionBuilder(sourceAccount, {
    fee: '100', // Base fee to start simulation
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  // Simulate & prepare transaction
  tx = await server.prepareTransaction(tx);

  // Sign transaction with Freighter wallet
  const signedRes = await freighterSignTransaction(tx.toXDR(), {
    networkPassphrase: Networks.TESTNET,
    address: userPublicKey,
  });

  if (signedRes.error) {
    throw new Error(`Freighter signing error: ${signedRes.error}`);
  }

  const signedTx = TransactionBuilder.fromXDR(signedRes.signedTxXdr, Networks.TESTNET);
  const sendRes = await server.sendTransaction(signedTx);

  if (sendRes.status === 'PENDING') {
    const pollRes = (await pollTransactionStatus(sendRes.hash)) as any;
    let result = null;
    if (pollRes.returnValue) {
      result = scValToNative(pollRes.returnValue);
    }
    return { hash: pollRes.txHash || sendRes.hash, result };
  } else {
    throw new Error(`Transaction submission error: ${JSON.stringify(sendRes)}`);
  }
}

// 1. Get Campaign list from Factory Contract
export async function getCampaignsRegistry(factoryId: string): Promise<string[]> {
  try {
    const campaigns = await callReadOnly(factoryId, 'list_campaigns');
    return campaigns as string[];
  } catch (error) {
    console.error('Error fetching campaigns list:', error);
    return [];
  }
}

// 2. Get Campaign details
export interface CampaignDetails {
  id: string;
  creator: string;
  token: string;
  goal: number; // in XLM
  deadline: number; // Unix timestamp
  title: string;
  description: string;
  totalPledged: number; // in XLM
  status: 'Active' | 'GoalMet' | 'Failed' | 'Withdrawn';
  userPledge: number; // in XLM for current user
}

const STATUS_MAP = ['Active', 'GoalMet', 'Failed', 'Withdrawn'];

export async function getCampaignDetails(
  campaignId: string,
  userAddress?: string
): Promise<CampaignDetails> {
  const creator = await callReadOnly(campaignId, 'get_creator');
  const token = await callReadOnly(campaignId, 'get_token');
  const goalRaw = await callReadOnly(campaignId, 'get_goal');
  const deadlineRaw = await callReadOnly(campaignId, 'get_deadline');
  const title = await callReadOnly(campaignId, 'get_title');
  const description = await callReadOnly(campaignId, 'get_description');
  const totalPledgedRaw = await callReadOnly(campaignId, 'get_total_pledged');
  const statusIndex = await callReadOnly(campaignId, 'get_status');

  let userPledgeRaw = 0n;
  if (userAddress) {
    try {
      userPledgeRaw = await callReadOnly(campaignId, 'get_contributor_amount', [
        Address.fromString(userAddress).toScVal(),
      ]);
    } catch (e) {
      console.warn('Failed to fetch contributor amount:', e);
    }
  }

  const goal = Number(goalRaw) / 10_000_000;
  const totalPledged = Number(totalPledgedRaw) / 10_000_000;
  const userPledge = Number(userPledgeRaw) / 10_000_000;

  return {
    id: campaignId,
    creator,
    token,
    goal,
    deadline: Number(deadlineRaw),
    title: title.toString(),
    description: description.toString(),
    totalPledged,
    status: STATUS_MAP[statusIndex] as any,
    userPledge,
  };
}

// 3. Create Campaign (on Factory)
export async function createCampaign(
  factoryId: string,
  userPublicKey: string,
  goal: number,
  deadline: number,
  title: string,
  description: string
): Promise<{ hash: string; campaignAddress: string }> {
  const args = [
    Address.fromString(userPublicKey).toScVal(),
    nativeToScVal(BigInt(Math.round(goal * 10_000_000)), { type: 'i128' }),
    nativeToScVal(BigInt(deadline), { type: 'u64' }),
    nativeToScVal(title, { type: 'string' }),
    nativeToScVal(description, { type: 'string' }),
  ];

  const txRes = await executeTransaction(factoryId, 'create_campaign', args, userPublicKey);
  return { hash: txRes.hash, campaignAddress: txRes.result };
}

// 4. Pledge native XLM
export async function pledge(campaignId: string, userPublicKey: string, amount: number): Promise<string> {
  const args = [
    Address.fromString(userPublicKey).toScVal(),
    nativeToScVal(BigInt(Math.round(amount * 10_000_000)), { type: 'i128' }),
  ];
  const txRes = await executeTransaction(campaignId, 'pledge', args, userPublicKey);
  return txRes.hash;
}

// 5. Withdraw funds (creator only)
export async function withdraw(campaignId: string, userPublicKey: string): Promise<string> {
  const args = [Address.fromString(userPublicKey).toScVal()];
  const txRes = await executeTransaction(campaignId, 'withdraw', args, userPublicKey);
  return txRes.hash;
}

// 6. Claim refund (contributors only)
export async function claimRefund(campaignId: string, userPublicKey: string): Promise<string> {
  const args = [Address.fromString(userPublicKey).toScVal()];
  const txRes = await executeTransaction(campaignId, 'claim_refund', args, userPublicKey);
  return txRes.hash;
}

// 7. Get live campaign events from Soroban RPC
export interface CampaignEvent {
  id: string;
  type: 'pledge' | 'withdraw' | 'refund';
  contributor: string;
  amount: number;
  timestamp: number;
}

export async function getCampaignEvents(campaignId: string): Promise<CampaignEvent[]> {
  try {
    const latestLedgerRes = await server.getLatestLedger();
    const startLedger = Math.max(1, latestLedgerRes.sequence - 3000); // Last ~3000 ledgers (~4 hours)

    const eventsRes = await server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [campaignId],
        },
      ],
      limit: 50,
    });

    const parsedEvents: CampaignEvent[] = [];

    for (const event of eventsRes.events) {
      try {
        const topics = event.topic.map((t) => scValToNative(t));
        const value = scValToNative(event.value);

        const eventType = topics[0];
        
        if (eventType === 'pledge') {
          const contributor = topics[1];
          const amount = Number(value[0]) / 10_000_000;
          const timestamp = Number(value[1]);
          parsedEvents.push({
            id: event.id,
            type: 'pledge',
            contributor,
            amount,
            timestamp,
          });
        } else if (eventType === 'withdraw') {
          const contributor = topics[1]; // Creator address
          const amount = Number(value[0]) / 10_000_000;
          const timestamp = Number(value[1]);
          parsedEvents.push({
            id: event.id,
            type: 'withdraw',
            contributor,
            amount,
            timestamp,
          });
        } else if (eventType === 'refund') {
          const contributor = topics[1];
          const amount = Number(value[0]) / 10_000_000;
          const timestamp = Number(value[1]);
          parsedEvents.push({
            id: event.id,
            type: 'refund',
            contributor,
            amount,
            timestamp,
          });
        }
      } catch (err) {
        console.error('Failed to parse single event:', err, event);
      }
    }

    return parsedEvents.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error fetching campaign events:', error);
    return [];
  }
}
