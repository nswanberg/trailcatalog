import * as corgi from 'js/corgi';
import { Link } from 'js/corgi/history/link_element';

import { OutlinedInput } from 'js/dino/input';

import { SearchController, State } from './search_controller';

export function SearchElement(
    props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      boundaries: [],
      trails: [],
      query: '',
    };
  }

  return <>
    <div
        className="relative"
        js={corgi.bind({
          controller: SearchController,
          state: [state, updateState],
        })}
    >
      <OutlinedInput
          className="border-tc-gray-400 peer w-96"
          icon="Search"
          placeholder="Search trails or destinations"
          unboundEvents={{
            input: 'search',
          }}
      />
      {
        state.boundaries.length + state.trails.length > 0
            ? <SearchResults
                boundaries={state.boundaries}
                className="hidden active:block focus-within:block peer-focus-within:block"
                query={state.query}
                trails={state.trails} />
            : <></>
      }
    </div>
  </>;
}

function SearchResults({boundaries, className, query, trails}: {
  boundaries: State['boundaries'],
  className: string,
  query: string,
  trails: State['trails'],
}) {
  const nationalParks = boundaries.filter(b => isNationalParky(b.type));
  const nonParks = boundaries.filter(b => !isNationalParky(b.type));
  return <>
    <div
        className={`
          absolute
          bg-white
          inset-x-0
          overflow-y-scroll
          max-h-[85vh]
          px-3
          text-black
          top-full
          z-10
          ${className}
      `}
      tabIndex="-1"
    >
      <SearchCategory
          icon="/static/images/icons/trail.svg"
          label="Trails"
          results={trails.map(trail => <>
            <Link className="no-underline" href={`/trail/${trail.id}`}>
              <HighlightText haystack={trail.name} needle={query} />
            </Link>
          </>)}
      />
      <SearchCategory
          icon="/static/images/icons/national_park.svg"
          label="National Parks"
          results={nationalParks.map(boundary => <>
            <Link className="no-underline" href={`/boundary/${boundary.id}`}>
              <HighlightText haystack={boundary.name} needle={query} />
            </Link>
          </>)}
      />
      <SearchCategory
          icon="/static/images/icons/boundary.svg"
          label="Areas"
          results={nonParks.map(boundary => <>
            <Link className="no-underline" href={`/boundary/${boundary.id}`}>
              <HighlightText haystack={boundary.name} needle={query} />
            </Link>
          </>)}
      />
    </div>
  </>;
}

function SearchCategory({icon, label, results}: {
  icon: string,
  label: string,
  results: corgi.VElementOrPrimitive[],
}) {
  return <>
    <div className="mt-3 space-y-3">
      <div className="flex font-bold gap-1 items-center">
        <img
            aria-hidden="true"
            src={icon}
            className="h-6"
        />
        {label}
      </div>
      {results.map(c => <>
        <div className="border-b pb-2">
          {c}
        </div>
      </>)}
    </div>
  </>;
}

function HighlightText({needle, haystack}: {needle: string, haystack: string}) {
  const index = haystack.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) {
    return <span>{haystack}</span>;
  } else {
    const length = needle.length;
    return <>
      <span>{haystack.substr(0, index)}</span>
      <span className="font-bold">{haystack.substr(index, length)}</span>
      <span>{haystack.substr(index + length)}</span>
    </>;
  }
}

function isNationalParky(type: number): boolean {
  // TODO: keep this in sync with the Kotlin? Compile to JS?
  if (type === 68 || type === 4419) {
    return true;
  } else {
    return false;
  }
}