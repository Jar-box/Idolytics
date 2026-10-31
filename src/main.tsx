import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import 'react-easy-crop/react-easy-crop.css';
import './styles.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Missing root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
