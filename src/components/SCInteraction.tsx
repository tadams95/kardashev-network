//this file is for interacting with the smart contract
import { ChangeEvent, useState } from "react";

import { usePrepareContractWrite, useContractWrite } from "wagmi";

import useDebounce from "@/utils/useDebounce";
import { CONTRACT_KARDASHEV_NETWORK } from "@/onchain/contractInfo";

export default function SCInteraction({ ethereumAddress }: any) {
  const [producerAddress, setProducerAddress] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [sendAmount, setSendAmount] = useState(0);
  const [burnAmount, setBurnAmount] = useState(0);

  const { abi, address } = CONTRACT_KARDASHEV_NETWORK;

  const debouncedSendAmount = useDebounce(sendAmount, 500);
  const debouncedReceiver = useDebounce(recipientAddress, 500);

  const handleSetProducer = (event: ChangeEvent<HTMLInputElement>) => {
    setProducerAddress(event.target.value);
  };

  const handleRecipientAddressChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    setRecipientAddress(event.target.value);
  };

  const handleSendAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Convert the input value to a number
    const amount = parseFloat(event.target.value);

    // Check if the parsed amount is not 0 before updating the state
    if (amount !== 0) {
      setSendAmount(amount);
    } else {
      // Handle invalid input (optional)
      // For example, show an error message to the user
      return;
    }
  };

  const handleBurnAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    //convert the inpout value to a number
    const amount = parseFloat(event.target.value);

    //check if the parsed amount is not 0 before updating the state
    if (amount !== 0) {
      setBurnAmount(amount);
    } else {
      return;
    }
  };

  //set producer config
  const { config: setMinterConfig } = usePrepareContractWrite({
    address: address,
    abi: abi,
    chainId: 84531,
    functionName: "setMinter",
    args: [producerAddress, true], // Update with your actual args
    enabled: Boolean(producerAddress),
  });

  const { write: setMinter } = useContractWrite(setMinterConfig);

  //transfer config for sending tokens
  const { config: transferConfig } = usePrepareContractWrite({
    address: address,
    abi: abi,
    chainId: 84531,
    functionName: "transfer",
    args: [debouncedReceiver, debouncedSendAmount],
    enabled: Boolean(debouncedSendAmount),
  });

  const { write: transfer } = useContractWrite(transferConfig);

  //burn energy tokens config
  const { config: burnConfig } = usePrepareContractWrite({
    address: address,
    abi: abi,
    chainId: 84531,
    functionName: "burnEnergyTokens",
    args: [burnAmount],
    enabled: Boolean(burnAmount),
  });

  const { write: burnTokens } = useContractWrite(burnConfig);

  //mint tokens config
  const { config: mintConfig } = usePrepareContractWrite({
    address: address,
    abi: abi,
    chainId: 84531,
    functionName: "mintEnergyTokens",
    args: [ethereumAddress],
    enabled: true,
  });

  const { write: mintTokens } = useContractWrite(mintConfig);

  return (
    <>
      {/* Whitelist Address Input */}
      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-4 border-4 border-green-700 sm:grid-cols-2 lg:grid-cols-2">
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
              onChange={handleSetProducer}
            />
          </div>
        </div>
        {/* Set Producer Button */}
        <button
          type="button"
          name="setMinterButton"
          className="rounded-md border-2 border-green-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={() => setMinter?.()}
        >
          Set Producer
        </button>
      </ul>
      {/* Send Energy Token */}
      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-4 border-4 border-green-700 sm:grid-cols-2 lg:grid-cols-2">
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
              value={recipientAddress}
              onChange={handleRecipientAddressChange}
            />
          </div>
        </div>
        {/* Send Energy Token Button */}
        <button
          type="button"
          name="sendTokenButton"
          className="rounded-md border-2 border-green-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={() => transfer?.()}
        >
          Send Tokens
        </button>
        {/* Enter Amount */}
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
              value={sendAmount}
              onChange={handleSendAmountChange}
            />
          </div>
        </div>
      </ul>

      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-4 border-4 border-green-700 sm:grid-cols-2 lg:grid-cols-2">
        {/* Enter Burn Amount */}
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
              onChange={handleBurnAmountChange}
            />
          </div>
        </div>
        {/* Burn Token Button */}
        <button
          type="button"
          className="rounded-md border-2 border-green-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={() => burnTokens?.()}
        >
          Burn Tokens
        </button>
      </ul>
      <ul className="grid grid-cols-1 my-4 gap-6 rounded-md p-10 border-4 border-green-700 sm:grid-cols-1 lg:grid-cols-1">
        {/* Mint Energy Token Button */}
        <button
          type="button"
          className="rounded-md bg-green-600 px-3.5 text-lg font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
          onClick={() => mintTokens?.()}
        >
          Mint Energy Tokens
        </button>
      </ul>
    </>
  );
}
