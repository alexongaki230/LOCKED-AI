import React, { useCallback, useRef, useState } from 'react';
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
    score: number; // edge over statistical baseline — used for ranking
}

interface XMLParams {
    tradeTypeDeriv: string;
    contractType: string;
    purchaseType: string;
    prediction: number | null;
    hasPredict: boolean;
}

const MARKETS = [
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)', pipSize: 3 },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s)', pipSize: 3 },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s)', pipSize: 4 },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s)', pipSize: 4 },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)', pipSize: 2 },
    { symbol: 'R_10', name: 'Volatility 10 Index', pipSize: 3 },
    { symbol: 'R_25', name: 'Volatility 25 Index', pipSize: 3 },
    { symbol: 'R_50', name: 'Volatility 50 Index', pipSize: 4 },
    { symbol: 'R_75', name: 'Volatility 75 Index', pipSize: 4 },
    { symbol: 'R_100', name: 'Volatility 100 Index', pipSize: 2 },
];

const STRATEGIES: { key: Strategy; label: string; desc: string }[] = [
    { key: 'over1_under8', label: 'Over1 / Under8', desc: 'Scans Over 1 and Under 8 digit patterns across markets.' },
    { key: 'over2_under7', label: 'Over2 / Under7', desc: 'Scans Over 2 and Under 7 digit patterns across markets.' },
    { key: 'even_odd', label: 'Even / Odd', desc: 'Scans Even and Odd last-digit patterns across markets.' },
    { key: 'matches_differs', label: 'Matches / Differs', desc: 'Finds the best digit for Matches or Differs entry.' },
];

const getLastDigit = (price: number, pipSize: number): number => {
    const fixed = price.toFixed(pipSize);
    return parseInt(fixed[fixed.length - 1], 10);
};

/**
 * Analyse digit data and return the best trade type + a ranking score.
 *
 * Strategy:
 *  - Use the most-recent 100 ticks as the primary signal (current conditions).
 *    With 100 samples the standard-deviation for an 80%-event is ~4 %, giving
 *    real separation between markets.  With 1000+ ticks every market converges
 *    to the same theoretical baseline (~80 %) and one market always wins by noise.
 *  - Rank by EDGE over the statistical baseline (actual − expected), not by the
 *    raw win-rate.  This means "80.1 % on a market whose baseline is 80 %" scores
 *    zero, while "86 % on a market whose baseline is 80 %" scores +6.
 *  - winRate returned is the raw recent rate (for display), but the internal
 *    `score` field drives market comparison.
 */
const analyzeDigits = (
    digits: number[],
    strategy: Strategy
): { tradeType: string; winRate: number; score: number } => {
    if (!digits.length) return { tradeType: 'N/A', winRate: 0, score: 0 };

    // Most-recent 100 ticks: captures current market bias
    const recent = digits.slice(-100);
    const n = recent.length;

    switch (strategy) {
        case 'over1_under8': {
            // Baseline: Over-1 ≈ 80 %, Under-8 ≈ 80 %
            const oRate = (recent.filter(d => d > 1).length / n) * 100;
            const uRate = (recent.filter(d => d < 8).length / n) * 100;
            const oEdge = oRate - 80; // positive = better than expected
            const uEdge = uRate - 80;
            return oEdge >= uEdge
                ? { tradeType: 'Over 1',  winRate: oRate, score: oEdge }
                : { tradeType: 'Under 8', winRate: uRate, score: uEdge };
        }
        case 'over2_under7': {
            // Baseline: Over-2 ≈ 70 %, Under-7 ≈ 70 %
            const oRate = (recent.filter(d => d > 2).length / n) * 100;
            const uRate = (recent.filter(d => d < 7).length / n) * 100;
            const oEdge = oRate - 70;
            const uEdge = uRate - 70;
            return oEdge >= uEdge
                ? { tradeType: 'Over 2',  winRate: oRate, score: oEdge }
                : { tradeType: 'Under 7', winRate: uRate, score: uEdge };
        }
        case 'even_odd': {
            // Baseline: Even ≈ 50 %, Odd ≈ 50 %
            const eRate = (recent.filter(d => d % 2 === 0).length / n) * 100;
            const oRate = 100 - eRate;
            const eEdge = eRate - 50;
            const oEdge = oRate - 50;
            return eEdge >= oEdge
                ? { tradeType: 'Even', winRate: eRate, score: eEdge }
                : { tradeType: 'Odd',  winRate: oRate, score: oEdge };
        }
        case 'matches_differs': {
            // Baseline: each digit ≈ 10 %
            const counts = new Array(10).fill(0);
            recent.forEach(d => counts[d]++);
            const minIdx = counts.indexOf(Math.min(...counts));
            const maxIdx = counts.indexOf(Math.max(...counts));
            // Differs: trade that digit won't appear → win rate = % of ticks NOT that digit
            const diffRate  = ((n - counts[minIdx]) / n) * 100;
            const matchRate = (counts[maxIdx] / n) * 100;
            // Edge over baseline (90 % for differs, 10 % for matches)
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
                ? { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITOVER', prediction: 1, hasPredict: true }
                : { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITUNDER', prediction: 8, hasPredict: true };
        case 'over2_under7':
            return tradeType === 'Over 2'
                ? { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITOVER', prediction: 2, hasPredict: true }
                : { tradeTypeDeriv: 'overunder', contractType: 'both', purchaseType: 'DIGITUNDER', prediction: 7, hasPredict: true };
        case 'even_odd':
            return tradeType === 'Even'
                ? { tradeTypeDeriv: 'evenodd', contractType: 'DIGITEVEN', purchaseType: 'DIGITEVEN', prediction: null, hasPredict: false }
                : { tradeTypeDeriv: 'evenodd', contractType: 'DIGITODD', purchaseType: 'DIGITODD', prediction: null, hasPredict: false };
        case 'matches_differs': {
            const parts = tradeType.split(' ');
            const digit = parseInt(parts[1] ?? '0', 10);
            return tradeType.startsWith('Matches')
                ? { tradeTypeDeriv: 'matchdiff', contractType: 'DIGITMATCH', purchaseType: 'DIGITMATCH', prediction: digit, hasPredict: true }
                : { tradeTypeDeriv: 'matchdiff', contractType: 'DIGITDIFF', purchaseType: 'DIGITDIFF', prediction: digit, hasPredict: true };
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

    // Market symbol
    const symbolField = doc.querySelector('field[name="SYMBOL_LIST"]');
    if (symbolField) symbolField.textContent = symbol;

    // Trade type
    const tradeTypeField = doc.querySelector('field[name="TRADETYPE_LIST"]');
    if (tradeTypeField) tradeTypeField.textContent = xmlParams.tradeTypeDeriv;

    // Contract type (TYPE_LIST)
    const typeField = doc.querySelector('field[name="TYPE_LIST"]');
    if (typeField) typeField.textContent = xmlParams.contractType;

    // Purchase list in before_purchase block
    const purchaseField = doc.querySelector('field[name="PURCHASE_LIST"]');
    if (purchaseField) purchaseField.textContent = xmlParams.purchaseType;

    // Prediction: mutation attribute + value
    const tradeOptions = doc.querySelector('block[type="trade_definition_tradeoptions"]');
    if (tradeOptions) {
        // The <mutation> element may carry xmlns="http://www.w3.org/1999/xhtml", making it a
        // namespaced node that querySelector('mutation') cannot match in an XMLDocument.
        // Use getElementsByTagName (matches local name across any namespace) as a reliable fallback.
        const mutation =
            tradeOptions.querySelector('mutation') ||
            (tradeOptions.getElementsByTagName('mutation')[0] as Element | undefined) ||
            null;
        if (mutation) {
            mutation.setAttribute('has_prediction', xmlParams.hasPredict ? 'true' : 'false');
        }
        // Always locate the PREDICTION value block so it can be patched.
        // querySelector is scoped to tradeOptions, so it reliably finds the child value.
        const predValue = tradeOptions.querySelector('value[name="PREDICTION"]');
        if (predValue) {
            // The prediction field may live inside a <shadow> or a <block> element.
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

    // Patch variables in INITIALIZATION block only
    const initStatement = doc.querySelector('statement[name="INITIALIZATION"]');
    if (initStatement) {
        const varMap: Record<string, number> = {
            stake,
            martingale,
            take_profit: takeProfit,
            stop_loss: stopLoss,
        };
        const varSetBlocks = initStatement.querySelectorAll('block[type="variables_set"]');
        varSetBlocks.forEach(block => {
            const varField = block.querySelector(':scope > field[name="VAR"]');
            const varName = varField?.textContent?.trim();
            if (varName && varName in varMap) {
                const numBlock = block.querySelector('value[name="VALUE"] > block[type="math_number"]');
                const numField = numBlock?.querySelector('field[name="NUM"]');
                if (numField) numField.textContent = String(varMap[varName]);
            }
        });
    }

    return new XMLSerializer().serializeToString(doc);
};

const fetchTickDigitsOnce = (symbol: string, pipSize: number, count: number): Promise<number[]> =>
    new Promise((resolve, reject) => {
        const appId = getAppId();
        const server = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
        const ws = new WebSocket(`wss://${server}/websockets/v3?app_id=${appId}&l=EN&brand=frostydbot`);
        let settled = false;
        const done = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            fn();
        };
        const timer = setTimeout(() => done(() => reject(new Error(`Timeout: ${symbol}`))), 25000);
        ws.onopen = () => ws.send(JSON.stringify({ ticks_history: symbol, count: Math.min(count, 5000), end: 'latest', style: 'ticks' }));
        ws.onmessage = e => {
            try {
                const data = JSON.parse(e.data);
                // Only act on the history response — ignore pings, echoes, and other message types
                if (data.error) {
                    done(() => reject(new Error(data.error.message)));
                } else if (data.history?.prices) {
                    done(() => resolve(data.history.prices.map((p: number) => getLastDigit(p, pipSize))));
                }
                // else: not the message we're waiting for — keep the socket open
            } catch {
                done(() => reject(new Error('Parse error')));
            }
        };
        ws.onerror = () => done(() => reject(new Error(`WS error: ${symbol}`)));
        ws.onclose = e => {
            if (!e.wasClean) done(() => reject(new Error(`WS closed unexpectedly: ${symbol}`)));
        };
    });

const fetchTickDigits = async (symbol: string, pipSize: number, count: number): Promise<number[]> => {
    // Retry once on failure to handle transient connection issues
    try {
        return await fetchTickDigitsOnce(symbol, pipSize, count);
    } catch {
        // Wait 500ms before retrying
        await new Promise(r => setTimeout(r, 500));
        return fetchTickDigitsOnce(symbol, pipSize, count);
    }
};

// ── Icons ──────────────────────────────────────────────────────────────────
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

// ── Component ──────────────────────────────────────────────────────────────
const AIScanner: React.FC = () => {
    const store = useStore();

    const [isOpen, setIsOpen] = useState(false);
    const [strategy, setStrategy] = useState<Strategy>('over1_under8');
    const [ticks, setTicks] = useState(1000);

    // User-editable bot params
    const [stake, setStake] = useState(2);
    const [martingale, setMartingale] = useState(2.5);
    const [takeProfit, setTakeProfit] = useState(5);
    const [stopLoss, setStopLoss] = useState(8);

    const [isScanning, setIsScanning] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<ScanResult | null>(null);
    const [statusMsg, setStatusMsg] = useState('');
    const [progress, setProgress] = useState(0);
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
        setStatusMsg('Connecting to markets...');

        const results: ScanResult[] = [];

        for (let i = 0; i < MARKETS.length; i++) {
            if (abortRef.current) break;
            const { symbol, name, pipSize } = MARKETS[i];
            setStatusMsg(`Scanning ${name}... (${i + 1}/${MARKETS.length})`);
            setProgress(Math.round(((i + 0.5) / MARKETS.length) * 100));
            // Small stagger between connections to avoid server-side rate limiting
            if (i > 0) await new Promise(r => setTimeout(r, 300));
            if (abortRef.current) break;
            try {
                const digits = await fetchTickDigits(symbol, pipSize, ticks);
                if (abortRef.current) break;
                const { tradeType, winRate, score } = analyzeDigits(digits, strategy);
                results.push({ symbol, marketName: name, tradeType, winRate, score });
            } catch (err) {
                console.warn(`[AI Scanner] Skipped ${name}:`, err);
            }
        }

        if (!abortRef.current && results.length > 0) {
            // Rank by score (edge over baseline), NOT raw winRate — prevents one
            // market dominating every scan simply because of a noise advantage
            const best = results.reduce((a, b) => (a.score > b.score ? a : b));
            setResult(best);
            setStatusMsg(`✓ Best entry: ${best.marketName} — ${best.tradeType} (${best.winRate.toFixed(1)}%)`);
            setProgress(100);
        } else if (!abortRef.current) {
            setStatusMsg('Scan failed. Check your connection and try again.');
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

            const xmlParams = getXMLParams(strategy, result.tradeType);
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

    // Derive display values for scan result
    const xmlParams = result ? getXMLParams(strategy, result.tradeType) : null;
    const contractTypeDisplay = xmlParams ? xmlParams.contractType.replace('DIGIT', '') : '—';
    const tradeTypeDisplay = xmlParams ? xmlParams.tradeTypeDeriv === 'overunder' ? 'Over/Under' : xmlParams.tradeTypeDeriv === 'evenodd' ? 'Even/Odd' : 'Match/Diff' : '—';
    const predictionDisplay = xmlParams?.hasPredict && xmlParams.prediction !== null ? String(xmlParams.prediction) : '—';
    const readyLabel = STRATEGIES.find(s => s.key === strategy)?.label ?? '';

    return (
        <>
            {/* Floating AI button */}
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

                            {/* ── Bot Parameters (manual) ──────────────────── */}
                            <div className='ai-scanner__section-label'>
                                Bot Parameters <span className='ai-scanner__section-sub'>edit before loading</span>
                            </div>
                            <div className='ai-scanner__params-grid'>
                                <div className='ai-scanner__param'>
                                    <label>Stake</label>
                                    <input
                                        type='number'
                                        min={0.35}
                                        step={0.5}
                                        value={stake}
                                        disabled={isScanning || isLoading}
                                        onChange={e => setStake(Math.max(0.35, parseFloat(e.target.value) || 0.35))}
                                    />
                                </div>
                                <div className='ai-scanner__param'>
                                    <label>Martingale ×</label>
                                    <input
                                        type='number'
                                        min={1}
                                        step={0.5}
                                        value={martingale}
                                        disabled={isScanning || isLoading}
                                        onChange={e => setMartingale(Math.max(1, parseFloat(e.target.value) || 1))}
                                    />
                                </div>
                                <div className='ai-scanner__param'>
                                    <label>Take Profit</label>
                                    <input
                                        type='number'
                                        min={0.5}
                                        step={0.5}
                                        value={takeProfit}
                                        disabled={isScanning || isLoading}
                                        onChange={e => setTakeProfit(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                                    />
                                </div>
                                <div className='ai-scanner__param'>
                                    <label>Stop Loss</label>
                                    <input
                                        type='number'
                                        min={0.5}
                                        step={0.5}
                                        value={stopLoss}
                                        disabled={isScanning || isLoading}
                                        onChange={e => setStopLoss(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                                    />
                                </div>
                            </div>

                            {/* ── Scan Configuration ──────────────────────── */}
                            <div className='ai-scanner__scan-row'>
                                <div className='ai-scanner__section-label' style={{ marginBottom: 0 }}>
                                    Scan depth
                                </div>
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

                            {/* ── Scan Results (auto-filled) ───────────────── */}
                            <div className='ai-scanner__section-label'>
                                Scan Results <span className='ai-scanner__section-sub'>auto-filled by scanner</span>
                            </div>
                            <div className='ai-scanner__results-grid'>
                                <div className={`ai-scanner__result-field${result ? ' ai-scanner__result-field--active' : ''}`}>
                                    <label>MARKET</label>
                                    <span className={result ? 'ai-scanner__result-value--filled' : ''}>
                                        {result ? result.marketName : 'Run scan first'}
                                    </span>
                                </div>
                                <div className={`ai-scanner__result-field${result ? ' ai-scanner__result-field--active' : ''}`}>
                                    <label>TRADE TYPE</label>
                                    <span className={result ? 'ai-scanner__result-value--filled' : ''}>
                                        {result ? tradeTypeDisplay : '—'}
                                    </span>
                                </div>
                                <div className={`ai-scanner__result-field${result ? ' ai-scanner__result-field--active' : ''}`}>
                                    <label>CONTRACT</label>
                                    <span className={result ? 'ai-scanner__result-value--filled' : ''}>
                                        {result ? contractTypeDisplay : '—'}
                                    </span>
                                </div>
                                <div className={`ai-scanner__result-field${result ? ' ai-scanner__result-field--active' : ''}`}>
                                    <label>PREDICTION</label>
                                    <span className={result ? 'ai-scanner__result-value--filled' : ''}>
                                        {result ? predictionDisplay : '—'}
                                    </span>
                                </div>
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

                            {/* Progress bar */}
                            {isScanning && (
                                <div className='ai-scanner__progress-track'>
                                    <div className='ai-scanner__progress-fill' style={{ width: `${progress}%` }} />
                                </div>
                            )}

                            {/* Status */}
                            <div className={`ai-scanner__status${result ? ' ai-scanner__status--success' : ''}`}>
                                {statusMsg || `Ready to scan ${readyLabel}.`}
                            </div>

                            {/* Actions */}
                            <div className='ai-scanner__actions'>
                                <button
                                    className='ai-scanner__btn ai-scanner__btn--primary'
                                    onClick={handleScan}
                                    disabled={isScanning || isLoading}
                                >
                                    {isScanning
                                        ? <><span className='ai-scanner__spinner' /> Scanning...</>
                                        : result
                                            ? <><RescanIcon size={15} /> Re-scan Markets</>
                                            : 'Scan Markets'}
                                </button>
                                <button
                                    className={`ai-scanner__btn ai-scanner__btn--secondary${result && !isScanning ? ' ai-scanner__btn--ready' : ''}`}
                                    onClick={handleLoadBot}
                                    disabled={!result || isScanning || isLoading}
                                    title={!result ? 'Run a scan first to find the best market' : 'Load AI Scanner Bot with these settings'}
                                >
                                    {isLoading ? <><span className='ai-scanner__spinner ai-scanner__spinner--muted' /> Loading...</> : 'Load Scanner Bot'}
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
