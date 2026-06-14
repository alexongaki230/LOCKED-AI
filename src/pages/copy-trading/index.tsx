import { useEffect, useRef, useState, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './copy-trading.scss';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type CopyStatus = 'idle' | 'active' | 'stopped';

interface TradeLog {
    id: string;
    time: string;
    contract_type: string;
    symbol: string;
    amount: string;
    status: 'copied' | 'failed' | 'pending';
    message?: string;
}

const DERIV_WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';

const CopyTrading = observer(() => {
    const { client } = useStore() as any;

    const sourceToken: string = client?.account_list
        ? Object.values(client.account_list as Record<string, any>).find(
              (acc: any) => acc.loginid === client.loginid
          )?.token || localStorage.getItem('authToken') || ''
        : localStorage.getItem('authToken') || '';

    const isSourceDemo: boolean = client?.loginid
        ? String(client.loginid).startsWith('VRT') || String(client.loginid).startsWith('VRTC')
        : false;

    const [targetToken, setTargetToken] = useState('');
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
    const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
    const [allowDemoToReal, setAllowDemoToReal] = useState(false);
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
    const [targetAccountInfo, setTargetAccountInfo] = useState<{ loginid: string; currency: string; balance: string } | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [showTokenWarning, setShowTokenWarning] = useState(false);

    const [maxStake, setMaxStake] = useState('');
    const [dailyLossLimit, setDailyLossLimit] = useState('');
    const [riskAlert, setRiskAlert] = useState('');

    const [sessionTime, setSessionTime] = useState(0);
    const sessionStartRef = useRef<number | null>(null);
    const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startBalanceRef = useRef<number>(0);
    const dailyLossLimitRef = useRef<number | null>(null);
    const maxStakeRef = useRef<number | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stats = useMemo(() => {
        const tradeLogs_real = tradeLogs.filter(l => l.contract_type !== 'SYSTEM');
        const copied = tradeLogs_real.filter(l => l.status === 'copied').length;
        const failed = tradeLogs_real.filter(l => l.status === 'failed').length;
        const total = copied + failed;
        const successRate = total > 0 ? Math.round((copied / total) * 100) : null;
        const volume = tradeLogs_real
            .filter(l => l.status === 'copied')
            .reduce((sum, l) => {
                const num = parseFloat(l.amount.split(' ')[0]);
                return sum + (isNaN(num) ? 0 : num);
            }, 0);
        const currency = tradeLogs_real.find(l => l.amount.includes(' '))?.amount.split(' ')[1] ?? '';
        return { copied, failed, total, successRate, volume, currency };
    }, [tradeLogs]);

    const formatSessionTime = (secs: number) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    };

    const addLog = (log: Omit<TradeLog, 'id' | 'time'>) => {
        setTradeLogs(prev => [
            {
                ...log,
                id: Math.random().toString(36).slice(2),
                time: new Date().toLocaleTimeString(),
            },
            ...prev.slice(0, 49),
        ]);
    };

    const disconnectWS = () => {
        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }
        if (sessionTimerRef.current) {
            clearInterval(sessionTimerRef.current);
            sessionTimerRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setConnectionStatus('disconnected');
        setCopyStatus('idle');
        setTargetAccountInfo(null);
    };

    useEffect(() => {
        return () => disconnectWS();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (copyStatus === 'active') {
            sessionStartRef.current = Date.now();
            setSessionTime(0);
            sessionTimerRef.current = setInterval(() => {
                if (sessionStartRef.current) {
                    setSessionTime(Math.floor((Date.now() - sessionStartRef.current) / 1000));
                }
            }, 1000);
        } else {
            if (sessionTimerRef.current) {
                clearInterval(sessionTimerRef.current);
                sessionTimerRef.current = null;
            }
        }
        return () => {
            if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
        };
    }, [copyStatus]);

    const connectAndAuthorize = async (): Promise<boolean> => {
        return new Promise(resolve => {
            setConnectionStatus('connecting');
            setErrorMsg('');

            const ws = new WebSocket(DERIV_WS_URL);
            wsRef.current = ws;

            const timeout = setTimeout(() => {
                ws.close();
                setConnectionStatus('error');
                setErrorMsg('Connection timed out. Please try again.');
                resolve(false);
            }, 15000);

            ws.onopen = () => {
                ws.send(JSON.stringify({ authorize: targetToken }));
            };

            ws.onmessage = (msg: MessageEvent) => {
                const data = JSON.parse(msg.data);

                if (data.msg_type === 'authorize') {
                    clearTimeout(timeout);
                    if (data.error) {
                        setConnectionStatus('error');
                        setErrorMsg(`Authorization failed: ${data.error.message}`);
                        ws.close();
                        resolve(false);
                        return;
                    }
                    const acc = data.authorize;
                    startBalanceRef.current = Number(acc.balance);
                    setTargetAccountInfo({
                        loginid: acc.loginid,
                        currency: acc.currency,
                        balance: Number(acc.balance).toFixed(2),
                    });
                    setConnectionStatus('connected');
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    pingIntervalRef.current = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ ping: 1 }));
                        }
                    }, 25000);
                    resolve(true);
                }

                if (data.msg_type === 'balance') {
                    if (data.balance && !data.error) {
                        setTargetAccountInfo(prev =>
                            prev
                                ? {
                                      ...prev,
                                      balance: Number(data.balance.balance).toFixed(2),
                                      currency: data.balance.currency || prev.currency,
                                  }
                                : prev
                        );
                    }
                }

                if (data.msg_type === 'copy_start') {
                    if (data.error) {
                        addLog({
                            contract_type: '—',
                            symbol: '—',
                            amount: '—',
                            status: 'failed',
                            message: `Copy start failed: ${data.error.message}`,
                        });
                    }
                }

                if (data.msg_type === 'copy_stop') {
                    if (data.error) {
                        addLog({
                            contract_type: '—',
                            symbol: '—',
                            amount: '—',
                            status: 'failed',
                            message: `Copy stop failed: ${data.error.message}`,
                        });
                    }
                }

                if (data.msg_type === 'transaction') {
                    const txn = data.transaction;
                    if (txn?.action === 'buy') {
                        const stakeAmt = txn.amount ? Number(txn.amount) : 0;
                        const maxStakeVal = maxStakeRef.current;

                        if (maxStakeVal !== null && stakeAmt > maxStakeVal) {
                            addLog({
                                contract_type: txn.contract_type || 'CONTRACT',
                                symbol: txn.symbol || '—',
                                amount: `${stakeAmt.toFixed(2)} ${txn.currency || ''}`,
                                status: 'failed',
                                message: `⛔ Stake ${stakeAmt.toFixed(2)} exceeds max stake limit of ${maxStakeVal}. Trade skipped.`,
                            });
                        } else {
                            addLog({
                                contract_type: txn.contract_type || 'CONTRACT',
                                symbol: txn.symbol || '—',
                                amount: `${stakeAmt > 0 ? stakeAmt.toFixed(2) : '—'} ${txn.currency || ''}`,
                                status: 'copied',
                                message: `Contract ID: ${txn.contract_id || '—'}`,
                            });
                        }

                        if (txn.balance) {
                            const currentBalance = Number(txn.balance);
                            setTargetAccountInfo(prev =>
                                prev ? { ...prev, balance: currentBalance.toFixed(2) } : prev
                            );

                            const lossLimitVal = dailyLossLimitRef.current;
                            if (lossLimitVal !== null) {
                                const loss = startBalanceRef.current - currentBalance;
                                if (loss >= lossLimitVal) {
                                    ws.send(JSON.stringify({ copy_stop: sourceToken }));
                                    setRiskAlert(`🛑 Daily loss limit of ${lossLimitVal} reached (loss: ${loss.toFixed(2)}). Copy trading auto-stopped.`);
                                    addLog({
                                        contract_type: 'SYSTEM',
                                        symbol: '—',
                                        amount: '—',
                                        status: 'failed',
                                        message: `Daily loss limit of ${lossLimitVal} reached. Auto-stopped.`,
                                    });
                                    setCopyStatus('stopped');
                                    ws.close();
                                }
                            }
                        }
                    }
                }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                setConnectionStatus('error');
                setErrorMsg('WebSocket error. Please check your token and try again.');
                resolve(false);
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                if (pingIntervalRef.current) {
                    clearInterval(pingIntervalRef.current);
                    pingIntervalRef.current = null;
                }
                if (copyStatus === 'active') {
                    setConnectionStatus('error');
                    setErrorMsg('Connection lost. Copy trading stopped.');
                    setCopyStatus('stopped');
                }
            };
        });
    };

    const startCopyTrading = async () => {
        if (!targetToken.trim()) {
            setErrorMsg('Please enter the target account API token.');
            return;
        }
        if (!sourceToken) {
            setErrorMsg('Source account token not found. Please log in first.');
            return;
        }

        const parsedMaxStake = maxStake.trim() ? parseFloat(maxStake) : null;
        const parsedLossLimit = dailyLossLimit.trim() ? parseFloat(dailyLossLimit) : null;

        if (parsedMaxStake !== null && (isNaN(parsedMaxStake) || parsedMaxStake <= 0)) {
            setErrorMsg('Max stake must be a positive number.');
            return;
        }
        if (parsedLossLimit !== null && (isNaN(parsedLossLimit) || parsedLossLimit <= 0)) {
            setErrorMsg('Daily loss limit must be a positive number.');
            return;
        }

        maxStakeRef.current = parsedMaxStake;
        dailyLossLimitRef.current = parsedLossLimit;
        setRiskAlert('');

        if (isSourceDemo && !allowDemoToReal) {
            setShowTokenWarning(true);
            return;
        }

        const ok = await connectAndAuthorize();
        if (!ok) return;

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
                JSON.stringify({
                    copy_start: sourceToken,
                    assets: [],
                    trade_types: [],
                    min_trade_stake: null,
                    max_trade_stake: parsedMaxStake,
                })
            );
            wsRef.current.send(JSON.stringify({ transaction: 1, subscribe: 1 }));
            setCopyStatus('active');
            addLog({
                contract_type: 'SYSTEM',
                symbol: '—',
                amount: '—',
                status: 'copied',
                message: 'Copy trading started. Monitoring source account for trades...',
            });
        }
    };

    const stopCopyTrading = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ copy_stop: sourceToken }));
        }
        addLog({
            contract_type: 'SYSTEM',
            symbol: '—',
            amount: '—',
            status: 'pending',
            message: 'Copy trading stopped by user.',
        });
        disconnectWS();
        setCopyStatus('stopped');
    };

    const handleTokenInput = (val: string) => {
        setTargetToken(val);
        setErrorMsg('');
    };

    const confirmDemoToReal = () => {
        setShowTokenWarning(false);
        setAllowDemoToReal(true);
        startCopyTrading();
    };

    return (
        <div className='copy-trading'>
            {showTokenWarning && (
                <div className='copy-trading__overlay'>
                    <div className='copy-trading__warning-modal'>
                        <div className='copy-trading__warning-modal-icon'>⚠️</div>
                        <h3>Demo to Real Copy Warning</h3>
                        <p>
                            You are about to copy trades from a <strong>Demo account</strong> to a{' '}
                            <strong>Real account</strong>. Real money will be used for copied trades.
                            Are you sure you want to proceed?
                        </p>
                        <div className='copy-trading__warning-modal-actions'>
                            <button
                                className='copy-trading__btn copy-trading__btn--secondary'
                                onClick={() => setShowTokenWarning(false)}
                            >
                                Cancel
                            </button>
                            <button className='copy-trading__btn copy-trading__btn--danger' onClick={confirmDemoToReal}>
                                Yes, Proceed
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className='copy-trading__header'>
                <div className='copy-trading__header-icon'>🔁</div>
                <div>
                    <h1 className='copy-trading__title'>Copy Trading</h1>
                    <p className='copy-trading__subtitle'>
                        Mirror trades from your logged-in account to another account using its API token.
                    </p>
                </div>
            </div>

            <div className='copy-trading__content'>
                <div className='copy-trading__left'>
                    <div className='copy-trading__card'>
                        <h2 className='copy-trading__card-title'>Source Account</h2>
                        <div className='copy-trading__account-row'>
                            <span className='copy-trading__account-label'>Login ID</span>
                            <span className='copy-trading__account-value'>
                                {client?.loginid || 'Not logged in'}
                            </span>
                        </div>
                        <div className='copy-trading__account-row'>
                            <span className='copy-trading__account-label'>Type</span>
                            <span
                                className={`copy-trading__badge ${
                                    isSourceDemo ? 'copy-trading__badge--demo' : 'copy-trading__badge--real'
                                }`}
                            >
                                {isSourceDemo ? 'Demo' : 'Real'}
                            </span>
                        </div>
                        <div className='copy-trading__account-row'>
                            <span className='copy-trading__account-label'>Token</span>
                            <span className='copy-trading__account-value copy-trading__token-mask'>
                                {sourceToken ? `${sourceToken.slice(0, 6)}${'•'.repeat(10)}` : 'N/A'}
                            </span>
                        </div>
                    </div>

                    <div className='copy-trading__card'>
                        <h2 className='copy-trading__card-title'>Target Account</h2>
                        <label className='copy-trading__label'>API Token</label>
                        <input
                            className='copy-trading__input'
                            type='password'
                            placeholder='Enter target account API token...'
                            value={targetToken}
                            onChange={e => handleTokenInput(e.target.value)}
                            disabled={copyStatus === 'active'}
                        />
                        <p className='copy-trading__input-hint'>
                            Generate an API token from the target account's{' '}
                            <a
                                href='https://app.deriv.com/account/api-token'
                                target='_blank'
                                rel='noopener noreferrer'
                                className='copy-trading__link'
                            >
                                API Token settings
                            </a>
                            . Ensure the token has <strong>Trade</strong> permission.
                        </p>

                        {targetAccountInfo && (
                            <div className='copy-trading__target-info'>
                                <div className='copy-trading__account-row'>
                                    <span className='copy-trading__account-label'>Login ID</span>
                                    <span className='copy-trading__account-value'>{targetAccountInfo.loginid}</span>
                                </div>
                                <div className='copy-trading__account-row'>
                                    <span className='copy-trading__account-label'>Balance</span>
                                    <span className='copy-trading__account-value'>
                                        {targetAccountInfo.balance} {targetAccountInfo.currency}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {isSourceDemo && allowDemoToReal && (
                        <div className='copy-trading__card copy-trading__card--balance'>
                            <h2 className='copy-trading__card-title'>
                                💳 Real Account Balance
                                {copyStatus === 'active' && (
                                    <span className='copy-trading__balance-live-dot' title='Live' />
                                )}
                            </h2>
                            {targetAccountInfo ? (
                                <div className='copy-trading__balance-display'>
                                    <span className='copy-trading__balance-amount'>
                                        {targetAccountInfo.balance}
                                    </span>
                                    <span className='copy-trading__balance-currency'>
                                        {targetAccountInfo.currency}
                                    </span>
                                    {startBalanceRef.current > 0 && (
                                        <span
                                            className={`copy-trading__balance-change ${
                                                Number(targetAccountInfo.balance) >= startBalanceRef.current
                                                    ? 'copy-trading__balance-change--up'
                                                    : 'copy-trading__balance-change--down'
                                            }`}
                                        >
                                            {Number(targetAccountInfo.balance) >= startBalanceRef.current ? '+' : ''}
                                            {(Number(targetAccountInfo.balance) - startBalanceRef.current).toFixed(2)}
                                        </span>
                                    )}
                                    <div className='copy-trading__balance-row'>
                                        <span className='copy-trading__account-label'>Account</span>
                                        <span className='copy-trading__account-value'>{targetAccountInfo.loginid}</span>
                                    </div>
                                    <div className='copy-trading__balance-row'>
                                        <span className='copy-trading__account-label'>Session start</span>
                                        <span className='copy-trading__account-value'>
                                            {startBalanceRef.current > 0 ? `${startBalanceRef.current.toFixed(2)} ${targetAccountInfo.currency}` : '—'}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <p className='copy-trading__balance-idle'>
                                    Start copy trading to see the real account balance live.
                                </p>
                            )}
                        </div>
                    )}

                    <div className='copy-trading__card'>
                        <h2 className='copy-trading__card-title'>Settings & Risk Controls</h2>
                        <div className='copy-trading__setting-row'>
                            <div>
                                <span className='copy-trading__setting-label'>Allow Demo → Real</span>
                                <p className='copy-trading__setting-desc'>Copy demo trades to a real account.</p>
                            </div>
                            <button
                                className={`copy-trading__toggle ${allowDemoToReal ? 'copy-trading__toggle--on' : ''}`}
                                onClick={() => setAllowDemoToReal(v => !v)}
                                disabled={copyStatus === 'active'}
                                aria-label='Toggle demo to real copying'
                            >
                                <span className='copy-trading__toggle-knob' />
                            </button>
                        </div>
                        <div className='copy-trading__risk-row'>
                            <div className='copy-trading__risk-field'>
                                <label className='copy-trading__risk-label'>
                                    <span className='copy-trading__risk-icon'>🔒</span> Max Stake / Trade
                                </label>
                                <input
                                    className='copy-trading__risk-input'
                                    type='number'
                                    min='0.01'
                                    step='0.01'
                                    placeholder='e.g. 5.00'
                                    value={maxStake}
                                    onChange={e => setMaxStake(e.target.value)}
                                    disabled={copyStatus === 'active'}
                                />
                                <p className='copy-trading__risk-hint'>Skips trades above this amount</p>
                            </div>
                            <div className='copy-trading__risk-field'>
                                <label className='copy-trading__risk-label'>
                                    <span className='copy-trading__risk-icon'>🛑</span> Daily Loss Limit
                                </label>
                                <input
                                    className='copy-trading__risk-input'
                                    type='number'
                                    min='0.01'
                                    step='0.01'
                                    placeholder='e.g. 50.00'
                                    value={dailyLossLimit}
                                    onChange={e => setDailyLossLimit(e.target.value)}
                                    disabled={copyStatus === 'active'}
                                />
                                <p className='copy-trading__risk-hint'>Auto-stops when loss reaches this</p>
                            </div>
                        </div>
                    </div>

                    {riskAlert && (
                        <div className='copy-trading__risk-alert'>
                            {riskAlert}
                        </div>
                    )}

                    {errorMsg && (
                        <div className='copy-trading__error'>
                            <span>⚠️</span> {errorMsg}
                        </div>
                    )}

                    <div className='copy-trading__actions'>
                        {copyStatus !== 'active' ? (
                            <button
                                className='copy-trading__btn copy-trading__btn--primary'
                                onClick={startCopyTrading}
                                disabled={connectionStatus === 'connecting'}
                            >
                                {connectionStatus === 'connecting' ? (
                                    <span className='copy-trading__spinner' />
                                ) : (
                                    '▶'
                                )}
                                {connectionStatus === 'connecting' ? 'Connecting...' : 'Start Copy Trading'}
                            </button>
                        ) : (
                            <button
                                className='copy-trading__btn copy-trading__btn--stop'
                                onClick={stopCopyTrading}
                            >
                                ■ Stop Copy Trading
                            </button>
                        )}
                    </div>

                    <div className='copy-trading__status-bar'>
                        <span
                            className={`copy-trading__status-dot copy-trading__status-dot--${connectionStatus}`}
                        />
                        <span className='copy-trading__status-text'>
                            {connectionStatus === 'disconnected' && 'Not connected'}
                            {connectionStatus === 'connecting' && 'Connecting to target account...'}
                            {connectionStatus === 'connected' && copyStatus === 'active' && 'Copying trades — live'}
                            {connectionStatus === 'connected' && copyStatus !== 'active' && 'Connected'}
                            {connectionStatus === 'error' && 'Connection error'}
                        </span>
                    </div>
                </div>

                <div className='copy-trading__right'>
                    <div className='copy-trading__stats-strip'>
                        <div className='copy-trading__stat'>
                            <span className='copy-trading__stat-value'>{stats.copied}</span>
                            <span className='copy-trading__stat-label'>Copied</span>
                        </div>
                        <div className='copy-trading__stat-divider' />
                        <div className='copy-trading__stat'>
                            <span className='copy-trading__stat-value copy-trading__stat-value--fail'>{stats.failed}</span>
                            <span className='copy-trading__stat-label'>Failed</span>
                        </div>
                        <div className='copy-trading__stat-divider' />
                        <div className='copy-trading__stat'>
                            <span className='copy-trading__stat-value copy-trading__stat-value--rate'>
                                {stats.successRate !== null ? `${stats.successRate}%` : '—'}
                            </span>
                            <span className='copy-trading__stat-label'>Success Rate</span>
                        </div>
                        <div className='copy-trading__stat-divider' />
                        <div className='copy-trading__stat'>
                            <span className='copy-trading__stat-value'>
                                {stats.volume > 0 ? `${stats.volume.toFixed(2)} ${stats.currency}` : '—'}
                            </span>
                            <span className='copy-trading__stat-label'>Volume</span>
                        </div>
                        <div className='copy-trading__stat-divider' />
                        <div className='copy-trading__stat'>
                            <span className={`copy-trading__stat-value ${copyStatus === 'active' ? 'copy-trading__stat-value--live' : ''}`}>
                                {copyStatus === 'active' || sessionTime > 0 ? formatSessionTime(sessionTime) : '—'}
                            </span>
                            <span className='copy-trading__stat-label'>Session Time</span>
                        </div>
                    </div>

                    <div className='copy-trading__card copy-trading__card--full'>
                        <div className='copy-trading__log-header'>
                            <h2 className='copy-trading__card-title'>Trade Log</h2>
                            {tradeLogs.length > 0 && (
                                <button
                                    className='copy-trading__btn-clear'
                                    onClick={() => setTradeLogs([])}
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {tradeLogs.length === 0 ? (
                            <div className='copy-trading__log-empty'>
                                <div className='copy-trading__log-empty-icon'>📋</div>
                                <p>No trades copied yet. Start copy trading to see activity here.</p>
                            </div>
                        ) : (
                            <div className='copy-trading__log-list'>
                                {tradeLogs.map(log => (
                                    <div key={log.id} className={`copy-trading__log-item copy-trading__log-item--${log.status}`}>
                                        <div className='copy-trading__log-item-top'>
                                            <span className='copy-trading__log-item-time'>{log.time}</span>
                                            <span className={`copy-trading__log-badge copy-trading__log-badge--${log.status}`}>
                                                {log.status === 'copied' && '✓ Copied'}
                                                {log.status === 'failed' && '✗ Failed'}
                                                {log.status === 'pending' && '⏸ Stopped'}
                                            </span>
                                        </div>
                                        {log.contract_type !== 'SYSTEM' && (
                                            <div className='copy-trading__log-item-details'>
                                                <span>{log.contract_type}</span>
                                                <span>{log.symbol}</span>
                                                <span>{log.amount}</span>
                                            </div>
                                        )}
                                        {log.message && (
                                            <p className='copy-trading__log-item-msg'>{log.message}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className='copy-trading__footer'>
                <p>
                    ⚠️ Copy trading mirrors trades automatically. Always monitor your accounts and ensure the
                    target account has sufficient funds. Past performance is not indicative of future results.
                </p>
            </div>
        </div>
    );
});

export default CopyTrading;
