import React, { useCallback, useEffect, useRef, useState } from 'react';
import { load, save_types } from '@/external/bot-skeleton';
import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';
import { useStore } from '@/hooks/useStore';
import './ai-scanner.scss';

type Strategy = 'over1_under8' | 'over2_under7' | 'over3_under6' | 'over4_under5' | 'even_odd';

interface ScanResult {
    symbol: string;
    marketName: string;
    tradeType: string;
    winRate: number;
    score: number;
    digitFreq: number[];
    scanTotal: number;
}

interface XMLParams {
    tradeTypeDeriv: string;
    contractType: string;
    purchaseType: string;
    prediction: number | null;
    hasPredict: boolean;
}

const MARKETS = [
    { symbol: '1HZ10V',  name: 'Volatility 10 (1s)',    pipSize: 3 },
    { symbol: '1HZ25V',  name: 'Volatility 25 (1s)',    pipSize: 3 },
    { symbol: '1HZ50V',  name: 'Volatility 50 (1s)',    pipSize: 4 },
    { symbol: '1HZ75V',  name: 'Volatility 75 (1s)',    pipSize: 4 },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)',   pipSize: 2 },
    { symbol: 'R_10',    name: 'Volatility 10 Index',   pipSize: 3 },
    { symbol: 'R_25',    name: 'Volatility 25 Index',   pipSize: 3 },
    { symbol: 'R_50',    name: 'Volatility 50 Index',   pipSize: 4 },
    { symbol: 'R_75',    name: 'Volatility 75 Index',   pipSize: 4 },
    { symbol: 'R_100',   name: 'Volatility 100 Index',  pipSize: 2 },
];

const STRATEGIES: { key: Strategy; label: string; desc: string }[] = [
    { key: 'over1_under8', label: 'Over1 / Under8', desc: '~80% baseline. Scans for strongest Over 1 or Under 8 edge across markets.' },
    { key: 'over2_under7', label: 'Over2 / Under7', desc: '~70% baseline. Scans for strongest Over 2 or Under 7 edge across markets.' },
    { key: 'over3_under6', label: 'Over3 / Under6', desc: '~60% baseline. Higher payout range — looks for dominant mid-digit bias.' },
    { key: 'over4_under5', label: 'Over4 / Under5', desc: '~50% baseline. Highest payout tier — finds markets with strong directional digit skew.' },
    { key: 'even_odd',     label: 'Even / Odd',     desc: '50/50 baseline. Detects markets where even or odd digits are consistently dominating.' },
];

const getLastDigit = (price: number, pipSize: number): number => {
    const shifted = Math.round(Math.abs(price) * Math.pow(10, pipSize));
    return shifted % 10;
};

const analyzeDigits = (
    digits: number[],
    strategy: Strategy
): { tradeType: string; winRate: number; score: number } => {
    if (!digits.length) return { tradeType: 'N/A', winRate: 0, score: 0 };

    const recent = digits.slice(-100);
    const n = recent.length;

    switch (strategy) {
        case 'over1_under8': {
            const oRate = (recent.filter(d => d > 1).length / n) * 100;
            const uRate = (recent.filter(d => d < 8).length / n) * 100;
            const oEdge = oRate - 80;
            const uEdge = uRate - 80;
            return oEdge >= uEdge
                ? { tradeType: 'Over 1',  winRate: oRate, score: oEdge }
                : { tradeType: 'Under 8', winRate: uRate, score: uEdge };
        }
        case 'over2_under7': {
            const oRate = (recent.filter(d => d > 2).length / n) * 100;
            const uRate = (recent.filter(d => d < 7).length / n) * 100;
            const oEdge = oRate - 70;
            const uEdge = uRate - 70;
            return oEdge >= uEdge
                ? { tradeType: 'Over 2',  winRate: oRate, score: oEdge }
                : { tradeType: 'Under 7', winRate: uRate, score: uEdge };
        }
        case 'over3_under6': {
            const oRate = (recent.filter(d => d > 3).length / n) * 100;
            const uRate = (recent.filter(d => d < 6).length / n) * 100;
            const oEdge = oRate - 60;
            const uEdge = uRate - 60;
            return oEdge >= uEdge
                ? { tradeType: 'Over 3',  winRate: oRate, score: oEdge }
                : { tradeType: 'Under 6', winRate: uRate, score: uEdge };
        }
        case 'over4_under5': {
            const oRate = (recent.filter(d => d > 4).length / n) * 100;
            const uRate = (recent.filter(d => d < 5).length / n) * 100;
            const oEdge = oRate - 50;
            const uEdge = uRate - 50;
            return oEdge >= uEdge
                ? { tradeType: 'Over 4',  winRate: oRate, score: oEdge }
                : { tradeType: 'Under 5', winRate: uRate, score: uEdge };
        }
        case 'even_odd': {
            const eRate = (recent.filter(d => d % 2 === 0).length / n) * 100;
            const oRate = 100 - eRate;
            const eEdge = eRate - 50;
            const oEdge = oRate - 50;
            return eEdge >= oEdge
                ? { tradeType: 'Even', winRate: eRate, score: eEdge }
                : { tradeType: 'Odd',  winRate: oRate, score: oEdge };
        }
        default:
            return { tradeType: 'N/A', winRate: 0, score: 0 };
    }
};

const getXMLParams = (strategy: Strategy, tradeType: string): XMLParams => {
    switch (strategy) {
        case 'over1_under8':
            return tradeType === 'Over 1'
                ? { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITOVER',  prediction: 1, hasPredict: true }
                : { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITUNDER', prediction: 8, hasPredict: true };
        case 'over2_under7':
            return tradeType === 'Over 2'
                ? { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITOVER',  prediction: 2, hasPredict: true }
                : { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITUNDER', prediction: 7, hasPredict: true };
        case 'over3_under6':
            return tradeType === 'Over 3'
                ? { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITOVER',  prediction: 3, hasPredict: true }
                : { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITUNDER', prediction: 6, hasPredict: true };
        case 'over4_under5':
            return tradeType === 'Over 4'
                ? { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITOVER',  prediction: 4, hasPredict: true }
                : { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITUNDER', prediction: 5, hasPredict: true };
        case 'even_odd':
            return tradeType === 'Even'
                ? { tradeTypeDeriv: 'evenodd', contractType: 'DIGITEVEN', purchaseType: 'DIGITEVEN', prediction: null, hasPredict: false }
                : { tradeTypeDeriv: 'evenodd', contractType: 'DIGITODD',  purchaseType: 'DIGITODD',  prediction: null, hasPredict: false };
    }
};

const patchBotXML = (
    xmlString: string,
    symbol: string,
    xmlParams: XMLParams,
    stake: number,
    martingale: number,
    takeProfit: number,
    stopLoss: number
): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    const symbolField = doc.querySelector('field[name="SYMBOL_LIST"]');
    if (symbolField) symbolField.textContent = symbol;

    const tradeTypeField = doc.querySelector('field[name="TRADETYPE_LIST"]');
    if (tradeTypeField) tradeTypeField.textContent = xmlParams.tradeTypeDeriv;

    const typeField = doc.querySelector('field[name="TYPE_LIST"]');
    if (typeField) typeField.textContent = xmlParams.contractType;

    const purchaseField = doc.querySelector('field[name="PURCHASE_LIST"]');
    if (purchaseField) purchaseField.textContent = xmlParams.purchaseType;

    const tradeOptions = doc.querySelector('block[type="trade_definition_tradeoptions"]');
    if (tradeOptions) {
        const mutation =
            tradeOptions.querySelector('mutation') ||
            (tradeOptions.getElementsByTagName('mutation')[0] as Element | undefined) ||
            null;
        if (mutation) {
            mutation.setAttribute('has_prediction', xmlParams.hasPredict ? 'true' : 'false');
        }
        const predValue = tradeOptions.querySelector('value[name="PREDICTION"]');
        if (predValue) {
            const numField =
                predValue.querySelector('shadow field[name="NUM"]') ||
                predValue.querySelector('block field[name="NUM"]') ||
                predValue.querySelector('field[name="NUM"]');
            if (numField) {
                numField.textContent = xmlParams.hasPredict && xmlParams.prediction !== null
                    ? String(xmlParams.prediction)
                    : '0';
            }
        }
    }

    const initStatement = doc.querySelector('statement[name="INITIALIZATION"]');
    if (initStatement) {
        const varMap: Record<string, number> = { stake, martingale, take_profit: takeProfit, stop_loss: stopLoss };
        initStatement.querySelectorAll('block[type="variables_set"]').forEach(block => {
            const varName = block.querySelector(':scope > field[name="VAR"]')?.textContent?.trim();
            if (varName && varName in varMap) {
                const numField = block.querySelector('value[name="VALUE"] > block[type="math_number"] > field[name="NUM"]');
                if (numField) numField.textContent = String(varMap[varName]);
            }
        });
    }

    return new XMLSerializer().serializeToString(doc);
};

const fetchAllMarketsAtOnce = (
    markets: typeof MARKETS,
    count: number,
    onProgress: (received: number, total: number) => void
): Promise<Map<string, number[]>> =>
    new Promise(resolve => {
        const appId  = getAppId();
        const server = getSocketURL();
        const ws = new WebSocket(`wss://${server}/websockets/v3?app_id=${appId}&l=EN&brand=frostydbot`);

        const results  = new Map<string, number[]>();
        const pipMap   = new Map(markets.map(m => [m.symbol, m.pipSize]));
        let received   = 0;
        let done       = false;

        const finish = () => {
            if (done) return;
            done = true;
            try { ws.close(); } catch { /* ignore */ }
            resolve(results);
        };

        const timer = setTimeout(finish, 10000);

        ws.onopen = () => {
            markets.forEach(({ symbol }, idx) => {
                ws.send(JSON.stringify({
                    ticks_history: symbol,
                    count: Math.min(count, 5000),
                    end: 'latest',
                    style: 'ticks',
                    req_id: idx + 1,
                }));
            });
        };

        ws.onmessage = e => {
            try {
                const data = JSON.parse(e.data);
                const symbol = data.echo_req?.ticks_history as string | undefined;
                if (!symbol) return;

                if (data.history?.prices) {
                    const pipSize = pipMap.get(symbol) ?? 2;
                    results.set(symbol, (data.history.prices as number[]).map(p => getLastDigit(p, pipSize)));
                }
                if (data.history || data.error) {
                    received++;
                    onProgress(received, markets.length);
                    if (received >= markets.length) {
                        clearTimeout(timer);
                        finish();
                    }
                }
            } catch { /* ignore bad frames */ }
        };

        ws.onerror  = () => { clearTimeout(timer); finish(); };
        ws.onclose  = () => { clearTimeout(timer); finish(); };
    });

const SparkIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox='0 0 24 24' fill={color}>
        <path d='M12 2L13.9 9.1L21 7L15.5 12L21 17L13.9 14.9L12 22L10.1 14.9L3 17L8.5 12L3 7L10.1 9.1L12 2Z' />
    </svg>
);

const RescanIcon = ({ size = 15 }: { size?: number }) => (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor'>
        <path d='M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'/>
    </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────
const AIScanner: React.FC = () => {
    const store = useStore();

    const [isOpen,    setIsOpen]    = useState(false);
    const [strategy,  setStrategy]  = useState<Strategy>('over1_under8');
    const [ticks,     setTicks]     = useState(500);

    const [stake,      setStake]      = useState(2);
    const [martingale, setMartingale] = useState(2.5);
    const [takeProfit, setTakeProfit] = useState(5);
    const [stopLoss,   setStopLoss]   = useState(8);

    const [isScanning, setIsScanning] = useState(false);
    const [isLoading,  setIsLoading]  = useState(false);
    const [result,     setResult]     = useState<ScanResult | null>(null);
    const [statusMsg,  setStatusMsg]  = useState('');
    const [progress,   setProgress]   = useState(0);

    const abortRef = useRef(false);

    const handleClose = () => {
        abortRef.current = true;
        setIsOpen(false);
    };

    const handleStrategyChange = (s: Strategy) => {
        if (isScanning) return;
        setStrategy(s);
        setResult(null);
        setStatusMsg('');
        setProgress(0);
    };

    const handleScan = useCallback(async () => {
        if (isScanning) return;
        abortRef.current = false;
        setIsScanning(true);
        setResult(null);
        setProgress(0);
        setStatusMsg(`Connecting — scanning all ${MARKETS.length} markets in parallel...`);

        const marketData = await fetchAllMarketsAtOnce(
            MARKETS,
            ticks,
            (received, total) => {
                setProgress(Math.round((received / total) * 95));
                setStatusMsg(`Analysing markets... (${received}/${total} received)`);
            }
        );

        if (abortRef.current) { setIsScanning(false); return; }

        const results: ScanResult[] = [];
        marketData.forEach((digits, symbol) => {
            const market = MARKETS.find(m => m.symbol === symbol);
            if (!market || !digits.length) return;
            const { tradeType, winRate, score } = analyzeDigits(digits, strategy);
            const digitFreq = Array(10).fill(0) as number[];
            digits.forEach(d => { digitFreq[d]++; });
            results.push({ symbol, marketName: market.name, tradeType, winRate, score, digitFreq, scanTotal: digits.length });
        });

        if (results.length > 0) {
            const best = results.reduce((a, b) => a.score > b.score ? a : b);
            setResult(best);
            setStatusMsg(`✓ Best entry: ${best.marketName} — ${best.tradeType} (${best.winRate.toFixed(1)}%) from ${results.length}/${MARKETS.length} markets`);
            setProgress(100);
        } else {
            setStatusMsg('Scan failed — no market data received. Check your connection and try again.');
        }

        setIsScanning(false);
    }, [isScanning, strategy, ticks]);

    const handleLoadBot = useCallback(async () => {
        if (!result || isLoading) return;
        setIsLoading(true);
        setStatusMsg('Loading bot into builder...');
        try {
            const res = await fetch('/bots/AI_SCANNER_BOT.xml');
            if (!res.ok) throw new Error('Could not fetch scanner bot XML');
            const xmlTemplate = await res.text();

            const xmlParams  = getXMLParams(strategy, result.tradeType);
            const patchedXML = patchBotXML(xmlTemplate, result.symbol, xmlParams, stake, martingale, takeProfit, stopLoss);

            await load({
                block_string: patchedXML,
                file_name: 'AI Scanner Bot',
                workspace: (window as any).Blockly?.derivWorkspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            store?.dashboard?.setActiveTab(1);
            window.location.hash = 'bot_builder';
            handleClose();
        } catch (err) {
            console.error('Failed to load scanner bot:', err);
            setStatusMsg('Failed to load bot. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [result, isLoading, strategy, stake, martingale, takeProfit, stopLoss, store]);

    const xmlParams           = result ? getXMLParams(strategy, result.tradeType) : null;
    const contractTypeDisplay = xmlParams ? xmlParams.contractType.replace('DIGIT', '') : '—';
    const tradeTypeDisplay    = xmlParams
        ? xmlParams.tradeTypeDeriv === 'overunder' ? 'Over/Under'
        : xmlParams.tradeTypeDeriv === 'evenodd'   ? 'Even/Odd'
        : 'Match/Diff'
        : '—';
    const predictionDisplay   = xmlParams?.hasPredict && xmlParams.prediction !== null ? String(xmlParams.prediction) : '—';
    const readyLabel          = STRATEGIES.find(s => s.key === strategy)?.label ?? '';

    return (
        <>
            <button className='ai-scanner__fab' onClick={() => setIsOpen(true)} title='AI Market Scanner' aria-label='Open AI Market Scanner'>
                <SparkIcon size={14} color='#1a0e00' />
                <span>AI</span>
            </button>

            {isOpen && (
                <div className='ai-scanner__overlay' onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
                    <div className='ai-scanner__modal'>
                        {/* Header */}
                        <div className='ai-scanner__header'>
                            <div className='ai-scanner__header-title'>
                                <SparkIcon size={16} color='#D3A255' />
                                <span>Entry Scanner</span>
                            </div>
                            <button className='ai-scanner__close' onClick={handleClose} aria-label='Close'>✕</button>
                        </div>

                        {/* Strategy tabs */}
                        <div className='ai-scanner__tabs'>
                            {STRATEGIES.map(s => (
                                <button
                                    key={s.key}
                                    className={`ai-scanner__tab${strategy === s.key ? ' ai-scanner__tab--active' : ''}`}
                                    onClick={() => handleStrategyChange(s.key)}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>

                        <div className='ai-scanner__body'>
                            <p className='ai-scanner__strategy-desc'>
                                {STRATEGIES.find(s => s.key === strategy)?.desc}
                            </p>

                            {/* Bot Parameters */}
                            <div className='ai-scanner__section-label'>
                                Bot Parameters <span className='ai-scanner__section-sub'>edit before loading</span>
                            </div>
                            <div className='ai-scanner__params-grid'>
                                {[
                                    { label: 'Stake',        value: stake,       set: setStake,       min: 0.35, step: 0.5  },
                                    { label: 'Martingale ×', value: martingale,  set: setMartingale,  min: 1,    step: 0.5  },
                                    { label: 'Take Profit',  value: takeProfit,  set: setTakeProfit,  min: 0.5,  step: 0.5  },
                                    { label: 'Stop Loss',    value: stopLoss,    set: setStopLoss,    min: 0.5,  step: 0.5  },
                                ].map(({ label, value, set, min, step }) => (
                                    <div key={label} className='ai-scanner__param'>
                                        <label>{label}</label>
                                        <input
                                            type='number'
                                            min={min}
                                            step={step}
                                            value={value}
                                            disabled={isScanning || isLoading}
                                            onChange={e => set(Math.max(min, parseFloat(e.target.value) || min))}
                                        />
                                    </div>
                                ))}
                            </div>

                            {/* Scan depth */}
                            <div className='ai-scanner__scan-row'>
                                <div className='ai-scanner__section-label' style={{ marginBottom: 0 }}>Scan depth</div>
                                <div className='ai-scanner__ticks-ctrl'>
                                    <span>TICKS</span>
                                    <input
                                        type='number'
                                        min={100}
                                        max={5000}
                                        step={100}
                                        value={ticks}
                                        disabled={isScanning}
                                        onChange={e => setTicks(Math.max(100, Math.min(5000, parseInt(e.target.value) || 1000)))}
                                    />
                                </div>
                            </div>

                            {/* ── Scan Results ──────────────────────────────── */}
                            <div className='ai-scanner__section-label'>
                                Scan Results <span className='ai-scanner__section-sub'>auto-filled by scanner</span>
                            </div>
                            <div className='ai-scanner__results-grid'>
                                {[
                                    { label: 'MARKET',     value: result ? result.marketName  : 'Run scan first' },
                                    { label: 'TRADE TYPE', value: result ? tradeTypeDisplay   : '—' },
                                    { label: 'CONTRACT',   value: result ? contractTypeDisplay : '—' },
                                    { label: 'PREDICTION', value: result ? predictionDisplay  : '—' },
                                ].map(({ label, value }) => (
                                    <div key={label} className={`ai-scanner__result-field${result ? ' ai-scanner__result-field--active' : ''}`}>
                                        <label>{label}</label>
                                        <span className={result ? 'ai-scanner__result-value--filled' : ''}>{value}</span>
                                    </div>
                                ))}
                                {result && (
                                    <div className='ai-scanner__result-field ai-scanner__result-field--wide ai-scanner__result-field--active'>
                                        <label>BEST ENTRY</label>
                                        <span className='ai-scanner__result-value--filled ai-scanner__best-entry'>
                                            {result.tradeType}
                                            <span className='ai-scanner__win-badge'>{result.winRate.toFixed(1)}%</span>
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Progress */}
                            {isScanning && (
                                <div className='ai-scanner__progress-track'>
                                    <div className='ai-scanner__progress-fill' style={{ width: `${progress}%` }} />
                                </div>
                            )}

                            {/* Status */}
                            <div className={`ai-scanner__status${result ? ' ai-scanner__status--success' : ''}`}>
                                {statusMsg || `Ready to scan ${readyLabel} across all ${MARKETS.length} markets.`}
                            </div>

                            {/* Actions */}
                            <div className='ai-scanner__actions'>
                                <button
                                    className='ai-scanner__btn ai-scanner__btn--primary'
                                    onClick={handleScan}
                                    disabled={isScanning || isLoading}
                                >
                                    {isScanning
                                        ? <><span className='ai-scanner__spinner' /> Scanning all {MARKETS.length} markets…</>
                                        : result
                                            ? <><RescanIcon size={15} /> Re-scan Markets</>
                                            : `Scan All ${MARKETS.length} Markets`}
                                </button>
                                <button
                                    className={`ai-scanner__btn ai-scanner__btn--secondary${result && !isScanning ? ' ai-scanner__btn--ready' : ''}`}
                                    onClick={handleLoadBot}
                                    disabled={!result || isScanning || isLoading}
                                    title={!result ? 'Run a scan first to find the best market' : 'Load AI Scanner Bot with these settings'}
                                >
                                    {isLoading
                                        ? <><span className='ai-scanner__spinner ai-scanner__spinner--muted' /> Loading…</>
                                        : 'Load Scanner Bot'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AIScanner;
