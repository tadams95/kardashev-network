// City selector dropdown for weather dashboard
// Allows user to select from 16 major US cities

import { Fragment } from 'react'
import { Listbox, Transition } from '@headlessui/react'
import { ChevronUpDownIcon, CheckIcon } from '@heroicons/react/20/solid'
import { CITY_COORDS, type CityCoordinates } from '@/lib/utils/cityCoordinates'

// ============================================================================
// Types
// ============================================================================

interface CitySelectorProps {
  value: string // Current city code
  onChange: (cityCode: string) => void
  cities?: CityCoordinates[] // Optional custom list
}

// ============================================================================
// Default Cities List
// ============================================================================

const DEFAULT_CITIES = [
  CITY_COORDS['NY'],
  CITY_COORDS['CHI'],
  CITY_COORDS['LA'],
  CITY_COORDS['SF'],
  CITY_COORDS['MIA'],
  CITY_COORDS['DAL'],
  CITY_COORDS['HOU'],
  CITY_COORDS['PHX'],
  CITY_COORDS['SEA'],
  CITY_COORDS['BOS'],
  CITY_COORDS['DEN'],
  CITY_COORDS['ATL'],
  CITY_COORDS['PHI'],
  CITY_COORDS['DC'],
  CITY_COORDS['LV'],
  CITY_COORDS['AUS'],
].filter(Boolean) // Filter out any undefined cities

// Sort alphabetically by name
DEFAULT_CITIES.sort((a, b) => a.name.localeCompare(b.name))

// ============================================================================
// Component
// ============================================================================

export function CitySelector({ value, onChange, cities = DEFAULT_CITIES }: CitySelectorProps) {
  const selectedCity = cities.find(c => c.code === value) || cities[0]

  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative w-full sm:w-64">
        <Listbox.Button className="relative w-full cursor-pointer rounded-lg bg-black/40 border border-gray-700/50 py-2.5 pl-4 pr-10 text-left text-white hover:border-amber-500/50 transition-colors focus:outline-none focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900">
          <span className="block truncate">
            {selectedCity.name} ({selectedCity.code})
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <ChevronUpDownIcon
              className="h-5 w-5 text-gray-400"
              aria-hidden="true"
            />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-10 mt-2 max-h-96 w-full overflow-auto rounded-lg bg-gray-900 border border-gray-700/50 shadow-lg py-1 text-base focus:outline-none sm:text-sm">
            {cities.map((city) => (
              <Listbox.Option
                key={city.code}
                value={city.code}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2.5 pl-10 pr-4 ${
                    active ? 'bg-amber-500/10 text-white' : 'text-gray-300'
                  }`
                }
              >
                {({ selected, active }) => (
                  <>
                    <span
                      className={`block truncate ${
                        selected ? 'font-semibold' : 'font-normal'
                      }`}
                    >
                      {city.name} ({city.code})
                    </span>
                    {selected ? (
                      <span
                        className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                          active ? 'text-amber-400' : 'text-amber-400'
                        }`}
                      >
                        <CheckIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    ) : null}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  )
}
