import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './pages/Overlay';
import { Result } from './pages/Result';
import { Settings } from './pages/Settings';
import './styles.css';

function Root(): React.JSX.Element {
  const route = window.location.hash.replace(/^#\//, '').split('?')[0];
  if (route === 'overlay') return <Overlay />;
  if (route === 'result') return <Result />;
  return <Settings />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
