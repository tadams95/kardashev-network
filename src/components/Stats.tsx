import React from "react";

const stats = [
  {
    id: 1,
    name: "Sun's Daily Energy Output",
    value: "173,000 TW",
  },
  { id: 2, name: "Global Solar Jobs", value: "4.6 million" },
  { id: 3, name: "Solar Panel Cost Plunge", value: "89%" },
  { id: 4, name: "Earth's Solar Power Potential", value: "1 Hour" },
];

export default function Stats() {
  return (
    <div className="bg-black py-12 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl lg:max-w-none">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-200 sm:text-4xl">
              Solar Stats
            </h2>
            {/* <p className="mt-4 text-lg leading-8 text-gray-300">
              Lorem ipsum dolor sit amet consect adipisicing possimus.
            </p> */}
          </div>
          <dl className="mt-16 grid grid-cols-1 gap-0.5 overflow-hidden rounded-2xl text-center sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.id} className="flex flex-col bg-white/5 p-8">
                <dt className="text-sm font-semibold leading-6 text-gray-300">
                  {stat.name}
                </dt>
                <dd className="order-first text-3xl font-semibold tracking-tight text-white">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
