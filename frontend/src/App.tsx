import React, { useState, useEffect, useCallback } from 'react';
import {
  isConnected,
  getPublicKey,
  getCampaignsRegistry,
  getCampaignDetails,
  createCampaign,
  pledge,
  withdraw,
  claimRefund,
  getCampaignEvents,
  CampaignDetails,
  CampaignEvent,
} from './utils/stellar';
import deployedAddresses from './deployed_addresses.json';
import { 
  Wallet, 
  PlusCircle, 
  Calendar, 
  Target, 
  DollarSign, 
  User, 
  ChevronLeft, 
  Loader2, 
  Sparkles, 
  TrendingUp, 
  RefreshCw,
  Info
} from 'lucide-react';

const FACTORY_ID = deployedAddresses.factoryContractId;

export default function App() {
  const [walletConnected, setWalletConnected] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [campaignAddresses, setCampaignAddresses] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignDetails[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetails | null>(null);
  
  // Form states
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Interaction states
  const [pledgeAmount, setPledgeAmount] = useState('');
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  // Global UX states
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Live feed events
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 1. Check wallet connection
  const checkWallet = useCallback(async () => {
    try {
      const connected = await isConnected();
      if (connected) {
        setWalletConnected(true);
        const pubKey = await getPublicKey();
        if (pubKey) {
          setUserAddress(pubKey);
        }
      }
    } catch (e) {
      console.error('Wallet connection check failed:', e);
    }
  }, []);

  useEffect(() => {
    checkWallet();
  }, [checkWallet]);

  // Connect Wallet Action
  const handleConnectWallet = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const connected = await isConnected();
      if (!connected) {
        throw new Error('Freighter wallet extension not found. Please install Freighter.');
      }
      const pubKey = await getPublicKey();
      if (pubKey) {
        setUserAddress(pubKey);
        setWalletConnected(true);
        setSuccessMsg('Wallet connected successfully!');
      } else {
        throw new Error('User rejected connection or account is locked.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch all campaigns
  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const addresses = await getCampaignsRegistry(FACTORY_ID);
      setCampaignAddresses(addresses);
      
      const detailsList = await Promise.all(
        addresses.map((addr) => getCampaignDetails(addr, userAddress || undefined))
      );
      setCampaigns(detailsList);

      // Update selected campaign details if it is currently open
      if (selectedCampaign) {
        const updatedSelected = detailsList.find((c) => c.id === selectedCampaign.id);
        if (updatedSelected) {
          setSelectedCampaign(updatedSelected);
        }
      }
    } catch (err: any) {
      console.error('Error loading campaigns:', err);
      setErrorMsg('Failed to load campaigns from Stellar Testnet. Retrying...');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign, userAddress]);

  useEffect(() => {
    loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress]);

  // 3. Poll Campaign Events & Stats for Real-time updates
  useEffect(() => {
    if (campaigns.length === 0) return;

    const pollInterval = setInterval(async () => {
      // Refresh events for all campaigns or selected one
      const targetCampaignId = selectedCampaign?.id || campaigns[0]?.id;
      if (targetCampaignId) {
        const freshEvents = await getCampaignEvents(targetCampaignId);
        setEvents(freshEvents);
      }
      
      // Silently refresh current balances/stats without showing full-page loader
      try {
        const addresses = await getCampaignsRegistry(FACTORY_ID);
        const detailsList = await Promise.all(
          addresses.map((addr) => getCampaignDetails(addr, userAddress || undefined))
        );
        setCampaigns(detailsList);
        if (selectedCampaign) {
          const updatedSelected = detailsList.find((c) => c.id === selectedCampaign.id);
          if (updatedSelected) {
            setSelectedCampaign(updatedSelected);
          }
        }
      } catch (e) {
        console.warn('Silent refresh failed:', e);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [campaigns, selectedCampaign, userAddress]);

  // 4. Create Campaign Action
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setErrorMsg(null);
    setSuccessMsg(null);

    const goalVal = parseFloat(newGoal);
    if (isNaN(goalVal) || goalVal <= 0) {
      setFormError('Goal must be a positive number greater than 0.');
      return;
    }

    if (!newDeadline) {
      setFormError('Please select a valid deadline date.');
      return;
    }

    const deadlineUnix = Math.floor(new Date(newDeadline).getTime() / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    if (deadlineUnix <= nowUnix) {
      setFormError('Deadline must be a future date.');
      return;
    }

    if (!newTitle.trim() || !newDescription.trim()) {
      setFormError('Title and description are required.');
      return;
    }

    if (!userAddress) {
      setErrorMsg('Please connect your Freighter wallet to create a campaign.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await createCampaign(
        FACTORY_ID,
        userAddress,
        goalVal,
        deadlineUnix,
        newTitle,
        newDescription
      );
      setSuccessMsg(`Campaign created successfully! Contract Address: ${res.campaignAddress}`);
      setNewTitle('');
      setNewDescription('');
      setNewGoal('');
      setNewDeadline('');
      setShowCreateForm(false);
      await loadCampaigns();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to submit create campaign transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  // 5. Pledge Action
  const handlePledge = async (e: React.FormEvent) => {
    e.preventDefault();
    setPledgeError(null);
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedCampaign) return;

    const amountVal = parseFloat(pledgeAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      setPledgeError('Pledge amount must be greater than 0 XLM.');
      return;
    }

    if (!userAddress) {
      setErrorMsg('Please connect your Freighter wallet to pledge.');
      return;
    }

    setSubmitting(true);
    try {
      const txHash = await pledge(selectedCampaign.id, userAddress, amountVal);
      setSuccessMsg(`Pledge successful! Tx Hash: ${txHash.substring(0, 10)}...`);
      setPledgeAmount('');
      await loadCampaigns();
      // Instantly poll events
      const freshEvents = await getCampaignEvents(selectedCampaign.id);
      setEvents(freshEvents);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Pledge transaction rejected or failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // 6. Withdraw Action
  const handleWithdraw = async () => {
    if (!selectedCampaign || !userAddress) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const txHash = await withdraw(selectedCampaign.id, userAddress);
      setSuccessMsg(`Funds withdrawn successfully! Tx Hash: ${txHash.substring(0, 10)}...`);
      await loadCampaigns();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Withdraw transaction failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // 7. Claim Refund Action
  const handleClaimRefund = async () => {
    if (!selectedCampaign || !userAddress) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const txHash = await claimRefund(selectedCampaign.id, userAddress);
      setSuccessMsg(`Refund claimed successfully! Tx Hash: ${txHash.substring(0, 10)}...`);
      await loadCampaigns();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Claim refund transaction failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Helper utility for truncating addresses
  const truncateAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  // Select campaign helper
  const handleSelectCampaign = async (campaign: CampaignDetails) => {
    setSelectedCampaign(campaign);
    setEvents([]);
    setLoading(true);
    try {
      const freshEvents = await getCampaignEvents(campaign.id);
      setEvents(freshEvents);
    } catch (e) {
      console.error('Failed to load events for campaign:', e);
    } finally {
      setLoading(false);
    }
  };

  // Calculate percentages and statistics
  const getTotals = () => {
    let totalXlm = 0;
    campaigns.forEach((c) => {
      totalXlm += c.totalPledged;
    });
    return {
      campaignCount: campaigns.length,
      totalRaised: totalXlm.toFixed(2),
    };
  };

  const totals = getTotals();

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-slate-100 flex flex-col antialiased">
      {/* Toast Notification Container */}
      {(errorMsg || successMsg) && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md animate-bounce">
          {errorMsg && (
            <div className="bg-red-950/90 border border-red-500/50 text-red-200 px-5 py-4 rounded-xl shadow-2xl backdrop-blur-lg flex items-center space-x-3">
              <span className="font-semibold text-sm">{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="hover:text-white font-bold">×</button>
            </div>
          )}
          {successMsg && (
            <div className="bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 px-5 py-4 rounded-xl shadow-2xl backdrop-blur-lg flex items-center space-x-3">
              <span className="font-semibold text-sm text-ellipsis overflow-hidden">{successMsg}</span>
              <button onClick={() => setSuccessMsg(null)} className="hover:text-white font-bold">×</button>
            </div>
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {submitting && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="h-12 w-12 text-violet-500 animate-spin" />
          <p className="text-violet-200 font-medium text-lg">Signing & submitting transaction to Stellar Testnet...</p>
        </div>
      )}

      {/* Header */}
      <header className="glass sticky top-0 z-40 px-4 py-4 md:px-8 flex justify-between items-center transition-all">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setSelectedCampaign(null)}>
          <div className="h-10 w-10 bg-gradient-to-tr from-violet-600 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-violet-400 bg-clip-text text-transparent">
              StellarFund
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider text-violet-400">Testnet Protocol</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {walletConnected && userAddress ? (
            <div className="flex items-center space-x-2 bg-slate-900/80 border border-slate-800 rounded-full px-4 py-2 text-xs md:text-sm font-medium">
              <span className="h-2 w-2 bg-emerald-400 rounded-full animate-pulse"></span>
              <span className="text-slate-300 font-mono">{truncateAddress(userAddress)}</span>
            </div>
          ) : (
            <button
              onClick={handleConnectWallet}
              disabled={loading}
              className="flex items-center space-x-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 transform active:scale-95 shadow-md shadow-violet-500/20"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              <span>Connect Freighter</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col lg:flex-row gap-8">
        
        {/* Left / Main Section */}
        <section className="flex-1 flex flex-col space-y-8">
          
          {/* Breadcrumb / Nav */}
          {selectedCampaign && (
            <button
              onClick={() => setSelectedCampaign(null)}
              className="self-start flex items-center space-x-2 text-xs text-violet-400 hover:text-violet-300 transition-colors uppercase font-bold tracking-wider"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back to all Campaigns</span>
            </button>
          )}

          {/* Stats Bar */}
          {!selectedCampaign && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass p-6 rounded-2xl flex items-center space-x-4">
                <div className="h-12 w-12 bg-violet-500/10 border border-violet-500/20 rounded-xl flex items-center justify-center text-violet-400">
                  <Target className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{totals.campaignCount}</div>
                  <div className="text-xs text-slate-400 font-medium">Total Campaigns</div>
                </div>
              </div>

              <div className="glass p-6 rounded-2xl flex items-center space-x-4">
                <div className="h-12 w-12 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-xl flex items-center justify-center text-fuchsia-400">
                  <DollarSign className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{totals.totalRaised} XLM</div>
                  <div className="text-xs text-slate-400 font-medium">Total Pledged</div>
                </div>
              </div>

              <div className="glass p-6 rounded-2xl flex items-center space-x-4">
                <div className="h-12 w-12 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
                  <TrendingUp className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-2xl font-bold">Stellar Asset</div>
                  <div className="text-xs text-slate-400 font-medium">Escrow Protected</div>
                </div>
              </div>
            </div>
          )}

          {/* Campaign Details View */}
          {selectedCampaign ? (
            <div className="glass p-6 md:p-8 rounded-3xl flex flex-col space-y-6 relative overflow-hidden">
              {/* Highlight Background Glow */}
              <div className="absolute -top-24 -right-24 h-48 w-48 bg-violet-600/10 blur-[100px] rounded-full pointer-events-none"></div>

              {/* Title & Badge */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                    {selectedCampaign.title}
                  </h2>
                  <p className="text-xs font-mono text-slate-400 mt-1 flex items-center space-x-1">
                    <Info className="h-3 w-3" />
                    <span>Contract Address: {selectedCampaign.id}</span>
                  </p>
                </div>
                <span className={`self-start px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  selectedCampaign.status === 'Active' ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300' :
                  selectedCampaign.status === 'GoalMet' ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' :
                  selectedCampaign.status === 'Withdrawn' ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300' :
                  'bg-red-500/20 border border-red-500/40 text-red-300'
                }`}>
                  {selectedCampaign.status === 'GoalMet' ? 'Goal Met' : selectedCampaign.status}
                </span>
              </div>

              {/* Description */}
              <div className="border-t border-slate-800/80 pt-6">
                <h4 className="text-xs uppercase font-bold tracking-wider text-violet-400 mb-2">Campaign Story</h4>
                <p className="text-sm md:text-base text-slate-300 leading-relaxed">
                  {selectedCampaign.description}
                </p>
              </div>

              {/* Progress and Numbers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-slate-800/80 pt-6">
                {/* Progress Visual */}
                <div className="space-y-3">
                  <h4 className="text-xs uppercase font-bold tracking-wider text-violet-400">Funding Progress</h4>
                  <div>
                    <div className="flex justify-between text-sm font-semibold mb-1.5">
                      <span>{selectedCampaign.totalPledged.toFixed(2)} XLM Raised</span>
                      <span className="text-slate-400">of {selectedCampaign.goal} XLM Goal</span>
                    </div>
                    <div className="w-full h-3 bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(100, (selectedCampaign.totalPledged / selectedCampaign.goal) * 100)}%` }}
                      ></div>
                    </div>
                    <div className="text-right text-[10px] font-bold text-violet-400 mt-1">
                      {((selectedCampaign.totalPledged / selectedCampaign.goal) * 100).toFixed(0)}% Complete
                    </div>
                  </div>
                </div>

                {/* Campaign Metadata Details */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/40 border border-slate-800/50 p-4 rounded-xl">
                    <div className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1 flex items-center space-x-1">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>Deadline</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-200">
                      {new Date(selectedCampaign.deadline * 1000).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="bg-slate-900/40 border border-slate-800/50 p-4 rounded-xl">
                    <div className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1 flex items-center space-x-1">
                      <User className="h-3.5 w-3.5" />
                      <span>Creator</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-200 font-mono">
                      {truncateAddress(selectedCampaign.creator)}
                    </div>
                  </div>
                </div>
              </div>

              {/* User stats */}
              {userAddress && (
                <div className="bg-violet-950/20 border border-violet-500/20 p-4 rounded-2xl flex justify-between items-center text-sm">
                  <span className="text-slate-400 font-medium">Your Total Pledge Balance:</span>
                  <span className="font-bold text-violet-300">{selectedCampaign.userPledge.toFixed(2)} XLM</span>
                </div>
              )}

              {/* Dynamic Actions */}
              <div className="border-t border-slate-800/80 pt-6 flex flex-col space-y-4">
                <h4 className="text-xs uppercase font-bold tracking-wider text-violet-400">Escrow Interaction</h4>

                {/* Pledge Form (If active) */}
                {selectedCampaign.status === 'Active' ? (
                  <form onSubmit={handlePledge} className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                      <input
                        type="number"
                        placeholder="Amount in XLM (e.g. 50)"
                        value={pledgeAmount}
                        onChange={(e) => setPledgeAmount(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all font-mono"
                      />
                      <span className="absolute right-4 top-3 text-xs font-bold text-slate-500">XLM</span>
                    </div>
                    <button
                      type="submit"
                      disabled={!walletConnected}
                      className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm px-8 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center space-x-2"
                    >
                      <span>Pledge Funds</span>
                    </button>
                  </form>
                ) : null}

                {/* Wallet disclaimer */}
                {!walletConnected && selectedCampaign.status === 'Active' && (
                  <p className="text-xs text-amber-400 flex items-center space-x-1.5">
                    <span>⚠️ Please connect your Freighter wallet to pledge native XLM.</span>
                  </p>
                )}

                {/* Pledge validation error */}
                {pledgeError && <p className="text-xs text-red-400">{pledgeError}</p>}

                {/* Creator Withdraw Button */}
                {selectedCampaign.status === 'GoalMet' && userAddress === selectedCampaign.creator && (
                  <div className="bg-emerald-950/20 border border-emerald-500/20 p-6 rounded-2xl flex flex-col space-y-3">
                    <h5 className="font-semibold text-sm text-emerald-300">Campaign Completed Successfully!</h5>
                    <p className="text-xs text-slate-300">You are the campaign creator. Since the goal is met and the deadline has passed, you can claim the full campaign escrow balance.</p>
                    <button
                      onClick={handleWithdraw}
                      className="self-start bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-6 py-2.5 rounded-lg transition-all transform active:scale-95"
                    >
                      Withdraw Escrow Balance
                    </button>
                  </div>
                )}

                {/* Contributor Refund Button */}
                {selectedCampaign.status === 'Failed' && selectedCampaign.userPledge > 0 && (
                  <div className="bg-red-950/20 border border-red-500/20 p-6 rounded-2xl flex flex-col space-y-3">
                    <h5 className="font-semibold text-sm text-red-300">Campaign Failed to Meet Goal</h5>
                    <p className="text-xs text-slate-300">Since the campaign deadline has passed and the goal was not met, you can claim a 100% refund of your pledge.</p>
                    <button
                      onClick={handleClaimRefund}
                      className="self-start bg-red-600 hover:bg-red-500 text-white font-semibold text-xs px-6 py-2.5 rounded-lg transition-all transform active:scale-95"
                    >
                      Claim Refund ({selectedCampaign.userPledge.toFixed(2)} XLM)
                    </button>
                  </div>
                )}

                {/* Withdraw/Refund Status Details */}
                {selectedCampaign.status === 'Withdrawn' && (
                  <div className="bg-blue-950/20 border border-blue-500/20 p-6 rounded-2xl text-center">
                    <p className="text-sm font-medium text-blue-300">Funds have been withdrawn by the campaign creator. This campaign is successfully completed.</p>
                  </div>
                )}

                {selectedCampaign.status === 'Failed' && selectedCampaign.userPledge === 0 && (
                  <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl text-center">
                    <p className="text-sm text-slate-400">Campaign failed and has ended. (Only contributors can claim refunds)</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Grid of Campaigns / Default View
            <div className="flex flex-col space-y-6">
              
              {/* Heading & Toggle Form */}
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold uppercase tracking-wider text-violet-400 flex items-center space-x-2">
                  <Sparkles className="h-4.5 w-4.5 text-violet-400 animate-pulse" />
                  <span>Active Campaigns</span>
                </h3>
                
                <button
                  onClick={() => setShowCreateForm(!showCreateForm)}
                  className="flex items-center space-x-1.5 text-xs bg-slate-900 border border-slate-800 hover:border-violet-500/50 rounded-xl px-4 py-2.5 transition-all text-slate-300 font-semibold"
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>{showCreateForm ? 'Cancel' : 'Start a Campaign'}</span>
                </button>
              </div>

              {/* Create Campaign Form Card */}
              {showCreateForm && (
                <div className="glass p-6 md:p-8 rounded-3xl animate-in slide-in-from-top duration-300">
                  <h4 className="text-xl font-bold bg-gradient-to-r from-white to-violet-300 bg-clip-text text-transparent mb-4 flex items-center space-x-2">
                    <Sparkles className="h-5 w-5 text-violet-400" />
                    <span>Create Crowdfunding Campaign</span>
                  </h4>
                  
                  <form onSubmit={handleCreateCampaign} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Campaign Title</label>
                        <input
                          type="text"
                          placeholder="e.g. Tree Planting Drive"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          className="bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-200"
                        />
                      </div>
                      
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Goal Amount (XLM)</label>
                        <input
                          type="number"
                          placeholder="e.g. 5000"
                          value={newGoal}
                          onChange={(e) => setNewGoal(e.target.value)}
                          className="bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-200 font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">End Date (Deadline)</label>
                        <input
                          type="datetime-local"
                          value={newDeadline}
                          onChange={(e) => setNewDeadline(e.target.value)}
                          className="bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-200"
                        />
                      </div>

                      <div className="flex flex-col space-y-1.5">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description</label>
                        <input
                          type="text"
                          placeholder="Summary of the cause..."
                          value={newDescription}
                          onChange={(e) => setNewDescription(e.target.value)}
                          className="bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-200"
                        />
                      </div>
                    </div>

                    {formError && <p className="text-xs text-red-400 font-semibold">{formError}</p>}

                    <button
                      type="submit"
                      disabled={!walletConnected || submitting}
                      className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm py-3 rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center space-x-2"
                    >
                      <PlusCircle className="h-4.5 w-4.5" />
                      <span>Deploy Campaign Contract</span>
                    </button>
                    {!walletConnected && (
                      <p className="text-center text-amber-400 text-xs font-semibold">⚠️ Connect Freighter wallet to publish campaigns.</p>
                    )}
                  </form>
                </div>
              )}

              {/* Skeleton loading state */}
              {loading && campaigns.length === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[1, 2].map((i) => (
                    <div key={i} className="glass p-6 rounded-3xl space-y-4 animate-pulse">
                      <div className="h-6 bg-slate-800 rounded-full w-2/3"></div>
                      <div className="h-4 bg-slate-800 rounded-full w-full"></div>
                      <div className="h-4 bg-slate-800 rounded-full w-5/6"></div>
                      <div className="h-10 bg-slate-800 rounded-xl w-full"></div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty campaigns state */}
              {!loading && campaigns.length === 0 && (
                <div className="glass p-12 text-center rounded-3xl">
                  <Info className="h-12 w-12 text-violet-400/50 mx-auto mb-4" />
                  <h4 className="text-lg font-bold text-slate-300">No campaigns deployed yet</h4>
                  <p className="text-sm text-slate-400 mt-1.5 max-w-md mx-auto">Be the first to create a campaign on Stellar Testnet and deploy a new crowdfunding smart contract instance!</p>
                </div>
              )}

              {/* Grid Layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {campaigns.map((campaign) => {
                  const percent = Math.min(100, (campaign.totalPledged / campaign.goal) * 100);
                  return (
                    <div
                      key={campaign.id}
                      className="glass glass-hover p-6 rounded-3xl flex flex-col justify-between space-y-4 cursor-pointer relative"
                      onClick={() => handleSelectCampaign(campaign)}
                    >
                      {/* Active glow tag */}
                      {campaign.status === 'Active' && (
                        <div className="absolute top-4 right-4 h-2 w-2 bg-violet-400 rounded-full animate-ping"></div>
                      )}

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <h4 className="font-bold text-lg text-slate-200 group-hover:text-white line-clamp-1">
                            {campaign.title}
                          </h4>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            campaign.status === 'Active' ? 'bg-violet-500/10 border border-violet-500/30 text-violet-400' :
                            campaign.status === 'GoalMet' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' :
                            'bg-red-500/10 border border-red-500/30 text-red-400'
                          }`}>
                            {campaign.status}
                          </span>
                        </div>
                        <p className="text-slate-400 text-xs line-clamp-2 leading-relaxed">
                          {campaign.description}
                        </p>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="w-full h-1.5 bg-slate-900/60 rounded-full overflow-hidden border border-slate-800/50">
                          <div
                            className="h-full bg-gradient-to-r from-violet-600 to-indigo-500"
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-400">
                          <span>{percent.toFixed(0)}% Pledged</span>
                          <span className="text-slate-300">{campaign.totalPledged.toFixed(1)} / {campaign.goal} XLM</span>
                        </div>
                      </div>

                      <button className="w-full bg-slate-900 border border-slate-800 hover:border-violet-500/40 text-violet-400 group-hover:text-white rounded-xl py-2 text-xs font-semibold tracking-wider uppercase transition-colors">
                        View Details & Pledge
                      </button>
                    </div>
                  );
                })}
              </div>

            </div>
          )}
        </section>

        {/* Right Section: Recent Activity / Live Events feed */}
        <aside className="w-full lg:w-80 flex flex-col space-y-6">
          <div className="glass p-6 rounded-3xl flex flex-col h-[500px] relative overflow-hidden">
            {/* Title */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
              <h3 className="font-bold text-sm uppercase tracking-wider text-slate-200 flex items-center space-x-1.5">
                <RefreshCw className="h-4 w-4 text-violet-400 animate-spin-slow" />
                <span>Live activity Feed</span>
              </h3>
              <span className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-ping"></span>
            </div>

            {/* Event List Container */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {events.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                  <Info className="h-8 w-8 text-slate-500 mb-2" />
                  <p className="text-xs text-slate-400">No recent transactions yet.</p>
                  <p className="text-[10px] text-slate-500 mt-1 max-w-[200px]">Interactive pledges on-chain will appear here in real-time.</p>
                </div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="p-3 bg-slate-900/40 border border-slate-800/50 rounded-xl space-y-1.5 transition-all hover:bg-slate-900/60"
                  >
                    <div className="flex justify-between items-center text-[10px]">
                      <span className={`font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        event.type === 'pledge' ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' :
                        event.type === 'withdraw' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {event.type}
                      </span>
                      <span className="text-slate-500">
                        {new Date(event.timestamp * 1000).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="text-xs text-slate-300">
                      {event.type === 'pledge' ? (
                        <span>
                          <strong className="font-semibold text-slate-200">{truncateAddress(event.contributor)}</strong> pledged{' '}
                          <strong className="text-violet-400 font-bold">{event.amount} XLM</strong>
                        </span>
                      ) : event.type === 'withdraw' ? (
                        <span>
                          Creator claimed{' '}
                          <strong className="text-emerald-400 font-bold">{event.amount} XLM</strong> from escrow
                        </span>
                      ) : (
                        <span>
                          <strong className="font-semibold text-slate-200">{truncateAddress(event.contributor)}</strong> claimed a refund of{' '}
                          <strong className="text-red-400 font-bold">{event.amount} XLM</strong>
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Bottom Tag */}
            <div className="border-t border-slate-800/80 pt-3 mt-4 text-[9px] text-slate-500 text-center font-bold tracking-wider uppercase">
              Connected to Soroban RPC
            </div>
          </div>
        </aside>

      </main>

      {/* Footer */}
      <footer className="glass py-6 text-center text-xs text-slate-500 font-medium border-t border-slate-800/60 mt-12">
        <p>© 2026 StellarFund Crowdfunding Protocol. Deploying instances dynamically on Stellar Testnet.</p>
      </footer>
    </div>
  );
}
