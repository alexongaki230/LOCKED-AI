import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { load, save_types } from '@/external/bot-skeleton';
import { getBotXML, isAllowedDomain } from './bot-data';
import './free-bots.scss';

interface Bot {
    id: string;
    name: string;
    description: string;
    fileName: string;
    category: string;
    icon: string;
}

const BOTS: Bot[] = [
    {
        id: '1',
        name: 'Frosty Speed Bot',
        description: 'FrostyDBot speed trading bot with martingale management, even/odd digit strategy, and daily profit system.',
        fileName: 'Frosty_Speed_Bot_1781496344897.xml',
        category: 'Speed Trading',
        icon: '❄️',
    },
    {
        id: '2a',
        name: 'Frosty Over 2 V1',
        description: 'Over digit 2 strategy on Volatility 10 — stake $1.5, martingale x3, take profit $2.5, stop loss $8.',
        fileName: 'FROSTY_OVER_2_V1_1781503599461.xml',
        category: 'Pattern Analysis',
        icon: '📈',
    },
    {
        id: '2b',
        name: 'Frosty Under 7 V1',
        description: 'Under digit 7 strategy on Volatility 10 — stake $2, martingale x2.5, take profit $5, stop loss $8.',
        fileName: 'FROSTY_UNDER_7_V1_1781503599462.xml',
        category: 'Pattern Analysis',
        icon: '📉',
    },
    {
        id: '2c',
        name: 'Frosty Entry Loop',
        description: 'Entry-loop bot on Volatility 100 — waits for digit 4 before trading, martingale x2.5, take profit $3, stop loss $9.',
        fileName: 'FROSTY_ENTRY_LOOP_1781503610620.xml',
        category: 'Pattern Analysis',
        icon: '🔁',
    },
    {
        id: '4',
        name: 'Frosty AI Entry Bot',
        description: 'AI-powered entry point bot with custom stake, prediction list, and martingale recovery on Volatility 10 over/under digit trades.',
        fileName: 'Frosty_AI_Entry_Bot_1781501443854.xml',
        category: 'AI Trading',
        icon: '🤖',
    },
    {
        id: '5',
        name: 'Frosty 👑 Version',
        description: 'Frosty crown edition — over/under digit strategy on Volatility 10 with martingale recovery, take profit, and stop loss management.',
        fileName: 'FROSTY_VERSION_1781496490594.xml',
        category: 'Speed Trading',
        icon: '🧊',
    },
    {
        id: '5b',
        name: 'Dominator 🌀 Version 2',
        description: 'Trend-following dominator bot on Volatility 10 — over/under digits with martingale x3, take profit $2, stop loss $14, and recovery digit system.',
        fileName: 'DOMINATOR_🌀VERSION_2_1781503472374.xml',
        category: 'Speed Trading',
        icon: '🌀',
    },
    {
        id: '5c',
        name: 'Frosty 🌀💹 Dominator',
        description: 'Advanced dominator on Volatility 50 — over/under digits with entry point, martingale x2.5, take profit $3, stop loss $25, and max loss guard.',
        fileName: 'FROSTY_🌀💹DOMINATOR_1781503472376.xml',
        category: 'Speed Trading',
        icon: '💹',
    },
    {
        id: '7',
        name: 'Frosty Money Maker V2',
        description: 'Frosty Over strategy — digit over/under on Volatility 10 with martingale recovery, trend tracking, and profit/stop-loss management.',
        fileName: 'FROSTY_MONEY_MAKER_V2_1781499678247.xml',
        category: 'Premium',
        icon: '💰',
    },
    {
        id: '7b',
        name: 'Frosty Money Maker',
        description: 'Frosty Under strategy — digit under on Volatility 10 with martingale recovery, trend analysis, and automatic profit/loss controls.',
        fileName: 'FROSTY_MONEY_MAKER_1781499678248.xml',
        category: 'Premium',
        icon: '💎',
    },
    {
        id: '10',
        name: 'Frosty Digit Eliminator',
        description: 'Differs digit bot on Volatility 100 — entry-loop waits for your chosen digit, martingale x5, take profit $3, stop loss $9.',
        fileName: 'FROSTY_DIGIT_ELIMINATOR_1781503696373.xml',
        category: 'Differ',
        icon: '🎯',
    },
    {
        id: '11',
        name: 'Frosty ♻ Even⏫Odd⏬ Engine',
        description: 'Smart even/odd engine on Volatility 10 — analyses 100 digits, trades when edge ≥56%, martingale x2, take profit $5, stop loss $15.',
        fileName: 'FROSTY_♻_EVEN⏫ODD⏬_ENGINE_1781503809550.xml',
        category: 'Even/Odd',
        icon: '♻️',
    },
];

const FreeBots = observer(() => {
    const { dashboard } = useStore();
    const [loadingBotId, setLoadingBotId] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>(BOTS[0].category);

    const categories = Array.from(new Set(BOTS.map(bot => bot.category)));

    const filteredBots = BOTS.filter(bot => bot.category === selectedCategory);

    const loadBot = async (bot: Bot) => {
        try {
            setLoadingBotId(bot.id);

            if (!isAllowedDomain()) {
                alert('⛔ This bot is locked to FrostyDBot and can only be used at frostydbot.replit.app');
                return;
            }

            const xmlContent = getBotXML(bot.id);
            if (!xmlContent) {
                throw new Error('Bot data unavailable');
            }

            await load({
                block_string: xmlContent,
                file_name: bot.name,
                workspace: (window as any).Blockly?.derivWorkspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            dashboard.setActiveTab(1);
            window.location.hash = 'bot_builder';
            
        } catch (error) {
            console.error('Error loading bot:', error);
        } finally {
            setLoadingBotId(null);
        }
    };

    return (
        <div className='free-bots'>
            <div className='free-bots__categories'>
                {categories.map(category => (
                    <button
                        key={category}
                        className={`free-bots__category-btn ${selectedCategory === category ? 'free-bots__category-btn--active' : ''}`}
                        onClick={() => setSelectedCategory(category)}
                    >
                        {category}
                    </button>
                ))}
            </div>

            <div className='free-bots__grid'>
                {filteredBots.map(bot => (
                    <div key={bot.id} className='free-bots__card'>
                        <div className='free-bots__card-header'>
                            <span className='free-bots__card-icon'>{bot.icon}</span>
                            <span className='free-bots__card-category'>{bot.category}</span>
                        </div>
                        <h3 className='free-bots__card-title'>{bot.name}</h3>
                        <p className='free-bots__card-description'>{bot.description}</p>
                        <button
                            className='free-bots__card-btn'
                            onClick={() => loadBot(bot)}
                            disabled={loadingBotId === bot.id}
                        >
                            {loadingBotId === bot.id ? (
                                <span className='free-bots__card-btn-loading'>Loading...</span>
                            ) : (
                                <>
                                    <span>Load Bot</span>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M5 12h14M12 5l7 7-7 7"/>
                                    </svg>
                                </>
                            )}
                        </button>
                    </div>
                ))}
            </div>

            <div className='free-bots__footer'>
                <p>All bots are provided for educational purposes. Always test with demo accounts first.</p>
            </div>
        </div>
    );
});

export default FreeBots;
