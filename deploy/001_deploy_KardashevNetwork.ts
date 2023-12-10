import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deploy } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  // Since the constructor expects an address, provide the deployer address as an argument
  await deploy("KardashevNetwork", {
    from: deployer,
    args: [deployer],
  });
};

export default func;
