const stats = [
  {
    id: 1,
    name: "Sun's Daily Output",
    value: "173,000",
    unit: "TW",
    description: "Energy hitting Earth daily",
  },
  {
    id: 2,
    name: "Global Solar Jobs",
    value: "4.6M",
    unit: "",
    description: "Employed worldwide",
  },
  {
    id: 3,
    name: "Cost Reduction",
    value: "89",
    unit: "%",
    description: "Since 2010",
  },
  {
    id: 4,
    name: "Earth's Potential",
    value: "1",
    unit: "hr",
    description: "Could power a year",
  },
]

export default function Stats() {
  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-semibold text-white">
            The Solar Opportunity
          </h2>
          <p className="mt-2 text-gray-500 text-sm">
            Why solar energy represents the future
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.id}
              className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-5 text-center group hover:border-cyan-700/30 transition-colors"
            >
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-bold text-white group-hover:text-cyan-500 transition-colors">
                  {stat.value}
                </span>
                {stat.unit && (
                  <span className="text-lg text-gray-400 font-medium">
                    {stat.unit}
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm font-medium text-gray-300">
                {stat.name}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {stat.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
