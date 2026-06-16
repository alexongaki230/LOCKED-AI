import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import { registerPWA } from './utils/pwa-utils';
import './styles/index.scss';

// Ensure the auth-client uses the correct app ID (84799) for frostydbot.site.
// @deriv-com/utils does not recognise frostydbot.site so it picks the wrong fallback.
// Setting config.app_id in localStorage takes priority and forces the correct value.
const FROSTYDBOT_DOMAINS = ['frostydbot.site', 'www.frostydbot.site'];
if (FROSTYDBOT_DOMAINS.includes(window.location.hostname)) {
    if (!localStorage.getItem('config.app_id')) {
        localStorage.setItem('config.app_id', '84799');
    }
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
