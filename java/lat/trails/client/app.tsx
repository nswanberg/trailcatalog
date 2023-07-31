import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { isServerSide } from 'js/server/ssr_aware';

import { CitationsElement } from './citations_element';
import { RouteController, State } from './route_controller';
import { OverviewElement } from './overview_element';

import './app.css';

// TODO: assert little endian

export function App(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = RouteController.getInitialState();
  }

  let route;
  if (state.active.kind === 'citations') {
    route = <CitationsElement parameters={state.parameters} />;
  } else if (state.active.kind === 'overview') {
    route = <OverviewElement parameters={state.parameters} />;
  } else {
    checkExhaustive(state.active);
  }

  return <>
    <div
        js={corgi.bind({
          controller: RouteController,
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="h-full"
    >
      {route}
    </div>
  </>;
}

if (!isServerSide()) {
  corgi.hydrateElement(checkExists(document.getElementById('root')), <App />);
}
