import React, { useCallback, useEffect, useRef, useState } from 'react';
import { load, save_types } from '@/external/bot-skeleton';
import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';
import { useStore } from '@/hooks/useStore';
import './ai-scanner.scss';

type Strategy = 'over1_under8' | 'over2_under7' | 'even_odd' | 'matches_differs';

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
    { key: 'over1_under8',    label: 'Over1 / Under8',    desc: 'Scans Over 1 and Under 8 digit patterns across markets.' },
    { key: 'over2_under7',    label: 'Over2 / Under7',    desc: 'Scans Over 2 and Under 7 digit patterns across markets.' },
    { key: 'even_odd',        label: 'Even / Odd',        desc: 'Scans Even and Odd last-digit patterns across markets.' },
    { key: 'matches_differs', label: 'Matches / Differs', desc: 'Finds the best digit for Matches or Differs entry.' },
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
        case 'even_odd': {
            const eRate = (recent.filter(d => d % 2 === 0).length / n) * 100;
            const oRate = 100 - eRate;
            const eEdge = eRate - 50;
            const oEdge = oRate - 50;
            return eEdge >= oEdge
                ? { tradeType: 'Even', winRate: eRate, score: eEdge }
                : { tradeType: 'Odd',  winRate: oRate, score: oEdge };
        }
        case 'matches_differs': {
            const counts = new Array(10).fill(0);
            recent.forEach(d => counts[d]++);
            const minIdx = counts.indexOf(Math.min(...counts));
            const maxIdx = counts.indexOf(Math.max(...counts));
            const diffRate  = ((n - counts[minIdx]) / n) * 100;
            const matchRate = (counts[maxIdx] / n) * 100;
            const diffEdge  = diffRate  - 90;
            const matchEdge = matchRate - 10;
            return diffEdge >= matchEdge
                ? { tradeType: `Differs ${minIdx}`, winRate: diffRate,  score: diffEdge  }
                : { tradeType: `Matches ${maxIdx}`, winRate: matchRate, score: matchEdge };
        }
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
        case 'even_odd':
            return tradeType === 'Even'
                ? { tradeTypeDeriv: 'evenodd', contractType: 'DIGITEVEN', purchaseType: 'DIGITEVEN', prediction: null, hasPredict: false }
                : { tradeTypeDeriv: 'evenodd', contractType: 'DIGITODD',  purchaseType: 'DIGITODD',  prediction: null, hasPredict: false };
        case 'matches_differs': {
            const digit = parseInt(tradeType.split(' ')[1] ?? '0', 10);
            return tradeType.startsWith('Matches')
                ? { tradeTypeDeriv: 'matchdiff', contractType: 'DIGITMATCH', purchaseType: 'DIGITMATCH', prediction: digit, hasPredict: true }
                : { tradeTypeDeriv: 'matchdiff', contractType: 'DIGITDIFF',  purchaseType: 'DIGITDIFF',  prediction: digit, hasPredict: true };
        }
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

        const timer = setTimeout(finish, 30000);

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

const openLiveTickWs = (
    symbol: string,
    pipSize: number,
    onTick: (digit: number) => void
): WebSocket => {
    const appId  = getAppId();
    const server = getSocketURL();
    const ws = new WebSocket(`wss://${server}/websockets/v3?app_id=${appId}&l=EN&brand=frostydbot`);
    ws.onopen    = () => ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    ws.onmessage = e => {
        try {
            const data = JSON.parse(e.data);
            if (!data.tick) return;

            let digit: number | null = null;
            const pipSized = data.tick.pip_sized;
            const rawQuote = data.tick.quote;

            if (pipSized !== undefined && pipSized !== null) {
                const s = String(pipSized).trim();
                if (s.includes('.') && s.length > 2) {
                    const last = parseInt(s[s.length - 1], 10);
                    if (!isNaN(last)) digit = last;
                }
            }

            if (digit === null && rawQuote !== undefined && rawQuote !== null) {
                const q = Number(rawQuote);
                if (q > 0) digit = getLastDigit(q, pipSize);
            }

            if (digit !== null && !isNaN(digit)) onTick(digit);
        } catch { /* ignore */ }
    };
    return ws;
};

const digitColor = (digit: number, tradeType: string): 'win' | 'lose' | 'match' | 'neutral' => {
    if (tradeType === 'Over 1')  return digit > 1 ? 'win' : 'lose';
    if (tradeType === 'Under 8') return digit < 8 ? 'win' : 'lose';
    if (tradeType === 'Over 2')  return digit > 2 ? 'win' : 'lose';
    if (tradeType === 'Under 7') return digit < 7 ? 'win' : 'lose';
    if (tradeType === 'Even')    return digit % 2 === 0 ? 'win' : 'lose';
    if (tradeType === 'Odd')     return digit % 2 !== 0 ? 'win' : 'lose';
    if (tradeType.startsWith('Matches')) {
        const t = parseInt(tradeType.split(' ')[1] ?? '-1', 10);
        return digit === t ? 'match' : 'neutral';
    }
    if (tradeType.startsWith('Differs')) {
        const t = parseInt(tradeType.split(' ')[1] ?? '-1', 10);
        return digit === t ? 'lose' : 'win';
    }
    return 'neutral';
};

const winRateClass = (winRate: number, tradeType: string): string => {
    if (tradeType.startsWith('Matches')) {
        if (winRate >= 14) return 'strong';
        if (winRate >= 11) return 'good';
        return 'weak';
    }
    if (winRate >= 85) return 'strong';
    if (winRate >= 78) return 'good';
    return 'weak';
};

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

// Mini bar chart for each digit (0-9) on the market row
const DigitMiniBar: React.FC<{ digitFreq: number[]; tradeType: string }> = ({ digitFreq, tradeType }) => {
    const total = digitFreq.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const maxFreq = Math.max(...digitFreq);
    return (
        <div className='ai-scanner__mini-bars'>
            {digitFreq.map((count, d) => {
                const pct = maxFreq > 0 ? (count / maxFreq) * 100 : 0;
                const color = digitColor(d, tradeType);
                return (
                    <div key={d} className='ai-scanner__mini-bar-col'>
                        <div
                            className={`ai-scanner__mini-bar ai-scanner__mini-bar--${color}`}
                            style={{ height: `${Math.max(pct, 4)}%` }}
                            title={`Digit ${d}: ${((count / total) * 100).toFixed(1)}%`}
                        />
                        <span className='ai-scanner__mini-bar-label'>{d}</span>
                    </div>
                );
            })}
        </div>
    );
};

// Full digit circles (D-Circles style)
const DigitCircles: React.FC<{
    freq: number[];
    total: number;
    tradeType: string;
    latestDigit: number | null;
}> = ({ freq, total, tradeType, latestDigit }) => {
    const maxFreq = total > 0 ? Math.max(...freq) : 0;
    const R     = 18;
    const CIRC  = 2 * Math.PI * R;

    return (
        <div className='ai-scanner__dcircles-wrap'>
            <div className='ai-scanner__dcircles'>
                {Array.from({ length: 10 }, (_, d) => {
                    const count  = freq[d];
                    const pct    = total > 0 ? Math.round((count / total) * 100) : 0;
                    const color  = digitColor(d, tradeType);
                    const isTop  = count === maxFreq && maxFreq > 0;
                    const isNew  = d === latestDigit;
                    const dash   = (pct / 100) * CIRC;

                    return (
                        <div
                            key={d}
                            className={[
                                'ai-scanner__dcircle',
                                `ai-scanner__dcircle--${color}`,
                                isTop ? 'ai-scanner__dcircle--top' : '',
                                isNew ? 'ai-scanner__dcircle--latest' : '',
                            ].filter(Boolean).join(' ')}
                        >
                            <svg viewBox='0 0 44 44' width='52' height='52'>
                                <circle cx='22' cy='22' r={R} fill='none' stroke='rgba(255,255,255,0.07)' strokeWidth='3.5' />
                                <circle
                                    cx='22' cy='22' r={R}
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='3.5'
                                    strokeLinecap='round'
                                    strokeDasharray={`${dash.toFixed(2)} ${(CIRC - dash).toFixed(2)}`}
                                    style={{ transform: 'rotate(-90deg)', transformOrigin: '22px 22px', transition: 'stroke-dasharray 0.4s ease' }}
                                />
                                <text x='22' y='22' textAnchor='middle' dominantBaseline='central' className='ai-scanner__dcircle-num'>
                                    {d}
                                </text>
                            </svg>
                            <div className='ai-scanner__dcircle-pct'>{pct}%</div>
                            {isNew && <div className='ai-scanner__dcircle-pulse' />}
                        </div>
                    );
                })}
            </div>

            {latestDigit !== null && (
                <div className='ai-scanner__dcursor-track'>
                    <div
                        className='ai-scanner__dcursor ai-scanner__dcursor--visible'
                        style={{ left: `${((latestDigit + 0.5) / 10) * 100}%` }}
                    />
                </div>
            )}
        </div>
    );
};

// ── Component ─────────────────────────────────────────────────────────────────
const AIScanner: React.FC = () => {
    const store = useStore();

    const [isOpen,    setIsOpen]    = useState(false);
    const [strategy,  setStrategy]  = useState<Strategy>('over1_under8');
    const [ticks,     setTicks]     = useState(1000);

    const [stake,      setStake]      = useState(2);
    const [martingale, setMartingale] = useState(2.5);
    const [takeProfit, setTakeProfit] = useState(5);
    const [stopLoss,   setStopLoss]   = useState(8);

    const [isScanning,   setIsScanning]   = useState(false);
    const [isLoading,    setIsLoading]    = useState(false);
    const [allResults,   setAllResults]   = useState<ScanResult[]>([]);
    const [selected,     setSelected]     = useState<ScanResult | null>(null);
    const [statusMsg,    setStatusMsg]    = useState('');
    const [progress,     setProgress]     = useState(0);

    const [liveFreq,     setLiveFreq]     = useState<number[]>(Array(10).fill(0));
    const [liveTotal,    setLiveTotal]    = useState(0);
    const [liveLatest,   setLiveLatest]   = useState<number | null>(null);
    const liveWsRef  = useRef<WebSocket | null>(null);
    const abortRef   = useRef(false);

    // Open live stream on selected market
    useEffect(() => {
        if (liveWsRef.current) {
            try { liveWsRef.current.close(); } catch { /* ignore */ }
            liveWsRef.current = null;
        }
        setLiveLatest(null);

        if (!selected) {
            setLiveFreq(Array(10).fill(0));
            setLiveTotal(0);
            return;
        }

        setLiveFreq(Array.isArray(selected.digitFreq) ? [...selected.digitFreq] : Array(10).fill(0));
        setLiveTotal(selected.scanTotal ?? 0);

        const market = MARKETS.find(m => m.symbol === selected.symbol);
        if (!market) return;

        const ws = openLiveTickWs(market.symbol, market.pipSize, digit => {
            setLiveFreq(prev => { const n = [...prev]; n[digit]++; return n; });
            setLiveTotal(prev => prev + 1);
            setLiveLatest(digit);
        });
        liveWsRef.current = ws;

        return () => {
            try { ws.close(); } catch { /* ignore */ }
        };
    }, [selected]);

    // Close live stream when modal closes
    useEffect(() => {
        if (!isOpen && liveWsRef.current) {
            try { liveWsRef.current.close(); } catch { /* ignore */ }
            liveWsRef.current = null;
        }
    }, [isOpen]);

    const handleClose = () => {
        abortRef.current = true;
        setIsOpen(false);
    };

    const handleStrategyChange = (s: Strategy) => {
        if (isScanning) return;
        setStrategy(s);
        setAllResults([]);
        setSelected(null);
        setStatusMsg('');
        setProgress(0);
    };

    const handleSelectMarket = (r: ScanResult) => {
        if (selected?.symbol === r.symbol) return;
        setSelected(r);
    };

    const handleScan = useCallback(async () => {
        if (isScanning) return;
        abortRef.current = false;
        setIsScanning(true);
        setAllResults([]);
        setSelected(null);
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

        // Sort best first
        results.sort((a, b) => b.score - a.score);

        if (results.length > 0) {
            setAllResults(results);
            setSelected(results[0]);
            setStatusMsg(`✓ Scanned ${results.length}/${MARKETS.length} markets — best: ${results[0].marketName} (${results[0].winRate.toFixed(1)}%)`);
            setProgress(100);
        } else {
            setStatusMsg('Scan failed — no market data received. Check your connection and try again.');
        }

        setIsScanning(false);
    }, [isScanning, strategy, ticks]);

    const handleLoadBot = useCallback(async () => {
        if (!selected || isLoading) return;
        setIsLoading(true);
        setStatusMsg('Loading bot into builder...');
        try {
            const res = await fetch('/bots/AI_SCANNER_BOT.xml');
            if (!res.ok) throw new Error('Could not fetch scanner bot XML');
            const xmlTemplate = await res.text();

            const xmlParams  = getXMLParams(strategy, selected.tradeType);
            const patchedXML = patchBotXML(xmlTemplate, selected.symbol, xmlParams, stake, martingale, takeProfit, stopLoss);

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
    }, [selected, isLoading, strategy, stake, martingale, takeProfit, stopLoss, store]);

    const xmlParams           = selected ? getXMLParams(strategy, selected.tradeType) : null;
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

                            {/* ── All Markets Table ──────────────────────────── */}
                            {allResults.length > 0 && (
                                <>
                                    <div className='ai-scanner__section-label'>
                                        All Markets <span className='ai-scanner__section-sub'>click a row to view digit distribution</span>
                                    </div>
                                    <div className='ai-scanner__markets-table'>
                                        {allResults.map((r, idx) => {
                                            const isBest    = idx === 0;
                                            const isActive  = selected?.symbol === r.symbol;
                                            const rateClass = winRateClass(r.winRate, r.tradeType);
                                            return (
                                                <div
                                                    key={r.symbol}
                                                    className={[
                                                        'ai-scanner__market-row',
                                                        isActive ? 'ai-scanner__market-row--active' : '',
                                                        isBest   ? 'ai-scanner__market-row--best'   : '',
                                                    ].filter(Boolean).join(' ')}
                                                    onClick={() => handleSelectMarket(r)}
                                                    role='button'
                                                    tabIndex={0}
                                                    onKeyDown={e => e.key === 'Enter' && handleSelectMarket(r)}
                                                >
                                                    <div className='ai-scanner__market-rank'>
                                                        {isBest ? '👑' : `#${idx + 1}`}
                                                    </div>
                                                    <div className='ai-scanner__market-info'>
                                                        <span className='ai-scanner__market-name'>{r.marketName}</span>
                                                        <span className='ai-scanner__market-trade'>{r.tradeType}</span>
                                                    </div>
                                                    <DigitMiniBar digitFreq={r.digitFreq} tradeType={r.tradeType} />
                                                    <div className={`ai-scanner__market-rate ai-scanner__market-rate--${rateClass}`}>
                                                        {r.winRate.toFixed(1)}%
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            {/* ── Selected Market: Scan Result Summary ──────── */}
                            {selected && (
                                <>
                                    <div className='ai-scanner__section-label'>
                                        Selected Entry <span className='ai-scanner__section-sub'>auto-filled by scanner</span>
                                    </div>
                                    <div className='ai-scanner__results-grid'>
                                        {[
                                            { label: 'MARKET',     value: selected.marketName    },
                                            { label: 'TRADE TYPE', value: tradeTypeDisplay       },
                                            { label: 'CONTRACT',   value: contractTypeDisplay    },
                                            { label: 'PREDICTION', value: predictionDisplay      },
                                        ].map(({ label, value }) => (
                                            <div key={label} className='ai-scanner__result-field ai-scanner__result-field--active'>
                                                <label>{label}</label>
                                                <span className='ai-scanner__result-value--filled'>{value}</span>
                                            </div>
                                        ))}
                                        <div className='ai-scanner__result-field ai-scanner__result-field--wide ai-scanner__result-field--active'>
                                            <label>BEST ENTRY</label>
                                            <span className='ai-scanner__result-value--filled ai-scanner__best-entry'>
                                                {selected.tradeType}
                                                <span className='ai-scanner__win-badge'>{selected.winRate.toFixed(1)}%</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* ── Digit Distribution (D-Circles style) ─ */}
                                    <div className='ai-scanner__live'>
                                        <div className='ai-scanner__live-header'>
                                            <span className='ai-scanner__live-dot' />
                                            <span className='ai-scanner__live-label'>
                                                {selected.marketName} — Digit Distribution
                                            </span>
                                            {liveTotal > 0
                                                ? <span className='ai-scanner__live-count'>{liveTotal} ticks</span>
                                                : <span className='ai-scanner__live-hint'>Connecting…</span>
                                            }
                                        </div>

                                        {liveTotal === 0
                                            ? <div className='ai-scanner__live-waiting'>Waiting for ticks…</div>
                                            : (
                                                <DigitCircles
                                                    freq={liveFreq}
                                                    total={liveTotal}
                                                    tradeType={selected.tradeType}
                                                    latestDigit={liveLatest}
                                                />
                                            )
                                        }

                                        {liveTotal > 0 && (
                                            <div className='ai-scanner__live-legend'>
                                                {selected.tradeType.startsWith('Over') || selected.tradeType.startsWith('Under')
                                                    ? <><span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--win' />Win &nbsp;<span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--lose' />Lose</>
                                                    : selected.tradeType === 'Even' || selected.tradeType === 'Odd'
                                                    ? <><span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--win' />Even &nbsp;<span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--lose' />Odd</>
                                                    : selected.tradeType.startsWith('Matches')
                                                    ? <><span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--match' />Target &nbsp;<span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--neutral' />Other</>
                                                    : selected.tradeType.startsWith('Differs')
                                                    ? <><span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--win' />Win &nbsp;<span className='ai-scanner__live-legend-dot ai-scanner__live-legend-dot--lose' />Target (avoid)</>
                                                    : null
                                                }
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Progress */}
                            {isScanning && (
                                <div className='ai-scanner__progress-track'>
                                    <div className='ai-scanner__progress-fill' style={{ width: `${progress}%` }} />
                                </div>
                            )}

                            {/* Status */}
                            <div className={`ai-scanner__status${selected ? ' ai-scanner__status--success' : ''}`}>
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
                                        : allResults.length > 0
                                            ? <><RescanIcon size={15} /> Re-scan Markets</>
                                            : `Scan All ${MARKETS.length} Markets`}
                                </button>
                                <button
                                    className={`ai-scanner__btn ai-scanner__btn--secondary${selected && !isScanning ? ' ai-scanner__btn--ready' : ''}`}
                                    onClick={handleLoadBot}
                                    disabled={!selected || isScanning || isLoading}
                                    title={!selected ? 'Run a scan first to find the best market' : 'Load AI Scanner Bot with these settings'}
                                >
                                    {isLoading
                                        ? <><span className='ai-scanner__spinner ai-scanner__spinner--muted' /> Loading…</>
                                        : selected
                                            ? `Load Bot — ${selected.marketName}`
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
