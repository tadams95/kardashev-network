import KardashevNetworkABI from "./KardashevNetwork";
import type { Abi } from "viem";

type Contract = {
  abi: Abi;
  address: `0x${string}`;
};

export const CONTRACT_KARDASHEV_NETWORK: Contract = {
  abi: KardashevNetworkABI,
  address: "0x3F26504262d25dd25074Ae222709f4259a36272C",
};
