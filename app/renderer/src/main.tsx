import { Profiler, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bumpRendererCount, recordRendererSample } from './instrument';
import './styles.css';

function onRender(_id: string, _phase: string, actualDuration: number, baseDuration: number): void {
  recordRendererSample('react.commit.actual', actualDuration);
  recordRendererSample('react.commit.base', baseDuration);
  bumpRendererCount('react.commits');
}

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
createRoot(container).render(
  <StrictMode>
    <Profiler id="app" onRender={onRender}>
      <App api={window.dust} />
    </Profiler>
  </StrictMode>,
);
