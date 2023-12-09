//this file is for interacting with the smart contract

export default function SCInteraction() {
  return (
    <>
      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-4 border-4 border-green-700 sm:grid-cols-2 lg:grid-cols-2">
        {/* Whitelist Address Input */}
        <div className="border-2 border-gray-200 rounded-md p-1">
          <label className="block text-sm font-medium leading-6 text-white">
            Whitelist Address
          </label>
          <div className="my-4">
            <input
              type="text"
              name="setMinter"
              id="setMinter"
              className="block w-full rounded-md border-1 p-1 text-black shadow-sm ring-1 ring-inset placeholder:text-gray-600 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              placeholder="Enter your ETH address (0x...)"
            />
          </div>
        </div>
        <button
          type="button"
          name="setMinterButton"
          className="rounded-md border-2 border-green-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Set Producer
        </button>
      </ul>
      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-4 border-4 border-green-700 sm:grid-cols-2 lg:grid-cols-2">
        {/* Send Energy Token */}
        <div className="border-2 border-gray-200 rounded-md p-1">
          <label className="block text-sm font-medium leading-6 text-white">
            Send Energy Tokens
          </label>
          <div className="my-4">
            <input
              type="text"
              name="recipientAddress"
              id="recipientAddress"
              className="block w-full rounded-md border-1 p-1 text-black shadow-sm ring-1 ring-inset placeholder:text-gray-600 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              placeholder="Enter recipient ETH address (0x...)"
            />
          </div>
        </div>

        <button
          type="button"
          name="recipientButton"
          className="rounded-md border-2 border-green-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Send Tokens
        </button>
        <div className="border-2 border-gray-200 rounded-md p-1">
          <label className="block text-sm font-medium leading-6 text-white">
            Enter amount to send
          </label>
          <div className="my-4">
            <input
              type="number"
              name="recipientAmount"
              id="recipientAmount"
              className="block w-full rounded-md border-1 p-1 text-black shadow-sm ring-1 ring-inset placeholder:text-gray-600 focus:ring-2 focus:ring-inset focus:ring-green-600 sm:text-sm sm:leading-6"
              placeholder="Send Amount"
            />
          </div>
        </div>
      </ul>

      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-4 border-4 border-green-700 sm:grid-cols-2 lg:grid-cols-2">
        <div className="border-2 border-gray-200 rounded-md p-1">
          <label className="block text-sm font-medium leading-6 text-white">
            Burn Energy Tokens
          </label>
          <div className="my-4">
            <input
              type="number"
              name="burnTokens"
              id="burnTokens"
              className="block w-full rounded-md border p-1 text-black shadow-sm ring-1 ring-inset placeholder:text-gray-600 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              placeholder="Enter amount to burn"
            />
          </div>
        </div>
        <button
          type="button"
          className="rounded-md border-2 border-green-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Burn Tokens
        </button>
      </ul>
      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-10 border-4 border-green-700 sm:grid-cols-1 lg:grid-cols-1">
        <button
          type="button"
          className="rounded-md bg-green-600 px-3.5 text-lg font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
        >
          Mint Energy Tokens
        </button>
      </ul>
    </>
  );
}
