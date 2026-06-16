import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import { registerPWA } from './utils/pwa-utils';
import './styles/index.scss';

// Force the correct app ID and clear any stale OIDC cache for frostydbot.site.
// @deriv-com/utils does not recognise this domain and would pick the wrong fallback,
// so we always write the correct value before anything else runs.
const FROSTYDBOT_DOMAINS = ['frostydbot.site', 'www.frostydbot.site'];
if (FROSTYDBOT_DOMAINS.includes(window.location.hostname)) {
    localStorage.setItem('config.app_id', '84799');
    // Clear cached OIDC discovery endpoints so they are re-fetched cleanly
    // with the correct app ID instead of whatever was stored from a prior session.
    localStorage.removeItem('config.oidc_endpoints');
}

AnalyticsInitializer();
registerPWA()
    .then(registration => {
        if (registration) {
            console.log('PWA service worker registered successfully for Chrome');
        } else {
            console.log('PWA service worker disabled for non-Chrome browser');
        }
    })
    .catch(error => {
        console.error('PWA service worker registration failed:', error);
    });

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
